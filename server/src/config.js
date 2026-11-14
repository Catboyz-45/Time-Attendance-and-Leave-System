// อ่านค่าการตั้งค่าจาก environment variables (และไฟล์ .env ที่โฟลเดอร์หลักของโปรเจกต์ ถ้ามี)
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const env = process.env;

let sessionSecret = env.SESSION_SECRET || '';
if (!sessionSecret) {
  // ไม่มี SESSION_SECRET: สุ่มให้ชั่วคราว (ทุกคนจะต้อง login ใหม่เมื่อรีสตาร์ทเซิร์ฟเวอร์)
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] ไม่ได้ตั้งค่า SESSION_SECRET จึงสุ่มค่าชั่วคราวให้ กรุณาตั้งค่าในไฟล์ .env');
}

module.exports = {
  port: Number(env.PORT) || 3000,
  // เขตเวลาที่ใช้คำนวณ "วันนี้" และเวลาที่บันทึกในฐานข้อมูล
  timezone: env.APP_TIMEZONE || 'Asia/Bangkok',
  dbTimezone: env.DB_TIMEZONE || '+07:00',
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 8840,
    user: env.DB_USER || 'tals',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'webdb',
  },
  sessionSecret,
  sessionHours: Number(env.SESSION_HOURS) || 8,
  // ตั้งเป็น true เมื่อเปิดใช้งานผ่าน HTTPS
  cookieSecure: env.COOKIE_SECURE === 'true',
  // ตั้งเป็น true เมื่ออยู่หลัง reverse proxy (เช่น nginx) เพื่อให้ได้ IP จริงของผู้ใช้
  trustProxy: env.TRUST_PROXY === 'true',
  admin: {
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD || '',
  },
};
