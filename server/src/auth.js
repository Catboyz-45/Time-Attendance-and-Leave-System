// ระบบ login ของ HR: session ที่เก็บในฐานข้อมูล, ตรวจสิทธิ์, จำกัดการเดารหัสผ่าน
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');

const config = require('./config');
const { pool } = require('./db');
const { logAudit } = require('./audit');
const { HttpError, asyncHandler, badRequest } = require('./http');

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 12;

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

// hash หลอกสำหรับเทียบเมื่อไม่พบชื่อผู้ใช้ (สร้างครั้งเดียวตอนเริ่มเซิร์ฟเวอร์)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  }
  if (password.length > 72) return 'รหัสผ่านต้องไม่เกิน 72 ตัวอักษร';
  return null;
};

// ===================== session =====================

const sessionMaxAge = config.sessionHours * 60 * 60 * 1000;

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: sessionMaxAge,
  createDatabaseTable: true,
}, pool);

const sessionMiddleware = session({
  name: 'tals.sid',
  secret: config.sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true, // ต่ออายุ session ทุกครั้งที่ใช้งาน (หมดอายุเมื่อไม่ได้ใช้งานตามเวลาที่กำหนด)
  cookie: {
    httpOnly: true,
    sameSite: 'strict', // ป้องกัน CSRF: cookie ไม่ถูกส่งไปกับ request ที่มาจากเว็บอื่น
    secure: config.cookieSecure,
    maxAge: sessionMaxAge,
  },
});

// ===================== จำกัดการเดารหัสผ่าน =====================
// ผิดเกิน 5 ครั้งใน 15 นาที (ต่อ IP + ชื่อผู้ใช้) จะถูกล็อก 15 นาที

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const failedLogins = new Map();

const loginKey = (req, username) => `${req.ip}|${String(username).toLowerCase()}`;

const isLocked = (key) => {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOCK_MS) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED;
};

const recordFailure = (key) => {
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.first > LOCK_MS) {
    failedLogins.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
};

// ===================== middleware ตรวจสิทธิ์ =====================

const loadUser = async (id) => {
  const [rows] = await pool.query(
    'SELECT id, username, display_name, role, active, must_change_password FROM users WHERE id = ?',
    [id],
  );
  return rows[0] || null;
};

const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  display_name: user.display_name,
  role: user.role,
  must_change_password: Boolean(user.must_change_password),
});

// ต้อง login ก่อน (โหลดข้อมูลผู้ใช้ใหม่ทุกครั้ง เพื่อให้การปิดบัญชีมีผลทันที)
const requireAuth = asyncHandler(async (req, res, next) => {
  const userId = req.session && req.session.userId;
  const user = userId ? await loadUser(userId) : null;
  if (!user || !user.active) {
    if (req.session) req.session.destroy(() => {});
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }
  req.user = user;

  // ถ้าต้องเปลี่ยนรหัสผ่าน ให้ใช้ได้เฉพาะ API ของบัญชีตัวเอง
  if (user.must_change_password && !req.originalUrl.startsWith('/api/auth/')) {
    throw new HttpError(403, 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน', [], { code: 'MUST_CHANGE_PASSWORD' });
  }
  next();
});

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น'));
  }
  next();
};

// ===================== API /api/auth =====================

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) throw badRequest(['กรุณากรอกชื่อผู้ใช้และรหัสผ่าน']);

  const key = loginKey(req, username);
  if (isLocked(key)) {
    throw new HttpError(429, 'ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  const user = rows[0];
  // เทียบรหัสผ่านเสมอ (แม้ไม่พบผู้ใช้) เพื่อไม่ให้เดาได้จากเวลาตอบกลับว่ามีชื่อผู้ใช้นี้หรือไม่
  const hash = user ? user.password_hash : DUMMY_HASH;
  const passwordOk = await bcrypt.compare(password, hash);

  if (!user || !user.active || !passwordOk) {
    recordFailure(key);
    await logAudit(req, { action: 'login_failed', entity: 'user', entityId: user ? user.id : null, username });
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  failedLogins.delete(key);
  await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.userId = user.id;
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  req.user = user;
  await logAudit(req, { action: 'login', entity: 'user', entityId: user.id });
  res.json(publicUser(user));
}));

router.post('/logout', asyncHandler(async (req, res) => {
  if (req.session && req.session.userId) {
    const user = await loadUser(req.session.userId);
    if (user) {
      req.user = user;
      await logAudit(req, { action: 'logout', entity: 'user', entityId: user.id });
    }
  }
  if (req.session) {
    await new Promise((resolve) => req.session.destroy(() => resolve()));
  }
  res.clearCookie('tals.sid');
  res.json({ message: 'ออกจากระบบแล้ว' });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = req.body.new_password;

  const errors = [];
  if (!currentPassword) errors.push('กรุณากรอกรหัสผ่านปัจจุบัน');
  const passwordError = validatePassword(newPassword);
  if (passwordError) errors.push(passwordError);
  if (newPassword === currentPassword) errors.push('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  if (errors.length > 0) throw badRequest(errors);

  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    throw badRequest(['รหัสผ่านปัจจุบันไม่ถูกต้อง']);
  }

  await pool.query(
    'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [await hashPassword(newPassword), req.user.id],
  );
  await logAudit(req, { action: 'change_password', entity: 'user', entityId: req.user.id });
  res.json({ message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
}));

// ===================== สร้างผู้ดูแลระบบคนแรก =====================

const ensureAdminUser = async () => {
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM users');
  if (count > 0) return;

  const fromEnv = Boolean(config.admin.password);
  const password = fromEnv ? config.admin.password : crypto.randomBytes(9).toString('base64url');
  await pool.query(
    'INSERT INTO users (username, password_hash, display_name, role, must_change_password) VALUES (?, ?, ?, ?, ?)',
    [config.admin.username, await hashPassword(password), 'ผู้ดูแลระบบ', 'admin', fromEnv ? 0 : 1],
  );

  if (fromEnv) {
    console.log(`[setup] สร้างบัญชีผู้ดูแลระบบ "${config.admin.username}" ด้วยรหัสผ่านจาก ADMIN_PASSWORD แล้ว`);
  } else {
    console.log('============================================================');
    console.log('[setup] สร้างบัญชีผู้ดูแลระบบคนแรกแล้ว');
    console.log(`        ชื่อผู้ใช้: ${config.admin.username}`);
    console.log(`        รหัสผ่านชั่วคราว: ${password}`);
    console.log('        ระบบจะให้เปลี่ยนรหัสผ่านทันทีหลัง login ครั้งแรก');
    console.log('============================================================');
  }
};

module.exports = {
  router,
  sessionMiddleware,
  sessionStore,
  requireAuth,
  requireAdmin,
  hashPassword,
  validatePassword,
  ensureAdminUser,
};
