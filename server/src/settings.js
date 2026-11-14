// การตั้งค่าระบบ (เวลาเข้างาน, วันทำงาน, โควตาวันลา) และปฏิทินวันทำงาน/วันหยุด
const { pool } = require('./db');
const { normalizeTime } = require('./validate');

const LEAVE_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'อื่น ๆ'];
const LEAVE_STATUSES = ['pending', 'approved', 'rejected'];

// ค่าเริ่มต้น: โควตาวันลาตามขั้นต่ำของ พ.ร.บ.คุ้มครองแรงงาน (บริษัทปรับเพิ่มได้ในหน้าตั้งค่า)
const DEFAULT_SETTINGS = {
  company_name: '', // แสดงบนใบลาที่พิมพ์
  work_start_time: '08:30',
  work_end_time: '17:30',
  late_grace_minutes: 0,
  ot_min_minutes: 30, // ทำงานเกินเวลาเลิกงานอย่างน้อยกี่นาทีจึงนับเป็น OT
  work_days: [1, 2, 3, 4, 5], // 0 = อาทิตย์ ... 6 = เสาร์
  leave_quotas: { 'ลาป่วย': 30, 'ลากิจ': 3, 'ลาพักร้อน': 6 },
  // ลาพักร้อนได้เมื่อทำงานครบกี่เดือน (กฎหมายกำหนดเมื่อทำงานครบ 1 ปี)
  annual_leave_min_service_months: 12,
  // วันลาพักร้อนที่ไม่ได้ใช้ สะสมไปปีถัดไปได้สูงสุดกี่วัน (0 = ไม่สะสม)
  annual_leave_carry_over_max: 0,
};

const ANNUAL_LEAVE_TYPE = 'ลาพักร้อน';

const getSettings = async (db = pool) => {
  const [rows] = await db.query('SELECT `key`, `value` FROM settings');
  const settings = structuredClone(DEFAULT_SETTINGS);
  for (const row of rows) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      // ค่าเสียให้ใช้ค่าเริ่มต้น
    }
  }
  return settings;
};

// เวลาที่ถือว่า "สาย" = เวลาเข้างาน + เวลาผ่อนผัน (คืนค่าเป็น 'HH:MM:SS')
const lateThreshold = (settings) => {
  const [h, m] = normalizeTime(settings.work_start_time).split(':').map(Number);
  const total = h * 60 + m + Number(settings.late_grace_minutes || 0);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:00`;
};

// โหลดวันหยุดในช่วงวันที่ที่ต้องการ พร้อมวันทำงานในสัปดาห์
const loadCalendar = async (from, to, settings, db = pool) => {
  const [rows] = await db.query('SELECT `date`, `name` FROM holidays WHERE `date` BETWEEN ? AND ?', [from, to]);
  return {
    workDays: new Set(settings.work_days),
    holidays: new Map(rows.map((row) => [row.date, row.name])),
  };
};

module.exports = {
  ANNUAL_LEAVE_TYPE,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  DEFAULT_SETTINGS,
  getSettings,
  lateThreshold,
  loadCalendar,
};
