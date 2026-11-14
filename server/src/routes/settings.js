// การตั้งค่าเวลางาน/โควตาวันลา (แก้ไขได้เฉพาะผู้ดูแลระบบ) และวันหยุด (HR จัดการได้)
const express = require('express');
const { pool } = require('../db');
const { logAudit, diff } = require('../audit');
const { requireAdmin } = require('../auth');
const { LEAVE_TYPES, getSettings } = require('../settings');
const { todayStr } = require('../dates');
const {
  asyncHandler, badRequest, notFound, parseId, rethrowDuplicate,
} = require('../http');
const {
  isFilled, isValidDate, isValidTime, normalizeTime,
} = require('../validate');

const settingsRouter = express.Router();
const holidaysRouter = express.Router();

settingsRouter.get('/', asyncHandler(async (req, res) => {
  res.json({ ...(await getSettings()), leave_types: LEAVE_TYPES });
}));

settingsRouter.put('/', requireAdmin, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const before = await getSettings();
  const errors = [];

  const companyName = isFilled(body.company_name) ? String(body.company_name).trim() : '';
  if (companyName.length > 150) errors.push('ชื่อบริษัทต้องไม่เกิน 150 ตัวอักษร');
  if (!isValidTime(body.work_start_time)) errors.push('รูปแบบเวลาเข้างานไม่ถูกต้อง');
  if (!isValidTime(body.work_end_time)) errors.push('รูปแบบเวลาเลิกงานไม่ถูกต้อง');
  if (isValidTime(body.work_start_time) && isValidTime(body.work_end_time)
    && normalizeTime(body.work_end_time) <= normalizeTime(body.work_start_time)) {
    errors.push('เวลาเลิกงานต้องอยู่หลังเวลาเข้างาน');
  }

  // ตัวเลขจำนวนเต็มในช่วงที่กำหนด (ถ้าไม่ส่งมา ใช้ค่าเดิม)
  const integerSetting = (key, label, min, max) => {
    if (body[key] === undefined || body[key] === '') return before[key];
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${label}ต้องเป็นจำนวนเต็ม ${min}-${max}`);
    }
    return value;
  };

  const grace = integerSetting('late_grace_minutes', 'เวลาผ่อนผันการมาสาย (นาที) ', 0, 240);
  const otMin = integerSetting('ot_min_minutes', 'OT ขั้นต่ำ (นาที) ', 0, 240);
  const serviceMonths = integerSetting('annual_leave_min_service_months', 'อายุงานขั้นต่ำก่อนลาพักร้อน (เดือน) ', 0, 60);
  const carryOver = integerSetting('annual_leave_carry_over_max', 'วันลาพักร้อนสะสมสูงสุด ', 0, 60);

  const workDays = Array.isArray(body.work_days) ? [...new Set(body.work_days.map(Number))].sort() : [];
  if (workDays.length === 0 || workDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    errors.push('กรุณาเลือกวันทำงานอย่างน้อย 1 วัน');
  }

  // โควตาวันลา: ตัวเลข 0-365 หรือเว้นว่าง (= ไม่จำกัด)
  const quotas = {};
  const inputQuotas = body.leave_quotas || {};
  for (const type of LEAVE_TYPES) {
    const value = inputQuotas[type];
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 365 || number * 2 !== Math.round(number * 2)) {
      errors.push(`โควตา${type}ต้องเป็นตัวเลข 0-365 (ใส่ทีละครึ่งวันได้)`);
    } else {
      quotas[type] = number;
    }
  }
  if (errors.length > 0) throw badRequest(errors);

  const after = {
    company_name: companyName,
    work_start_time: body.work_start_time.slice(0, 5),
    work_end_time: body.work_end_time.slice(0, 5),
    late_grace_minutes: grace,
    ot_min_minutes: otMin,
    work_days: workDays,
    leave_quotas: quotas,
    annual_leave_min_service_months: serviceMonths,
    annual_leave_carry_over_max: carryOver,
  };

  for (const [key, value] of Object.entries(after)) {
    await pool.query(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [key, JSON.stringify(value)],
    );
  }

  const changes = diff(
    Object.fromEntries(Object.entries(before).map(([k, v]) => [k, JSON.stringify(v)])),
    Object.fromEntries(Object.entries(after).map(([k, v]) => [k, JSON.stringify(v)])),
  );
  await logAudit(req, { action: 'update', entity: 'settings', details: changes });
  res.json({ message: 'บันทึกการตั้งค่าเรียบร้อย' });
}));

// ===================== วันหยุด =====================

holidaysRouter.get('/', asyncHandler(async (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year)) ? req.query.year : todayStr().slice(0, 4);
  const [rows] = await pool.query(
    'SELECT id, `date`, name FROM holidays WHERE `date` BETWEEN ? AND ? ORDER BY `date`',
    [`${year}-01-01`, `${year}-12-31`],
  );
  res.json({ items: rows, year: Number(year) });
}));

holidaysRouter.post('/', asyncHandler(async (req, res) => {
  const { date, name } = req.body || {};
  const errors = [];
  if (!isValidDate(date)) errors.push('กรุณากรอกวันที่ให้ถูกต้อง');
  if (!isFilled(name)) errors.push('กรุณากรอกชื่อวันหยุด');
  else if (String(name).trim().length > 100) errors.push('ชื่อวันหยุดต้องไม่เกิน 100 ตัวอักษร');
  if (errors.length > 0) throw badRequest(errors);

  let result;
  try {
    [result] = await pool.query('INSERT INTO holidays (`date`, name) VALUES (?, ?)', [date, String(name).trim()]);
  } catch (error) {
    rethrowDuplicate(error, 'วันที่นี้ถูกตั้งเป็นวันหยุดแล้ว');
  }
  await logAudit(req, {
    action: 'create', entity: 'holiday', entityId: result.insertId, details: { date, name },
  });
  res.status(201).json({ message: 'เพิ่มวันหยุดเรียบร้อย', id: result.insertId });
}));

// เพิ่มหลายวันพร้อมกัน (ใช้ตอนคัดลอกวันหยุดจากปีก่อน) วันที่ซ้ำกับที่มีอยู่แล้วจะถูกข้าม
holidaysRouter.post('/bulk', asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) throw badRequest(['ไม่มีวันหยุดที่จะเพิ่ม']);
  if (items.length > 100) throw badRequest(['เพิ่มได้ครั้งละไม่เกิน 100 วัน']);

  const errors = [];
  items.forEach((item, index) => {
    if (!isValidDate(item.date)) errors.push(`รายการที่ ${index + 1}: วันที่ไม่ถูกต้อง`);
    if (!isFilled(item.name) || String(item.name).trim().length > 100) errors.push(`รายการที่ ${index + 1}: ชื่อวันหยุดไม่ถูกต้อง`);
  });
  if (errors.length > 0) throw badRequest(errors);

  const created = [];
  const skipped = [];
  for (const item of items) {
    const name = String(item.name).trim();
    const [result] = await pool.query('INSERT IGNORE INTO holidays (`date`, name) VALUES (?, ?)', [item.date, name]);
    if (result.affectedRows > 0) created.push({ id: result.insertId, date: item.date, name });
    else skipped.push(item.date);
  }
  if (created.length > 0) {
    await logAudit(req, { action: 'create', entity: 'holiday', details: { คัดลอก: created.length, dates: created.map((item) => item.date).join(', ') } });
  }
  res.status(201).json({ message: `เพิ่มวันหยุด ${created.length} วัน`, created: created.length, skipped });
}));

holidaysRouter.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ไม่พบวันหยุด');
  const [rows] = await pool.query('SELECT `date`, name FROM holidays WHERE id = ?', [id]);
  if (rows.length === 0) throw notFound('ไม่พบวันหยุด');
  await pool.query('DELETE FROM holidays WHERE id = ?', [id]);
  await logAudit(req, {
    action: 'delete', entity: 'holiday', entityId: id, details: rows[0],
  });
  res.json({ message: 'ลบวันหยุดเรียบร้อย' });
}));

module.exports = { settingsRouter, holidaysRouter };
