// ข้อมูลพนักงาน (ไม่มีการลบ: ใช้ปิดสถานะเมื่อพนักงานลาออก เพื่อเก็บประวัติไว้)
const express = require('express');
const { pool } = require('../db');
const { logAudit, diff } = require('../audit');
const {
  asyncHandler, badRequest, notFound, parseId, parsePagination, rethrowDuplicate,
} = require('../http');
const {
  isFilled, isValidDate, optionalText, toBool,
} = require('../validate');

const router = express.Router();
const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;

const validateEmployee = (body = {}) => {
  const errors = [];
  const code = isFilled(body.employee_code) ? String(body.employee_code).trim() : '';

  if (!code) errors.push('กรุณากรอกรหัสพนักงาน');
  else if (!CODE_RE.test(code)) errors.push('รหัสพนักงานใช้ได้เฉพาะ A-Z, 0-9, - และ _ ไม่เกิน 20 ตัว');

  if (!isFilled(body.first_name)) errors.push('กรุณากรอกชื่อ');
  if (!isFilled(body.last_name)) errors.push('กรุณากรอกนามสกุล');
  for (const [field, label] of [['first_name', 'ชื่อ'], ['last_name', 'นามสกุล'], ['department', 'แผนก'], ['position', 'ตำแหน่ง']]) {
    if (isFilled(body[field]) && String(body[field]).trim().length > 100) errors.push(`${label}ต้องไม่เกิน 100 ตัวอักษร`);
  }
  if (isFilled(body.start_date) && !isValidDate(body.start_date)) errors.push('รูปแบบวันที่เริ่มงานไม่ถูกต้อง');

  return {
    errors,
    data: {
      employee_code: code,
      first_name: optionalText(body.first_name),
      last_name: optionalText(body.last_name),
      department: optionalText(body.department),
      position: optionalText(body.position),
      start_date: isFilled(body.start_date) ? body.start_date : null,
      active: body.active === undefined ? 1 : (toBool(body.active) ? 1 : 0),
    },
  };
};

const getEmployee = async (id) => {
  const [rows] = await pool.query('SELECT * FROM employees WHERE id = ?', [id]);
  if (rows.length === 0) throw notFound('ไม่พบข้อมูลพนักงาน');
  return rows[0];
};

// รายชื่อพนักงาน: ค้นหาด้วย q (รหัส/ชื่อ/แผนก), กรอง active = 1 | 0 | all
router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query, { defaultSize: 50, maxSize: 5000 });
  const where = [];
  const params = [];

  const active = req.query.active ?? '1';
  if (active === '1' || active === '0') { where.push('active = ?'); params.push(Number(active)); }
  if (isFilled(req.query.department)) { where.push('department = ?'); params.push(String(req.query.department)); }
  if (isFilled(req.query.q)) {
    const like = `%${String(req.query.q).trim()}%`;
    where.push("(employee_code LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ? OR department LIKE ? OR position LIKE ?)");
    params.push(like, like, like, like);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM employees ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM employees ${whereSql} ORDER BY active DESC, employee_code LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  res.json({ items: rows, total, page, page_size: pageSize });
}));

// รายชื่อแผนกทั้งหมด (ใช้ทำตัวกรอง/ช่องเลือก)
router.get('/departments', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department <> '' ORDER BY department",
  );
  res.json(rows.map((row) => row.department));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await getEmployee(parseId(req.params.id, 'ไม่พบข้อมูลพนักงาน')));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { errors, data } = validateEmployee(req.body);
  if (errors.length > 0) throw badRequest(errors);

  let result;
  try {
    [result] = await pool.query('INSERT INTO employees SET ?', [data]);
  } catch (error) {
    rethrowDuplicate(error, 'รหัสพนักงานนี้มีอยู่แล้ว');
  }
  await logAudit(req, { action: 'create', entity: 'employee', entityId: result.insertId, details: data });
  res.status(201).json({ message: 'เพิ่มพนักงานเรียบร้อย', id: result.insertId });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบข้อมูลพนักงาน');
  const before = await getEmployee(id);
  const { errors, data } = validateEmployee({ active: before.active, ...req.body });
  if (errors.length > 0) throw badRequest(errors);

  try {
    await pool.query('UPDATE employees SET ? WHERE id = ?', [data, id]);
  } catch (error) {
    rethrowDuplicate(error, 'รหัสพนักงานนี้มีอยู่แล้ว');
  }
  await logAudit(req, { action: 'update', entity: 'employee', entityId: id, details: diff(before, data) });
  res.json({ message: 'บันทึกข้อมูลพนักงานเรียบร้อย' });
}));

module.exports = router;
