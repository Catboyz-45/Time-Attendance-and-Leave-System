// การลงเวลาเข้า-ออกงาน (HR บันทึกแทนพนักงาน, ลบแบบ soft delete)
const express = require('express');
const { pool } = require('../db');
const { logAudit, diff } = require('../audit');
const { getSettings, lateThreshold, loadCalendar } = require('../settings');
const { todayStr } = require('../dates');
const { recordMetrics } = require('../worktime');
const {
  asyncHandler, badRequest, notFound, parseId, parsePagination, rethrowDuplicate,
} = require('../http');
const {
  isFilled, isValidDate, isValidTime, normalizeTime, optionalText, isPositiveInt, toBool,
} = require('../validate');

const router = express.Router();
const DUPLICATE_MESSAGE = 'พนักงานคนนี้มีข้อมูลการลงเวลาของวันดังกล่าวแล้ว กรุณาแก้ไขรายการเดิมแทน';

// วันนั้นมีใบลาเต็มวันที่อนุมัติแล้ว (ถ้ามีการลงเวลาด้วย ถือว่าข้อมูลขัดกัน)
const ON_LEAVE_SQL = `EXISTS (SELECT 1 FROM leave_requests l
  WHERE l.employee_id = a.employee_id AND l.deleted_at IS NULL AND l.status = 'approved'
    AND l.half_day = 0 AND l.start_date <= a.date AND l.end_date >= a.date)`;

const SELECT_SQL = `
  SELECT a.id, a.employee_id, a.date, a.time_in, a.time_out, a.note, a.source,
         a.created_at, a.updated_at,
         e.employee_code, e.first_name, e.last_name, e.department,
         ${ON_LEAVE_SQL} AS on_leave
  FROM attendance a
  JOIN employees e ON e.id = a.employee_id`;

// เติมข้อมูลที่คำนวณได้: สายกี่นาที, OT, ออกก่อน, เป็นวันหยุดหรือไม่
const withMetrics = async (rows, settings) => {
  if (rows.length === 0) return rows;
  const dates = rows.map((row) => row.date).sort();
  const calendar = await loadCalendar(dates[0], dates[dates.length - 1], settings);
  return rows.map((row) => ({ ...row, on_leave: Boolean(row.on_leave), ...recordMetrics(row, settings, calendar) }));
};

// คำเตือนเมื่อวันที่ลงเวลามีใบลาเต็มวันที่อนุมัติแล้ว
const conflictWarnings = async (employeeId, date) => {
  const [rows] = await pool.query(
    `SELECT leave_type, start_date, end_date FROM leave_requests
     WHERE employee_id = ? AND deleted_at IS NULL AND status = 'approved' AND half_day = 0
       AND start_date <= ? AND end_date >= ?`,
    [employeeId, date, date],
  );
  return rows.map((leave) => `วันนี้พนักงานมี${leave.leave_type}ที่อนุมัติแล้ว (${leave.start_date} ถึง ${leave.end_date}) `
    + 'กรุณาตรวจสอบว่ามาทำงานจริงหรือไม่ ถ้ามาทำงานควรแก้ไขหรือยกเลิกใบลา');
};

// ตรวจสอบข้อมูล และตรวจว่ามีพนักงานคนนี้จริง
const validateAttendance = async (body = {}) => {
  const errors = [];

  if (!isPositiveInt(body.employee_id)) {
    errors.push('กรุณาเลือกพนักงาน');
  } else {
    const [rows] = await pool.query('SELECT id FROM employees WHERE id = ?', [body.employee_id]);
    if (rows.length === 0) errors.push('ไม่พบพนักงานที่เลือก');
  }

  if (!isFilled(body.date)) errors.push('กรุณากรอกวันที่');
  else if (!isValidDate(body.date)) errors.push('รูปแบบวันที่ไม่ถูกต้อง');
  else if (body.date > todayStr()) errors.push('วันที่ต้องไม่เกินวันนี้');

  if (!isFilled(body.time_in)) errors.push('กรุณากรอกเวลาเข้างาน');
  else if (!isValidTime(body.time_in)) errors.push('รูปแบบเวลาเข้างานไม่ถูกต้อง');

  const hasTimeOut = isFilled(body.time_out);
  if (hasTimeOut && !isValidTime(body.time_out)) {
    errors.push('รูปแบบเวลาออกงานไม่ถูกต้อง');
  } else if (hasTimeOut && isValidTime(body.time_in)
    && normalizeTime(body.time_out) <= normalizeTime(body.time_in)) {
    errors.push('เวลาออกงานต้องอยู่หลังเวลาเข้างาน');
  }

  if (isFilled(body.note) && String(body.note).trim().length > 255) errors.push('หมายเหตุต้องไม่เกิน 255 ตัวอักษร');

  return {
    errors,
    data: {
      employee_id: Number(body.employee_id),
      date: body.date,
      time_in: isValidTime(body.time_in) ? normalizeTime(body.time_in) : body.time_in,
      time_out: hasTimeOut && isValidTime(body.time_out) ? normalizeTime(body.time_out) : null,
      note: optionalText(body.note),
    },
  };
};

const getAttendance = async (id, settings) => {
  const [rows] = await pool.query(`${SELECT_SQL} WHERE a.id = ? AND a.deleted_at IS NULL`, [id]);
  if (rows.length === 0) throw notFound('ไม่พบข้อมูลการลงเวลา');
  const [record] = await withMetrics(rows, settings || await getSettings());
  return record;
};

// รายการลงเวลา: กรองตามพนักงาน, แผนก, ช่วงวันที่, คนมาสาย, ยังไม่ลงเวลาออก, ข้อมูลขัดกับใบลา, ค้นหาชื่อ/รหัส
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const settings = await getSettings();
  const threshold = lateThreshold(settings);
  const where = ['a.deleted_at IS NULL'];
  const params = [];

  if (isPositiveInt(req.query.employee_id)) { where.push('a.employee_id = ?'); params.push(Number(req.query.employee_id)); }
  if (isFilled(req.query.department)) { where.push('e.department = ?'); params.push(String(req.query.department)); }
  if (isValidDate(req.query.from)) { where.push('a.date >= ?'); params.push(req.query.from); }
  if (isValidDate(req.query.to)) { where.push('a.date <= ?'); params.push(req.query.to); }
  if (toBool(req.query.late)) {
    // มาสายนับเฉพาะวันทำงาน (ไม่รวมเสาร์-อาทิตย์/วันหยุด)
    where.push(`a.time_in > ? AND (DAYOFWEEK(a.date) - 1) IN (?)
      AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = a.date)`);
    params.push(threshold, settings.work_days);
  }
  if (toBool(req.query.missing_out)) where.push('a.time_out IS NULL');
  if (toBool(req.query.conflict)) where.push(ON_LEAVE_SQL);
  if (isFilled(req.query.q)) {
    const like = `%${String(req.query.q).trim()}%`;
    where.push("(e.employee_code LIKE ? OR CONCAT(e.first_name, ' ', e.last_name) LIKE ?)");
    params.push(like, like);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM attendance a JOIN employees e ON e.id = a.employee_id ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(
    `${SELECT_SQL} ${whereSql} ORDER BY a.date DESC, e.employee_code LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  res.json({
    items: await withMetrics(rows, settings), total, page, page_size: pageSize, late_after: threshold,
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await getAttendance(parseId(req.params.id, 'ไม่พบข้อมูลการลงเวลา')));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { errors, data } = await validateAttendance(req.body);
  if (errors.length > 0) throw badRequest(errors);

  let result;
  try {
    [result] = await pool.query('INSERT INTO attendance SET ?', [{
      ...data, source: 'manual', created_by: req.user.id, updated_by: req.user.id,
    }]);
  } catch (error) {
    rethrowDuplicate(error, DUPLICATE_MESSAGE);
  }
  await logAudit(req, { action: 'create', entity: 'attendance', entityId: result.insertId, details: data });
  res.status(201).json({
    message: 'บันทึกข้อมูลการลงเวลาเรียบร้อย',
    id: result.insertId,
    warnings: await conflictWarnings(data.employee_id, data.date),
  });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบข้อมูลการลงเวลา');
  const before = await getAttendance(id);
  const { errors, data } = await validateAttendance(req.body);
  if (errors.length > 0) throw badRequest(errors);

  try {
    await pool.query('UPDATE attendance SET ? WHERE id = ? AND deleted_at IS NULL', [
      { ...data, updated_by: req.user.id }, id,
    ]);
  } catch (error) {
    rethrowDuplicate(error, DUPLICATE_MESSAGE);
  }
  await logAudit(req, { action: 'update', entity: 'attendance', entityId: id, details: diff(before, data) });
  res.json({
    message: 'แก้ไขข้อมูลการลงเวลาเรียบร้อย',
    warnings: await conflictWarnings(data.employee_id, data.date),
  });
}));

// ลบแบบ soft delete: ข้อมูลยังอยู่ในฐานข้อมูลและดูย้อนหลังได้จาก audit log
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบข้อมูลการลงเวลา');
  const before = await getAttendance(id);
  await pool.query(
    'UPDATE attendance SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
    [req.user.id, id],
  );
  await logAudit(req, {
    action: 'delete',
    entity: 'attendance',
    entityId: id,
    details: {
      employee_code: before.employee_code, date: before.date, time_in: before.time_in, time_out: before.time_out,
    },
  });
  res.json({ message: 'ลบข้อมูลการลงเวลาเรียบร้อย' });
}));

module.exports = router;
