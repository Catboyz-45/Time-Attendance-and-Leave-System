// สรุปรายเดือนของพนักงานแต่ละคน: มาทำงาน, สาย, ออกก่อน, OT, ทำงานวันหยุด, ขาดงาน, วันลาแต่ละประเภท
// เป็นฟังก์ชันที่ไม่แตะฐานข้อมูล (route เป็นผู้โหลดข้อมูล) จึงใช้ร่วมกับโหมดทดลองบน GitHub Pages ได้
const { LEAVE_TYPES } = require('./settings');
const {
  eachDate, isWorkingDay, countWorkingDays, leaveDaysInRange, maxDate, minDate,
} = require('./dates');
const { recordMetrics } = require('./worktime');

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
};

const employeeInfo = (employee) => ({
  employee_id: employee.id,
  employee_code: employee.employee_code,
  first_name: employee.first_name,
  last_name: employee.last_name,
  department: employee.department,
  active: Boolean(employee.active),
});

/**
 * employees: พนักงานที่จะแสดงในรายงาน
 * attendance: การลงเวลาในเดือนนั้น { employee_id, date, time_in, time_out }
 * leaves: ใบลาที่อนุมัติแล้วที่ทับกับเดือนนั้น { employee_id, leave_type, start_date, end_date, half_day }
 */
const buildMonthlyRows = ({
  employees, attendance, leaves, from, to, today, settings, calendar,
}) => {
  // นับวันขาดงานถึงแค่วันนี้ (วันที่ยังมาไม่ถึงยังไม่ถือว่าขาด)
  const countUntil = minDate(to, today);
  const attendanceByEmployee = groupBy(attendance, 'employee_id');
  const leavesByEmployee = groupBy(leaves, 'employee_id');

  return employees.map((employee) => {
    const records = attendanceByEmployee.get(employee.id) || [];
    const employeeLeaves = leavesByEmployee.get(employee.id) || [];
    const recordByDate = new Map(records.map((row) => [row.date, row]));
    // นับวันทำงาน/ขาดงานตั้งแต่วันเริ่มงาน (ถ้าไม่ได้กรอก ใช้วันที่เพิ่มพนักงานเข้าระบบ)
    const firstDay = maxDate(from, employee.start_date || String(employee.created_at).slice(0, 10));

    // วันลาแยกตามประเภท และสัดส่วนที่ลาในแต่ละวัน (1 หรือ 0.5)
    const leaveDays = Object.fromEntries(LEAVE_TYPES.map((type) => [type, 0]));
    const leaveCoverage = new Map();
    for (const leave of employeeLeaves) {
      leaveDays[leave.leave_type] = (leaveDays[leave.leave_type] || 0) + leaveDaysInRange(leave, from, to, calendar);
      for (const date of eachDate(maxDate(leave.start_date, from), minDate(leave.end_date, to))) {
        leaveCoverage.set(date, Math.min(1, (leaveCoverage.get(date) || 0) + (leave.half_day ? 0.5 : 1)));
      }
    }

    // สรุปเวลาทำงานจากการลงเวลาแต่ละวัน
    const totals = {
      present_days: 0,
      late_days: 0,
      late_minutes: 0,
      early_leave_days: 0,
      early_minutes: 0,
      ot_minutes: 0,
      holiday_work_days: 0,
      holiday_minutes: 0,
      missing_out_days: 0,
      conflict_days: 0,
    };
    for (const record of records) {
      const metrics = recordMetrics(record, settings, calendar);
      if (!record.time_out && record.date < today) totals.missing_out_days += 1;
      if (metrics.day_type !== 'workday') {
        totals.holiday_work_days += 1;
        totals.holiday_minutes += metrics.holiday_minutes;
        continue;
      }
      totals.present_days += 1;
      if (metrics.is_late) {
        totals.late_days += 1;
        totals.late_minutes += metrics.late_minutes;
      }
      if (metrics.early_minutes > 0) {
        totals.early_leave_days += 1;
        totals.early_minutes += metrics.early_minutes;
      }
      totals.ot_minutes += metrics.ot_minutes;
      // มีทั้งการลงเวลาและการลาเต็มวันที่อนุมัติแล้วในวันเดียวกัน (ข้อมูลขัดกัน)
      if ((leaveCoverage.get(record.date) || 0) >= 1) totals.conflict_days += 1;
    }

    let absentDays = 0;
    if (firstDay <= countUntil) {
      for (const date of eachDate(firstDay, countUntil)) {
        if (isWorkingDay(date, calendar) && !recordByDate.has(date)) {
          absentDays += 1 - (leaveCoverage.get(date) || 0);
        }
      }
    }

    return {
      ...employeeInfo(employee),
      working_days: firstDay <= to ? countWorkingDays(firstDay, to, calendar) : 0,
      ...totals,
      absent_days: absentDays,
      leave_days: leaveDays,
      total_leave_days: Object.values(leaveDays).reduce((sum, days) => sum + days, 0),
    };
  });
};

module.exports = { buildMonthlyRows, employeeInfo };
