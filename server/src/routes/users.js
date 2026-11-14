// จัดการบัญชีผู้ใช้ HR (เฉพาะผู้ดูแลระบบ)
const express = require('express');
const { pool } = require('../db');
const { logAudit, diff } = require('../audit');
const { hashPassword, validatePassword } = require('../auth');
const {
  asyncHandler, badRequest, notFound, parseId, rethrowDuplicate,
} = require('../http');
const { isFilled, toBool } = require('../validate');

const router = express.Router();
const ROLES = ['admin', 'hr'];
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,50}$/;

const USER_FIELDS = 'id, username, display_name, role, active, must_change_password, last_login_at, created_at';

const getUser = async (id) => {
  const [rows] = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`, [id]);
  if (rows.length === 0) throw notFound('ไม่พบผู้ใช้');
  return rows[0];
};

const countActiveAdmins = async () => {
  const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1");
  return count;
};

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT ${USER_FIELDS} FROM users ORDER BY active DESC, username`);
  res.json({ items: rows });
}));

// เพิ่มผู้ใช้ใหม่: รหัสผ่านที่ตั้งให้เป็นรหัสชั่วคราว ผู้ใช้ต้องเปลี่ยนเองตอน login ครั้งแรก
router.post('/', asyncHandler(async (req, res) => {
  const { username, display_name: displayName, role = 'hr', password } = req.body;
  const errors = [];
  if (!isFilled(username) || !USERNAME_RE.test(username)) {
    errors.push('ชื่อผู้ใช้ต้องมี 3-50 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด และขีดล่าง');
  }
  if (!isFilled(displayName)) errors.push('กรุณากรอกชื่อที่แสดง');
  else if (String(displayName).trim().length > 100) errors.push('ชื่อที่แสดงต้องไม่เกิน 100 ตัวอักษร');
  if (!ROLES.includes(role)) errors.push('สิทธิ์ไม่ถูกต้อง');
  const passwordError = validatePassword(password);
  if (passwordError) errors.push(passwordError);
  if (errors.length > 0) throw badRequest(errors);

  let result;
  try {
    [result] = await pool.query(
      'INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES (?, ?, ?, ?, 1)',
      [username, await hashPassword(password), String(displayName).trim(), role],
    );
  } catch (error) {
    rethrowDuplicate(error, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
  }

  await logAudit(req, {
    action: 'create', entity: 'user', entityId: result.insertId, details: { username, display_name: displayName, role },
  });
  res.status(201).json({ message: 'เพิ่มผู้ใช้เรียบร้อย', id: result.insertId });
}));

// แก้ไขชื่อ/สิทธิ์/สถานะ หรือรีเซ็ตรหัสผ่าน
router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบผู้ใช้');
  const before = await getUser(id);
  const body = req.body;

  const after = {
    display_name: isFilled(body.display_name) ? String(body.display_name).trim() : before.display_name,
    role: body.role ?? before.role,
    active: body.active === undefined ? before.active : (toBool(body.active) ? 1 : 0),
  };

  const errors = [];
  if (after.display_name.length > 100) errors.push('ชื่อที่แสดงต้องไม่เกิน 100 ตัวอักษร');
  if (!ROLES.includes(after.role)) errors.push('สิทธิ์ไม่ถูกต้อง');
  if (isFilled(body.password)) {
    const passwordError = validatePassword(body.password);
    if (passwordError) errors.push(passwordError);
  }
  if (id === req.user.id && (after.role !== 'admin' || !after.active)) {
    errors.push('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  }
  const removesAdmin = before.role === 'admin' && before.active && (after.role !== 'admin' || !after.active);
  if (removesAdmin && (await countActiveAdmins()) <= 1) {
    errors.push('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
  }
  if (errors.length > 0) throw badRequest(errors);

  await pool.query('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?', [
    after.display_name, after.role, after.active, id,
  ]);

  const details = diff(before, after);
  if (isFilled(body.password)) {
    await pool.query('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [
      await hashPassword(body.password), id,
    ]);
    details.password = 'รีเซ็ตรหัสผ่าน';
  }

  await logAudit(req, { action: 'update', entity: 'user', entityId: id, details });
  res.json({ message: 'บันทึกข้อมูลผู้ใช้เรียบร้อย' });
}));

module.exports = router;
