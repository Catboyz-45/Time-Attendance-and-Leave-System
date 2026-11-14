// คำขอลา: บันทึก, บันทึกผลอนุมัติ, นับวันลาเฉพาะวันทำงาน, เตือนเมื่อเกินสิทธิ์/ขัดกับการลงเวลา (ลบแบบ soft delete)
// การอนุมัติเกิดนอกระบบ (หัวหน้าเซ็นใบลา) HR เป็นผู้บันทึกผล:
//   approver_name = ผู้อนุมัติจริง, decided_by = บัญชี HR ที่บันทึกผล
const express = require('express');
const { pool } = require('../db');
const { logAudit, diff } = require('../audit');
const {
  ANNUAL_LEAVE_TYPE, LEAVE_TYPES, LEAVE_STATUSES, getSettings, loadCalendar,
} = require('../settings');
const { computeBalances } = require('../balances');
const { leaveDaysInRange, minDate, maxDate } = require('../dates');
const {
  asyncHandler, badRequest, notFound, parseId, parsePagination,
} = require('../http');
const {
  isFilled, isValidDate, optionalText, isPositiveInt, toBool,
} = require('../validate');

const router = express.Router();

// ใช้เวลาจากฐานข้อมูล (เขตเวลาไทย) แทนเวลาของเครื่องที่รัน Node
const SQL_NOW = { toSqlString: () => 'NOW()' };

const SELECT_SQL = `
  SELECT l.id, l.employee_id, l.leave_type, l.start_date, l.end_date, l.half_day, l.reason,
         l.status, l.status_note, l.approver_name, l.decided_at, l.created_at, l.updated_at,
         e.employee_code, e.first_name, e.last_name, e.department, e.position,
         u.display_name AS decided_by_name
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id
  LEFT JOIN users u ON u.id = l.decided_by`;

// เติมจำนวนวันลา (นับเฉพาะวันทำงาน ไม่รวมเสาร์-อาทิตย์และวันหยุด) ให้แต่ละรายการ
const withDays = async (rows, settings) => {
  if (rows.length === 0) return rows;
  const from = rows.reduce((acc, row) => minDate(acc, row.start_date), rows[0].start_date);
  const to = rows.reduce((acc, row) => maxDate(acc, row.end_date), rows[0].end_date);
  const calendar = await loadCalendar(from, to, settings);
  return rows.map((row) => ({
    ...row,
    half_day: Boolean(row.half_day),
    days: leaveDaysInRange(row, row.start_date, row.end_date, calendar),
  }));
};

// คำเตือนตอนบันทึก/อนุมัติการลา (ไม่บล็อกการบันทึก แต่ให้ HR ตรวจสอบก่อน)
const leaveWarnings = async (leave, days, settings, excludeId) => {
  const warnings = [];
  const [[employee]] = await pool.query('SELECT id, start_date FROM employees WHERE id = ?', [leave.employee_id]);
  if (!employee) return warnings;
  const year = Number(leave.start_date.slice(0, 4));
  const info = (await computeBalances([employee], year, settings, { excludeLeaveId: excludeId })).get(employee.id);

  // ลาพักร้อนก่อนทำงานครบตามเงื่อนไข
  if (leave.leave_type === ANNUAL_LEAVE_TYPE && info.eligible_from && leave.start_date < info.eligible_from) {
    warnings.push(`พนักงานยังทำงานไม่ครบ ${settings.annual_leave_min_service_months} เดือน `
      + `(มีสิทธิ์ลาพักร้อนตั้งแต่ ${info.eligible_from})`);
  }

  // ลาเกินสิทธิ์ของปี (ตรวจเมื่ออนุมัติ)
  const balance = info.balances[leave.leave_type];
  if (leave.status === 'approved' && balance && balance.remaining !== null && balance.remaining - days < 0) {
    warnings.push(`${leave.leave_type}ปี ${year} จะใช้รวม ${balance.used + days} วัน `
      + `เกินสิทธิ์ ${balance.quota + balance.carried} วัน`);
  }

  // มีการลงเวลาทำงานในวันที่ลาเต็มวัน
  if (leave.status !== 'rejected' && !Number(leave.half_day)) {
    const [rows] = await pool.query(
      `SELECT date FROM attendance WHERE employee_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ?
       ORDER BY date`,
      [leave.employee_id, leave.start_date, leave.end_date],
    );
    if (rows.length > 0) {
      warnings.push(`มีการลงเวลาทำงานในช่วงที่ลาแล้ว ${rows.length} วัน (${rows.map((row) => row.date).join(', ')}) `
        + 'กรุณาตรวจสอบว่าลาจริงหรือมาทำงาน');
    }
  }
  return warnings;
};

// เมื่อบันทึกผลว่าอนุมัติ/ไม่อนุมัติ ต้องระบุว่าใครเป็นผู้อนุมัติจริง (HR เป็นแค่ผู้บันทึก)
const validateApprover = (status, approverName) => {
  const errors = [];
  const name = optionalText(approverName);
  if ((status === 'approved' || status === 'rejected') && !name) {
    errors.push('กรุณาระบุผู้อนุมัติ (เช่น หัวหน้างานที่เซ็นใบลา)');
  }
  if (name && name.length > 100) errors.push('ชื่อผู้อนุมัติต้องไม่เกิน 100 ตัวอักษร');
  return errors;
};

const validateLeave = async (body = {}, settings, excludeId = 0) => {
  const errors = [];

  if (!isPositiveInt(body.employee_id)) {
    errors.push('กรุณาเลือกพนักงาน');
  } else {
    const [rows] = await pool.query('SELECT id FROM employees WHERE id = ?', [body.employee_id]);
    if (rows.length === 0) errors.push('ไม่พบพนักงานที่เลือก');
  }

  if (!isFilled(body.leave_type)) errors.push('กรุณาเลือกประเภทการลา');
  else if (!LEAVE_TYPES.includes(body.leave_type)) errors.push('ประเภทการลาไม่ถูกต้อง');

  if (!isFilled(body.reason)) errors.push('กรุณากรอกเหตุผลการลา');
  else if (String(body.reason).trim().length > 1000) errors.push('เหตุผลการลาต้องไม่เกิน 1000 ตัวอักษร');

  const startOk = isValidDate(body.start_date);
  const endOk = isValidDate(body.end_date);
  if (!isFilled(body.start_date)) errors.push('กรุณากรอกวันที่เริ่มลา');
  else if (!startOk) errors.push('รูปแบบวันที่เริ่มลาไม่ถูกต้อง');
  if (!isFilled(body.end_date)) errors.push('กรุณากรอกวันที่สิ้นสุดลา');
  else if (!endOk) errors.push('รูปแบบวันที่สิ้นสุดลาไม่ถูกต้อง');
  if (startOk && endOk && body.end_date < body.start_date) errors.push('วันที่สิ้นสุดลาต้องไม่ก่อนวันที่เริ่มลา');

  const halfDay = toBool(body.half_day);
  if (halfDay && startOk && endOk && body.start_date !== body.end_date) {
    errors.push('ลาครึ่งวันได้เฉพาะเมื่อวันเริ่มและวันสิ้นสุดเป็นวันเดียวกัน');
  }

  const status = body.status ?? 'pending';
  if (!LEAVE_STATUSES.includes(status)) errors.push('สถานะไม่ถูกต้อง');
  if (isFilled(body.status_note) && String(body.status_note).trim().length > 255) {
    errors.push('หมายเหตุการอนุมัติต้องไม่เกิน 255 ตัวอักษร');
  }
  errors.push(...validateApprover(status, body.approver_name));

  const data = {
    employee_id: Number(body.employee_id),
    leave_type: body.leave_type,
    start_date: body.start_date,
    end_date: body.end_date,
    half_day: halfDay ? 1 : 0,
    reason: optionalText(body.reason),
    status,
    status_note: optionalText(body.status_note),
    approver_name: optionalText(body.approver_name),
  };

  let days = 0;
  if (errors.length === 0) {
    // ต้องมีวันทำงานอย่างน้อย 1 วันในช่วงที่ลา
    const calendar = await loadCalendar(data.start_date, data.end_date, settings);
    days = leaveDaysInRange(data, data.start_date, data.end_date, calendar);
    if (days === 0) errors.push('ช่วงวันที่เลือกไม่มีวันทำงาน (ตรงกับวันหยุดทั้งหมด)');

    // ห้ามลาซ้อนกับรายการอื่นที่ยังไม่ถูกปฏิเสธ (ยกเว้นลาครึ่งวัน 2 รายการในวันเดียวกัน)
    if (status !== 'rejected') {
      const [overlaps] = await pool.query(
        `SELECT id, start_date, end_date, half_day FROM leave_requests
         WHERE employee_id = ? AND deleted_at IS NULL AND status <> 'rejected'
           AND start_date <= ? AND end_date >= ? AND id <> ?`,
        [data.employee_id, data.end_date, data.start_date, excludeId],
      );
      const twoHalfDays = halfDay && overlaps.length === 1 && overlaps[0].half_day;
      if (overlaps.length > 0 && !twoHalfDays) {
        errors.push(`ช่วงวันที่ซ้อนกับคำขอลาที่มีอยู่แล้ว (${overlaps[0].start_date} ถึง ${overlaps[0].end_date})`);
      }
    }
  }

  return { errors, data, days };
};

const getLeave = async (id, settings) => {
  const [rows] = await pool.query(`${SELECT_SQL} WHERE l.id = ? AND l.deleted_at IS NULL`, [id]);
  if (rows.length === 0) throw notFound('ไม่พบข้อมูลคำขอลา');
  const [leave] = await withDays(rows, settings);
  return leave;
};

// บันทึกผู้อนุมัติ/เวลาเมื่อสถานะเปลี่ยนเป็นอนุมัติหรือไม่อนุมัติ
const decisionFields = (newStatus, oldStatus, userId) => {
  if (newStatus === oldStatus) return {};
  if (newStatus === 'pending') return { decided_by: null, decided_at: null };
  return { decided_by: userId, decided_at: SQL_NOW };
};

// รายการคำขอลา: กรองพนักงาน, แผนก, ช่วงวันที่ (ที่ทับกัน), สถานะ, ประเภท, ค้นหาชื่อ/รหัส
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const settings = await getSettings();
  const where = ['l.deleted_at IS NULL'];
  const params = [];

  if (isPositiveInt(req.query.employee_id)) { where.push('l.employee_id = ?'); params.push(Number(req.query.employee_id)); }
  if (isFilled(req.query.department)) { where.push('e.department = ?'); params.push(String(req.query.department)); }
  if (isValidDate(req.query.from)) { where.push('l.end_date >= ?'); params.push(req.query.from); }
  if (isValidDate(req.query.to)) { where.push('l.start_date <= ?'); params.push(req.query.to); }
  if (LEAVE_STATUSES.includes(req.query.status)) { where.push('l.status = ?'); params.push(req.query.status); }
  if (LEAVE_TYPES.includes(req.query.leave_type)) { where.push('l.leave_type = ?'); params.push(req.query.leave_type); }
  if (isFilled(req.query.q)) {
    const like = `%${String(req.query.q).trim()}%`;
    where.push("(e.employee_code LIKE ? OR CONCAT(e.first_name, ' ', e.last_name) LIKE ?)");
    params.push(like, like);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM leave_requests l JOIN employees e ON e.id = l.employee_id ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(
    `${SELECT_SQL} ${whereSql} ORDER BY l.start_date DESC, l.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  res.json({
    items: await withDays(rows, settings), total, page, page_size: pageSize,
  });
}));

// รายชื่อผู้อนุมัติที่เคยบันทึกไว้ (ใช้เป็นตัวเลือกในช่องผู้อนุมัติ ไม่ต้องพิมพ์ใหม่ทุกครั้ง)
router.get('/approvers', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT approver_name, COUNT(*) AS uses FROM leave_requests
     WHERE approver_name IS NOT NULL AND approver_name <> '' AND deleted_at IS NULL
     GROUP BY approver_name ORDER BY uses DESC, approver_name LIMIT 200`,
  );
  res.json(rows.map((row) => row.approver_name));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await getLeave(parseId(req.params.id, 'ไม่พบข้อมูลคำขอลา'), await getSettings()));
}));

router.post('/', asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const { errors, data, days } = await validateLeave(req.body, settings);
  if (errors.length > 0) throw badRequest(errors);

  const warnings = await leaveWarnings(data, days, settings, 0);
  const [result] = await pool.query('INSERT INTO leave_requests SET ?', [{
    ...data,
    ...decisionFields(data.status, 'pending', req.user.id),
    created_by: req.user.id,
    updated_by: req.user.id,
  }]);
  await logAudit(req, {
    action: 'create', entity: 'leave', entityId: result.insertId, details: { ...data, days },
  });
  res.status(201).json({
    message: 'บันทึกคำขอลาเรียบร้อย', id: result.insertId, days, warnings,
  });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบข้อมูลคำขอลา');
  const settings = await getSettings();
  const before = await getLeave(id, settings);
  const { errors, data, days } = await validateLeave(req.body, settings, id);
  if (errors.length > 0) throw badRequest(errors);

  const warnings = await leaveWarnings(data, days, settings, id);
  await pool.query('UPDATE leave_requests SET ? WHERE id = ? AND deleted_at IS NULL', [{
    ...data,
    ...decisionFields(data.status, before.status, req.user.id),
    updated_by: req.user.id,
  }, id]);
  await logAudit(req, {
    action: 'update', entity: 'leave', entityId: id, details: diff({ ...before, half_day: before.half_day ? 1 : 0 }, data),
  });
  res.json({ message: 'แก้ไขคำขอลาเรียบร้อย', days, warnings });
}));

// บันทึกเฉพาะผลการอนุมัติ (ปุ่ม "บันทึกผล" จากหน้าภาพรวมและหน้าประวัติ)
router.patch('/:id/status', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบข้อมูลคำขอลา');
  const settings = await getSettings();
  const before = await getLeave(id, settings);
  const status = req.body.status;
  const statusNote = optionalText(req.body.status_note);
  const approverName = optionalText(req.body.approver_name);

  const errors = [];
  if (!LEAVE_STATUSES.includes(status)) errors.push('สถานะไม่ถูกต้อง');
  if (statusNote && statusNote.length > 255) errors.push('หมายเหตุการอนุมัติต้องไม่เกิน 255 ตัวอักษร');
  errors.push(...validateApprover(status, approverName));
  if (errors.length > 0) throw badRequest(errors);

  // ถ้าเปลี่ยนจาก "ไม่อนุมัติ" กลับมา ต้องตรวจว่าไม่ซ้อนกับรายการอื่น
  if (before.status === 'rejected' && status !== 'rejected') {
    const check = await validateLeave({ ...before, status, approver_name: approverName }, settings, id);
    if (check.errors.length > 0) throw badRequest(check.errors);
  }

  const warnings = await leaveWarnings({ ...before, status }, before.days, settings, id);
  await pool.query('UPDATE leave_requests SET ? WHERE id = ?', [{
    status,
    status_note: statusNote,
    approver_name: approverName,
    ...decisionFields(status, before.status, req.user.id),
    updated_by: req.user.id,
  }, id]);
  await logAudit(req, {
    action: 'status',
    entity: 'leave',
    entityId: id,
    details: diff(
      { status: before.status, approver_name: before.approver_name, status_note: before.status_note },
      { status, approver_name: approverName, status_note: statusNote },
    ),
  });
  res.json({ message: 'บันทึกผลการอนุมัติเรียบร้อย', warnings });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบข้อมูลคำขอลา');
  const before = await getLeave(id, await getSettings());
  await pool.query(
    'UPDATE leave_requests SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL',
    [req.user.id, id],
  );
  await logAudit(req, {
    action: 'delete',
    entity: 'leave',
    entityId: id,
    details: {
      employee_code: before.employee_code,
      leave_type: before.leave_type,
      start_date: before.start_date,
      end_date: before.end_date,
      status: before.status,
    },
  });
  res.json({ message: 'ลบคำขอลาเรียบร้อย' });
}));

module.exports = router;
