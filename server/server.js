// นำเข้าไลบรารีที่ใช้ในโปรเจกต์
const path = require('path');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT) || 3000;

// รับข้อมูลแบบ JSON, เปิด CORS และเสิร์ฟหน้าเว็บจากโฟลเดอร์ public
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ใช้ connection pool แทน connection เดียว: ถ้า MySQL รีสตาร์ท pool จะต่อใหม่ให้เอง
// ค่าเริ่มต้นตรงกับ docker-compose.yml (MySQL เปิดที่พอร์ต 8840 บนเครื่อง)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 8840,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'webdb',
  charset: 'utf8mb4',
  // คืนค่า DATE เป็นสตริง 'YYYY-MM-DD' ตรงๆ ไม่แปลงเป็น Date object
  // (ถ้าแปลง วันที่จะถูกเลื่อนตาม timezone และถอยหลัง 1 วันเมื่อแปลงเป็น UTC)
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

// ===================== ฟังก์ชันช่วยตรวจสอบข้อมูล =====================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const LEAVE_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'อื่น ๆ'];

const isFilled = (value) => value !== undefined && value !== null && String(value).trim() !== '';

// วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD และมีอยู่จริง (เช่น 2025-02-30 ไม่ผ่าน)
const isValidDate = (value) => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date) && date.toISOString().startsWith(value);
};

const isValidTime = (value) => typeof value === 'string' && TIME_RE.test(value);

// แปลง 'HH:MM' เป็น 'HH:MM:00' เพื่อให้เทียบเวลาแบบสตริงได้
const normalizeTime = (value) => (value.length === 5 ? `${value}:00` : value);

const isValidEmployeeId = (value) => /^\d{1,9}$/.test(String(value).trim()) && Number(value) > 0;

// ตรวจสอบข้อมูลการเข้าออกงาน คืนค่า { errors, data } โดย data มีเฉพาะฟิลด์ที่อนุญาต
const validateAttendance = (body = {}) => {
  const errors = [];

  if (!isFilled(body.employee_id)) errors.push('กรุณากรอกรหัสพนักงาน');
  else if (!isValidEmployeeId(body.employee_id)) errors.push('รหัสพนักงานต้องเป็นตัวเลขเท่านั้น');

  if (!isFilled(body.date)) errors.push('กรุณากรอกวันที่');
  else if (!isValidDate(body.date)) errors.push('รูปแบบวันที่ไม่ถูกต้อง');

  if (!isFilled(body.time_in)) errors.push('กรุณากรอกเวลาเข้างาน');
  else if (!isValidTime(body.time_in)) errors.push('รูปแบบเวลาเข้างานไม่ถูกต้อง');

  // เวลาออกงานไม่บังคับ (ลงเวลาเข้างานไว้ก่อน แล้วกลับมาแก้ไขเพิ่มเวลาออกทีหลังได้)
  const hasTimeOut = isFilled(body.time_out);
  if (hasTimeOut && !isValidTime(body.time_out)) {
    errors.push('รูปแบบเวลาออกงานไม่ถูกต้อง');
  } else if (hasTimeOut && isValidTime(body.time_in)
    && normalizeTime(body.time_out) <= normalizeTime(body.time_in)) {
    errors.push('เวลาออกงานต้องอยู่หลังเวลาเข้างาน');
  }

  return {
    errors,
    data: {
      employee_id: Number(body.employee_id),
      date: body.date,
      time_in: body.time_in,
      time_out: hasTimeOut ? body.time_out : null,
    },
  };
};

// ตรวจสอบข้อมูลคำขอลา
const validateLeave = (body = {}) => {
  const errors = [];

  if (!isFilled(body.employee_id)) errors.push('กรุณากรอกรหัสพนักงาน');
  else if (!isValidEmployeeId(body.employee_id)) errors.push('รหัสพนักงานต้องเป็นตัวเลขเท่านั้น');

  if (!isFilled(body.leave_type)) errors.push('กรุณาเลือกประเภทการลา');
  else if (!LEAVE_TYPES.includes(body.leave_type)) errors.push('ประเภทการลาไม่ถูกต้อง');

  if (!isFilled(body.reason)) errors.push('กรุณากรอกเหตุผลการลา');
  else if (String(body.reason).length > 1000) errors.push('เหตุผลการลาต้องไม่เกิน 1000 ตัวอักษร');

  if (!isFilled(body.start_date)) errors.push('กรุณากรอกวันที่เริ่มลา');
  else if (!isValidDate(body.start_date)) errors.push('รูปแบบวันที่เริ่มลาไม่ถูกต้อง');

  if (!isFilled(body.end_date)) errors.push('กรุณากรอกวันที่สิ้นสุดลา');
  else if (!isValidDate(body.end_date)) errors.push('รูปแบบวันที่สิ้นสุดลาไม่ถูกต้อง');

  if (isValidDate(body.start_date) && isValidDate(body.end_date) && body.end_date < body.start_date) {
    errors.push('วันที่สิ้นสุดลาต้องไม่ก่อนวันที่เริ่มลา');
  }

  return {
    errors,
    data: {
      employee_id: Number(body.employee_id),
      leave_type: body.leave_type,
      reason: isFilled(body.reason) ? String(body.reason).trim() : body.reason,
      start_date: body.start_date,
      end_date: body.end_date,
    },
  };
};

// ===================== ตัวช่วยสร้าง API แบบ CRUD =====================

// Express 4 ไม่จับ error จากฟังก์ชัน async ให้เอง จึงต้องห่อด้วยฟังก์ชันนี้
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const isValidId = (id) => /^\d+$/.test(id);

// สร้าง GET / GET :id / POST / PUT :id / DELETE :id ให้ตารางหนึ่งตาราง
const registerCrudRoutes = ({ route, table, orderBy, validate, notFoundMessage }) => {
  // GET: ดึงข้อมูลทั้งหมด
  app.get(route, asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` ORDER BY ${orderBy}`);
    res.json(rows);
  }));

  // GET: ดึงข้อมูลตาม ID
  app.get(`${route}/:id`, asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: notFoundMessage });
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: notFoundMessage });
    res.json(rows[0]);
  }));

  // POST: เพิ่มข้อมูลใหม่
  app.post(route, asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors });
    }
    const [result] = await pool.query(`INSERT INTO \`${table}\` SET ?`, [data]);
    res.status(201).json({ message: 'บันทึกข้อมูลเรียบร้อย', id: result.insertId });
  }));

  // PUT: แก้ไขข้อมูลตาม ID (บันทึกเฉพาะฟิลด์ที่อนุญาต ไม่ใช้ req.body ตรงๆ)
  app.put(`${route}/:id`, asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: notFoundMessage });
    const { errors, data } = validate(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors });
    }
    const [result] = await pool.query(`UPDATE \`${table}\` SET ? WHERE id = ?`, [data, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: notFoundMessage });
    res.json({ message: 'แก้ไขข้อมูลเรียบร้อย' });
  }));

  // DELETE: ลบข้อมูลตาม ID
  app.delete(`${route}/:id`, asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: notFoundMessage });
    const [result] = await pool.query(`DELETE FROM \`${table}\` WHERE id = ?`, [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: notFoundMessage });
    res.json({ message: 'ลบข้อมูลเรียบร้อย' });
  }));
};

// ===================== API =====================

registerCrudRoutes({
  route: '/api/attendance',
  table: 'attendance',
  orderBy: 'date DESC, time_in DESC, id DESC',
  validate: validateAttendance,
  notFoundMessage: 'ไม่พบข้อมูลการลงเวลา',
});

registerCrudRoutes({
  route: '/api/leave_requests',
  table: 'leave_requests',
  orderBy: 'start_date DESC, id DESC',
  validate: validateLeave,
  notFoundMessage: 'ไม่พบข้อมูลคำขอลา',
});

// path ใต้ /api ที่ไม่มีอยู่จริง
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'ไม่พบ API ที่เรียก' });
});

// จัดการ error กลาง: JSON ผิดรูปแบบตอบ 400, error อื่นตอบ 500 โดยไม่ส่งรายละเอียดภายในออกไป
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'ข้อมูล JSON ไม่ถูกต้อง' });
  }
  console.error('error:', err.message);
  res.status(500).json({ message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง' });
});

// เริ่มเซิร์ฟเวอร์ แล้วลองเชื่อมต่อฐานข้อมูลเพื่อแจ้งสถานะ (ไม่ทำให้เซิร์ฟเวอร์ล่มถ้า DB ยังไม่พร้อม)
app.listen(port, async () => {
  console.log(`http server is running on http://localhost:${port}`);
  try {
    await pool.query('SELECT 1');
    console.log('connected to MySQL');
  } catch (error) {
    console.error('cannot connect to MySQL yet:', error.message);
  }
});
