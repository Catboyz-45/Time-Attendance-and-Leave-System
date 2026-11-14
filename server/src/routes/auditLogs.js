// ดูประวัติการแก้ไขข้อมูล (audit log) เฉพาะผู้ดูแลระบบ
const express = require('express');
const { pool } = require('../db');
const { asyncHandler, parsePagination } = require('../http');
const { isValidDate, isPositiveInt } = require('../validate');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query, { defaultSize: 50, maxSize: 500 });
  const where = [];
  const params = [];

  if (req.query.entity) { where.push('entity = ?'); params.push(String(req.query.entity)); }
  if (req.query.action) { where.push('action = ?'); params.push(String(req.query.action)); }
  if (isPositiveInt(req.query.user_id)) { where.push('user_id = ?'); params.push(Number(req.query.user_id)); }
  if (isPositiveInt(req.query.entity_id)) { where.push('entity_id = ?'); params.push(Number(req.query.entity_id)); }
  if (isValidDate(req.query.from)) { where.push('created_at >= ?'); params.push(`${req.query.from} 00:00:00`); }
  if (isValidDate(req.query.to)) { where.push('created_at <= ?'); params.push(`${req.query.to} 23:59:59`); }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT id, user_id, username, action, entity, entity_id, details, ip, created_at
     FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );

  res.json({ items: rows, total, page, page_size: pageSize });
}));

module.exports = router;
