// ตัวช่วยสำหรับ route: จัดการ error, pagination และ id

class HttpError extends Error {
  constructor(status, message, errors = [], extra = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.extra = extra;
  }
}

const badRequest = (errors) => new HttpError(400, 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors);
const notFound = (message = 'ไม่พบข้อมูล') => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);

// Express 4 ไม่จับ error จากฟังก์ชัน async ให้เอง จึงต้องห่อด้วยฟังก์ชันนี้
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// แปลง id จาก URL เป็นตัวเลข ถ้าไม่ใช่ตัวเลขถือว่าไม่พบข้อมูล
const parseId = (value, message) => {
  if (!/^\d{1,10}$/.test(String(value))) throw notFound(message);
  return Number(value);
};

// อ่าน page / page_size จาก query string
const parsePagination = (query, { defaultSize = 50, maxSize = 5000 } = {}) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.page_size, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

// ส่ง error ที่กำหนดเองเมื่อชนกับ unique key ในฐานข้อมูล
const rethrowDuplicate = (error, message) => {
  if (error && error.code === 'ER_DUP_ENTRY') throw conflict(message);
  throw error;
};

module.exports = {
  HttpError,
  badRequest,
  notFound,
  conflict,
  asyncHandler,
  parseId,
  parsePagination,
  rethrowDuplicate,
};
