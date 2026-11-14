// การเชื่อมต่อฐานข้อมูล MySQL (connection pool)
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  charset: 'utf8mb4',
  // คืนค่า DATE/DATETIME เป็นสตริงตรงๆ ป้องกันวันที่เลื่อนตาม timezone
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

// ให้ NOW() และ TIMESTAMP ในฐานข้อมูลเป็นเวลาไทย
pool.pool.on('connection', (connection) => {
  connection.query(`SET time_zone = '${config.dbTimezone.replace(/[^+\-0-9:]/g, '')}'`);
});

// รันหลายคำสั่งใน transaction เดียว ถ้ามีข้อผิดพลาดจะ rollback ทั้งหมด
const withTransaction = async (work) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { pool, withTransaction };
