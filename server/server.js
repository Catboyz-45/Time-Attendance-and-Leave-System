// จุดเริ่มต้นของเซิร์ฟเวอร์: รอฐานข้อมูลพร้อม, สร้างผู้ดูแลระบบคนแรก (ถ้ายังไม่มี) แล้วเปิดรับ request
const config = require('./src/config');
const { pool } = require('./src/db');
const { ensureAdminUser } = require('./src/auth');
const app = require('./src/app');

const waitForDatabase = async (retries = 30) => {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await pool.query('SELECT 1 FROM users LIMIT 1');
      return;
    } catch (error) {
      if (attempt === retries) throw error;
      console.log(`รอฐานข้อมูล... (${attempt}/${retries}) ${error.code || error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

const start = async () => {
  await waitForDatabase();
  console.log('connected to MySQL');
  await ensureAdminUser();
  app.listen(config.port, () => {
    console.log(`http server is running on http://localhost:${config.port}`);
  });
};

start().catch((error) => {
  console.error('ไม่สามารถเริ่มเซิร์ฟเวอร์ได้:', error.message);
  console.error('ตรวจสอบว่า MySQL เปิดอยู่ และได้สร้างตารางจาก database/schema.sql แล้ว');
  process.exit(1);
});
