// คำนวณเวลาทำงานของการลงเวลาแต่ละรายการ: สายกี่นาที, ออกก่อนกี่นาที, OT กี่นาที, ทำงานวันหยุดกี่นาที
const { isWorkingDay } = require('./dates');

// 'HH:MM' หรือ 'HH:MM:SS' -> จำนวนนาที (วินาทีเป็นเศษส่วน เพื่อให้เทียบกับเวลาที่มีวินาทีได้ถูกต้อง)
const toMinutes = (time) => {
  const [h, m, s = 0] = String(time).split(':').map(Number);
  return h * 60 + m + s / 60;
};

const dayType = (date, calendar) => {
  if (calendar.holidays.has(date)) return 'holiday';
  return isWorkingDay(date, calendar) ? 'workday' : 'weekend';
};

/**
 * record = { date, time_in, time_out }
 * คืนค่า:
 *  day_type        'workday' | 'weekend' | 'holiday'
 *  is_late         เข้างานหลังเวลาเข้างาน + เวลาผ่อนผัน (เฉพาะวันทำงาน)
 *  late_minutes    สายกี่นาที นับจากเวลาเข้างาน (ไม่หักเวลาผ่อนผัน)
 *  early_minutes   ออกก่อนเวลาเลิกงานกี่นาที (เฉพาะวันทำงาน)
 *  ot_minutes      ทำงานเกินเวลาเลิกงานกี่นาที (นับเมื่อถึง OT ขั้นต่ำ, เฉพาะวันทำงาน)
 *  holiday_minutes เวลาทำงานในวันหยุด/เสาร์-อาทิตย์ (เวลาออก - เวลาเข้า ไม่หักเวลาพัก)
 */
const recordMetrics = (record, settings, calendar) => {
  const type = dayType(record.date, calendar);
  const timeIn = toMinutes(record.time_in);
  const timeOut = record.time_out ? toMinutes(record.time_out) : null;
  const metrics = {
    day_type: type, is_late: false, late_minutes: 0, early_minutes: 0, ot_minutes: 0, holiday_minutes: 0,
  };

  if (type !== 'workday') {
    if (timeOut !== null) metrics.holiday_minutes = Math.max(0, Math.round(timeOut - timeIn));
    return metrics;
  }

  const start = toMinutes(settings.work_start_time);
  const end = toMinutes(settings.work_end_time);
  const threshold = start + Number(settings.late_grace_minutes || 0);

  if (timeIn > threshold) {
    metrics.is_late = true;
    metrics.late_minutes = Math.floor(timeIn - start);
  }
  if (timeOut !== null && timeOut < end) metrics.early_minutes = Math.ceil(end - timeOut);
  if (timeOut !== null) {
    const over = Math.floor(timeOut - end);
    if (over > 0 && over >= Number(settings.ot_min_minutes || 0)) metrics.ot_minutes = over;
  }
  return metrics;
};

module.exports = { toMinutes, dayType, recordMetrics };
