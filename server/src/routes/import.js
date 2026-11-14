// นำเข้าข้อมูลการลงเวลาจากไฟล์ (เช่น ไฟล์ที่ export จากเครื่องสแกนนิ้ว)
// หน้าเว็บอ่านไฟล์ CSV แล้วแปลงเป็นแถว { line, employee_code, date, time_in, time_out } ส่งมาที่นี่
// dry_run = true: ตรวจสอบและแสดงตัวอย่างผลลัพธ์อย่างเดียว / false: บันทึกจริง (ข้ามแถวที่ผิด)
const express = require('express');
const ExcelJS = require('exceljs');
const { pool, withTransaction } = require('../db');
const { logAudit } = require('../audit');
const { todayStr } = require('../dates');
const { asyncHandler, badRequest } = require('../http');
const { isFilled, toBool } = require('../validate');
const {
  MAX_ROWS, MAX_SHEET_ROWS, sheetRows, mergeRows, planImport,
} = require('../importRows');

const router = express.Router();

// ===================== อ่านไฟล์ Excel (.xlsx) =====================
// หน้าเว็บส่งไฟล์มาทั้งไฟล์ เซิร์ฟเวอร์อ่านชีตแรกแล้วคืนเป็นตาราง (ข้อความ) ให้หน้าเว็บเลือกคอลัมน์ต่อเหมือนไฟล์ CSV
router.post(
  '/parse-xlsx',
  express.raw({ type: () => true, limit: '10mb' }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest(['ไม่พบไฟล์']);
    // ไฟล์ .xlsx เป็นไฟล์ zip ขึ้นต้นด้วย "PK"
    if (req.body[0] !== 0x50 || req.body[1] !== 0x4b) {
      throw badRequest(['ไฟล์นี้ไม่ใช่ Excel แบบ .xlsx (ถ้าเป็น .xls รุ่นเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx หรือ CSV)']);
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(req.body);
    } catch (error) {
      throw badRequest(['อ่านไฟล์ Excel ไม่ได้ ไฟล์อาจเสียหรือมีรหัสผ่าน']);
    }
    const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
    if (!sheet) throw badRequest(['ไม่พบข้อมูลในไฟล์']);
    if (sheet.actualRowCount > MAX_SHEET_ROWS) {
      throw badRequest([`ไฟล์มีมากกว่า ${MAX_SHEET_ROWS} แถว กรุณาแบ่งไฟล์`]);
    }

    res.json({ sheet: sheet.name, rows: sheetRows(sheet) });
  }),
);

router.post('/attendance', asyncHandler(async (req, res) => {
  const inputRows = Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!inputRows || inputRows.length === 0) throw badRequest(['ไม่พบข้อมูลที่จะนำเข้า']);
  if (inputRows.length > MAX_ROWS) throw badRequest([`นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว กรุณาแบ่งไฟล์`]);
  const dryRun = req.body.dry_run === undefined ? true : toBool(req.body.dry_run);
  const today = todayStr();

  const { results, entries } = mergeRows(inputRows, today);

  // 2) หาพนักงานจากรหัส
  const codes = [...new Set(entries.map((entry) => entry.employee_code))];
  const employeesByCode = new Map();
  if (codes.length > 0) {
    const [employees] = await pool.query(
      'SELECT id, employee_code, first_name, last_name, active FROM employees WHERE employee_code IN (?)',
      [codes],
    );
    for (const employee of employees) employeesByCode.set(employee.employee_code.toLowerCase(), employee);
  }

  // 3) ข้อมูลเดิมในฐานข้อมูลของวันเดียวกัน
  const existing = new Map();
  const employeeIds = [...new Set([...employeesByCode.values()].map((employee) => employee.id))];
  if (employeeIds.length > 0 && entries.length > 0) {
    const dates = entries.map((entry) => entry.date).sort();
    const [rows] = await pool.query(
      `SELECT id, employee_id, date, time_in, time_out FROM attendance
       WHERE deleted_at IS NULL AND employee_id IN (?) AND date BETWEEN ? AND ?`,
      [employeeIds, dates[0], dates[dates.length - 1]],
    );
    for (const row of rows) existing.set(`${row.employee_id}|${row.date}`, row);
  }

  // ใบลาเต็มวันที่อนุมัติแล้วในช่วงเดียวกัน (เตือนเมื่อการลงเวลาตรงกับวันลา)
  const approvedLeaves = [];
  if (employeeIds.length > 0 && entries.length > 0) {
    const dates = entries.map((entry) => entry.date).sort();
    const [rows] = await pool.query(
      `SELECT employee_id, leave_type, start_date, end_date FROM leave_requests
       WHERE deleted_at IS NULL AND status = 'approved' AND half_day = 0 AND employee_id IN (?)
         AND start_date <= ? AND end_date >= ?`,
      [employeeIds, dates[dates.length - 1], dates[0]],
    );
    approvedLeaves.push(...rows);
  }
  const leaveOn = (employeeId, date) => approvedLeaves.find(
    (leave) => leave.employee_id === employeeId && leave.start_date <= date && leave.end_date >= date,
  );

  const { actions, summary } = planImport({
    entries, results, employeesByCode, existing, leaveOn, rowCount: inputRows.length,
  });

  if (dryRun) {
    return res.json({ dry_run: true, summary, results });
  }

  // 5) บันทึกจริงใน transaction เดียว
  await withTransaction(async (connection) => {
    for (const action of actions) {
      if (action.type === 'create') {
        await connection.query(
          `INSERT INTO attendance (employee_id, date, time_in, time_out, source, created_by, updated_by)
           VALUES (?, ?, ?, ?, 'import', ?, ?)`,
          [action.employee.id, action.entry.date, action.entry.time_in, action.entry.time_out, req.user.id, req.user.id],
        );
      } else {
        await connection.query(
          'UPDATE attendance SET time_in = ?, time_out = ?, updated_by = ? WHERE id = ?',
          [action.timeIn, action.timeOut, req.user.id, action.current.id],
        );
      }
    }
    await logAudit(req, {
      action: 'import',
      entity: 'attendance',
      details: { ...summary, file_name: isFilled(req.body.file_name) ? String(req.body.file_name).slice(0, 200) : null },
    }, connection);
  });

  res.json({ dry_run: false, summary, results });
}));

module.exports = router;
