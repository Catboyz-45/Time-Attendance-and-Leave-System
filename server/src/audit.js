// บันทึก audit log: ใครทำอะไร กับข้อมูลไหน เมื่อไหร่
const { pool } = require('./db');

const logAudit = async (req, { action, entity, entityId = null, details = null, username = null }, db = pool) => {
  await db.query(
    'INSERT INTO audit_logs (user_id, username, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      req.user ? req.user.id : null,
      req.user ? req.user.username : username,
      action,
      entity,
      entityId,
      details ? JSON.stringify(details) : null,
      req.ip || null,
    ],
  );
};

// เก็บเฉพาะฟิลด์ที่เปลี่ยน: { field: { from, to } }
const diff = (before, after) => {
  const changes = {};
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (String(from) !== String(to)) changes[key] = { from, to };
  }
  return changes;
};

module.exports = { logAudit, diff };
