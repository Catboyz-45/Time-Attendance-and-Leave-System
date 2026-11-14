// ฟังก์ชันตรวจสอบรูปแบบข้อมูลที่ใช้ร่วมกัน

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const isFilled = (value) => value !== undefined && value !== null && String(value).trim() !== '';

// วันที่ต้องเป็น YYYY-MM-DD และมีอยู่จริง (เช่น 2025-02-30 ไม่ผ่าน)
const isValidDate = (value) => {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

const isValidTime = (value) => typeof value === 'string' && TIME_RE.test(value);
const isValidMonth = (value) => typeof value === 'string' && MONTH_RE.test(value);

// 'HH:MM' -> 'HH:MM:00' เพื่อให้เทียบเวลาแบบสตริงได้
const normalizeTime = (value) => (value.length === 5 ? `${value}:00` : value);

const toBool = (value) => value === true || value === 1 || value === '1' || value === 'true';

const optionalText = (value) => (isFilled(value) ? String(value).trim() : null);

// ตรวจสอบ id ที่เป็นจำนวนเต็มบวก
const isPositiveInt = (value) => /^\d{1,10}$/.test(String(value ?? '').trim()) && Number(value) > 0;

module.exports = {
  isFilled,
  isValidDate,
  isValidTime,
  isValidMonth,
  normalizeTime,
  toBool,
  optionalText,
  isPositiveInt,
};
