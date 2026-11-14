// นำเข้าข้อมูลการลงเวลาจากไฟล์ (เช่น ไฟล์ที่ export จากเครื่องสแกนนิ้ว)
// หน้าเว็บอ่านไฟล์ CSV แล้วแปลงเป็นแถว { line, employee_code, date, time_in, time_out } ส่งมาที่นี่
// dry_run = true: ตรวจสอบและแสดงตัวอย่างผลลัพธ์อย่างเดียว / false: บันทึกจริง (ข้ามแถวที่ผิด)
const express = require('express');
const { pool, withTransaction } = require('../db');
const { logAudit } = require('../audit');
const { todayStr } = require('../dates');
const { asyncHandler, badRequest } = require('../http');
const {
  isFilled, isValidDate, isValidTime, normalizeTime, toBool,
} = require('../validate');

const router = express.Router();
const MAX_ROWS = 5000;

const minTime = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));
const maxTime = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

router.post('/attendance', asyncHandler(async (req, res) => {
  const inputRows = Array.isArray(req.body.rows) ? req.body.rows : null;
  if (!inputRows || inputRows.length === 0) throw badRequest(['ไม่พบข้อมูลที่จะนำเข้า']);
  if (inputRows.length > MAX_ROWS) throw badRequest([`นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว กรุณาแบ่งไฟล์`]);
  const dryRun = req.body.dry_run === undefined ? true : toBool(req.body.dry_run);
  const today = todayStr();

  // 1) ตรวจแต่ละแถว และรวมแถวของพนักงานคนเดียวกันวันเดียวกัน (เวลาเข้า = เร็วสุด, เวลาออก = ช้าสุด)
  const results = [];
  const merged = new Map();
  inputRows.forEach((row, index) => {
    const line = Number(row.line) || index + 1;
    const code = isFilled(row.employee_code) ? String(row.employee_code).trim() : '';
    const errors = [];
    if (!code) errors.push('ไม่มีรหัสพนักงาน');
    if (!isValidDate(row.date)) errors.push('วันที่ไม่ถูกต้อง');
    else if (row.date > today) errors.push('วันที่เกินวันนี้');
    if (!isValidTime(row.time_in)) errors.push('เวลาเข้างานไม่ถูกต้อง');
    if (isFilled(row.time_out) && !isValidTime(row.time_out)) errors.push('เวลาออกงานไม่ถูกต้อง');

    if (errors.length > 0) {
      results.push({
        lines: [line], employee_code: code, date: row.date || '', status: 'error', messages: errors,
      });
      return;
    }

    const key = `${code.toLowerCase()}|${row.date}`;
    if (!merged.has(key)) {
      merged.set(key, {
        lines: [], employee_code: code, date: row.date, ins: [], outs: [],
      });
    }
    const entry = merged.get(key);
    entry.lines.push(line);
    entry.ins.push(normalizeTime(row.time_in));
    if (isFilled(row.time_out)) entry.outs.push(normalizeTime(row.time_out));
  });

  // เวลาเข้า = เวลาที่เร็วที่สุด, เวลาออก = เวลาที่ช้าที่สุด (กรณีสแกนหลายครั้งต่อวัน)
  // ถ้ามีเวลาเดียว (สแกนครั้งเดียว) ถือเป็นเวลาเข้างาน ยังไม่มีเวลาออก
  const entries = [...merged.values()].map(({ ins, outs, ...entry }) => {
    const timeIn = ins.reduce(minTime, null);
    const candidates = ins.length > 1 ? [...outs, ...ins] : outs;
    const latest = candidates.reduce(maxTime, null);
    return { ...entry, time_in: timeIn, time_out: latest && latest > timeIn ? latest : null };
  });

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

  // 4) สรุปว่าแต่ละรายการจะ เพิ่มใหม่ / อัปเดต / ไม่เปลี่ยน
  const actions = [];
  for (const entry of entries) {
    const employee = employeesByCode.get(entry.employee_code.toLowerCase());
    if (!employee) {
      results.push({ ...entry, status: 'error', messages: [`ไม่พบรหัสพนักงาน ${entry.employee_code} ในระบบ`] });
      continue;
    }
    const name = `${employee.first_name} ${employee.last_name}`;
    const messages = employee.active ? [] : ['พนักงานคนนี้ปิดสถานะแล้ว'];
    const current = existing.get(`${employee.id}|${entry.date}`);

    if (!current) {
      actions.push({ type: 'create', employee, entry });
      results.push({ ...entry, employee_name: name, status: 'create', messages });
      continue;
    }

    const timeIn = minTime(current.time_in, entry.time_in);
    const timeOut = maxTime(current.time_out, entry.time_out);
    if (timeIn === current.time_in && timeOut === current.time_out) {
      results.push({ ...entry, employee_name: name, status: 'unchanged', messages: [...messages, 'ข้อมูลตรงกับที่มีอยู่แล้ว'] });
      continue;
    }
    actions.push({
      type: 'update', employee, entry, current, timeIn, timeOut,
    });
    results.push({
      ...entry,
      time_in: timeIn,
      time_out: timeOut,
      employee_name: name,
      status: 'update',
      messages: [...messages, `อัปเดตจากเดิม ${current.time_in.slice(0, 5)}-${current.time_out ? current.time_out.slice(0, 5) : '?'}`],
    });
  }

  results.sort((a, b) => a.lines[0] - b.lines[0]);
  const summary = {
    rows: inputRows.length,
    create: results.filter((row) => row.status === 'create').length,
    update: results.filter((row) => row.status === 'update').length,
    unchanged: results.filter((row) => row.status === 'unchanged').length,
    error: results.filter((row) => row.status === 'error').length,
  };

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
