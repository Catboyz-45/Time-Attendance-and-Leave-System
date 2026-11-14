// อัปเดตโครงสร้างฐานข้อมูลที่สร้างไว้แล้วให้ตรงกับเวอร์ชันปัจจุบัน (รันทุกครั้งตอนเริ่มเซิร์ฟเวอร์)
// แต่ละรายการตรวจก่อนว่าทำไปแล้วหรือยัง จึงรันซ้ำได้ปลอดภัย และไม่ต้องลบข้อมูลเดิม
// ถ้าแก้ database/schema.sql ให้เพิ่มรายการที่นี่ด้วย เพื่อให้ฐานข้อมูลที่ใช้งานอยู่ได้รับการอัปเดต
const { pool } = require('./db');

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows.length > 0;
};

const MIGRATIONS = [
  {
    name: 'เพิ่มช่องผู้อนุมัติ (leave_requests.approver_name)',
    isDone: () => columnExists('leave_requests', 'approver_name'),
    sql: 'ALTER TABLE leave_requests ADD COLUMN approver_name VARCHAR(100) NULL DEFAULT NULL AFTER status_note',
  },
];

const runMigrations = async () => {
  for (const migration of MIGRATIONS) {
    if (await migration.isDone()) continue;
    await pool.query(migration.sql);
    console.log(`[migrate] ${migration.name}`);
  }
};

module.exports = { runMigrations };
