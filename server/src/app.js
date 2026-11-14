// ประกอบ Express app: ความปลอดภัย, session, API ทั้งหมด และหน้าเว็บ
const path = require('path');
const express = require('express');
const helmet = require('helmet');

const config = require('./config');
const auth = require('./auth');
const { HttpError } = require('./http');

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

// HTTP security headers: ห้ามโหลดสคริปต์จากภายนอก ฯลฯ
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // ไม่บังคับเปลี่ยนเป็น https (ระบบอาจเปิดใช้ในเครือข่ายภายในผ่าน http)
      upgradeInsecureRequests: null,
    },
  },
  strictTransportSecurity: config.cookieSecure,
}));

app.use(express.json({ limit: '2mb' }));

// API ไม่ให้ cache เพราะเป็นข้อมูลส่วนบุคคล
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api', auth.sessionMiddleware);
app.use('/api/auth', auth.router);

// ทุก API ด้านล่างนี้ต้อง login ก่อน
app.use('/api', auth.requireAuth);
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leave_requests', require('./routes/leave'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/import', require('./routes/import'));

const { settingsRouter, holidaysRouter } = require('./routes/settings');
app.use('/api/settings', settingsRouter);
app.use('/api/holidays', holidaysRouter);

// เฉพาะผู้ดูแลระบบ
app.use('/api/users', auth.requireAdmin, require('./routes/users'));
app.use('/api/audit', auth.requireAdmin, require('./routes/auditLogs'));

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'ไม่พบ API ที่เรียก' });
});

// หน้าเว็บ (โฟลเดอร์ public)
app.use(express.static(path.join(__dirname, '..', '..', 'public'), { extensions: ['html'] }));

// จัดการ error กลาง
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, errors: err.errors, ...err.extra });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'ข้อมูล JSON ไม่ถูกต้อง', errors: [] });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'ข้อมูลมีขนาดใหญ่เกินไป กรุณาแบ่งไฟล์', errors: [] });
  }
  console.error('error:', err);
  res.status(500).json({ message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง', errors: [] });
});

module.exports = app;
