// ฟังก์ชันจัดการวันที่ (ใช้สตริง 'YYYY-MM-DD' ทั้งหมด และคำนวณแบบ UTC เพื่อไม่ให้ timezone ทำให้วันเลื่อน)
const config = require('./config');

// วันนี้ตามเขตเวลาของบริษัท (ค่าเริ่มต้น Asia/Bangkok)
const todayStr = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const parseDate = (value) => new Date(`${value}T00:00:00Z`);
const toDateStr = (date) => date.toISOString().slice(0, 10);

const addDays = (value, days) => {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateStr(date);
};

const dayOfWeek = (value) => parseDate(value).getUTCDay(); // 0 = อาทิตย์ ... 6 = เสาร์

const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

// ช่วงวันที่ของเดือน เช่น '2025-04' -> { from: '2025-04-01', to: '2025-04-30' }
const monthRange = (month) => {
  const [year, mon] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};

function* eachDate(from, to) {
  for (let current = from; current <= to; current = addDays(current, 1)) {
    yield current;
  }
}

// calendar = { workDays: Set ของเลขวัน (0-6), holidays: Map ของ 'YYYY-MM-DD' -> ชื่อวันหยุด }
const isWorkingDay = (value, calendar) => calendar.workDays.has(dayOfWeek(value)) && !calendar.holidays.has(value);

const countWorkingDays = (from, to, calendar) => {
  let count = 0;
  for (const date of eachDate(from, to)) {
    if (isWorkingDay(date, calendar)) count += 1;
  }
  return count;
};

// จำนวนวันลา (นับเฉพาะวันทำงาน) ของคำขอลาหนึ่งรายการ ภายในช่วง from..to
const leaveDaysInRange = (leave, from, to, calendar) => {
  const start = maxDate(leave.start_date, from);
  const end = minDate(leave.end_date, to);
  if (start > end) return 0;
  if (leave.half_day) return isWorkingDay(start, calendar) ? 0.5 : 0;
  return countWorkingDays(start, end, calendar);
};

module.exports = {
  todayStr,
  addDays,
  dayOfWeek,
  maxDate,
  minDate,
  monthRange,
  eachDate,
  isWorkingDay,
  countWorkingDays,
  leaveDaysInRange,
};
