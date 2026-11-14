// รายงาน: สรุปรายเดือน (มาทำงาน/สาย/ขาด/OT/ลา) และวันลาคงเหลือรายปี
const express = require('express');
const { pool } = require('../db');
const {
  LEAVE_TYPES, getSettings, lateThreshold, loadCalendar,
} = require('../settings');
const {
  todayStr, monthRange, eachDate, isWorkingDay, countWorkingDays, leaveDaysInRange, maxDate, minDate,
} = require('../dates');
const { recordMetrics } = require('../worktime');
const { computeBalances } = require('../balances');
const { asyncHandler } = require('../http');
const { isFilled, isValidMonth, isPositiveInt } = require('../validate');

const router = express.Router();

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

// GET /api/reports/monthly?month=YYYY-MM&department=...
router.get('/monthly', asyncHandler(async (req, res) => {
  const today = todayStr();
  const month = isValidMonth(req.query.month) ? req.query.month : today.slice(0, 7);
  const { from, to } = monthRange(month);
  const settings = await getSettings();
  const calendar = await loadCalendar(from, to, settings);
  // นับวันขาดงานถึงแค่วันนี้ (วันที่ยังมาไม่ถึงยังไม่ถือว่าขาด)
  const countUntil = minDate(to, today);

  const params = [to, from, to, to, from];
  let departmentSql = '';
  if (isFilled(req.query.department)) {
    departmentSql = 'AND e.department = ?';
    params.push(String(req.query.department));
  }

  // พนักงานที่ทำงานอยู่ในเดือนนั้น หรือมีข้อมูลในเดือนนั้น (รวมคนที่ลาออกไปแล้ว)
  const [employees] = await pool.query(
    `SELECT e.* FROM employees e
     WHERE ((e.active = 1 AND COALESCE(e.start_date, DATE(e.created_at)) <= ?)
        OR EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.deleted_at IS NULL AND a.date BETWEEN ? AND ?)
        OR EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.deleted_at IS NULL
                   AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?))
       ${departmentSql}
     ORDER BY e.employee_code`,
    params,
  );

  const [attendance] = await pool.query(
    'SELECT employee_id, date, time_in, time_out FROM attendance WHERE deleted_at IS NULL AND date BETWEEN ? AND ?',
    [from, to],
  );
  const [leaves] = await pool.query(
    `SELECT employee_id, leave_type, start_date, end_date, half_day FROM leave_requests
     WHERE deleted_at IS NULL AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
    [to, from],
  );
  const attendanceByEmployee = groupBy(attendance, 'employee_id');
  const leavesByEmployee = groupBy(leaves, 'employee_id');

  const rows = employees.map((employee) => {
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

  res.json({
    month,
    from,
    to,
    working_days: countWorkingDays(from, to, calendar),
    late_after: lateThreshold(settings),
    work_start_time: settings.work_start_time,
    work_end_time: settings.work_end_time,
    ot_min_minutes: settings.ot_min_minutes,
    leave_types: LEAVE_TYPES,
    holidays: [...calendar.holidays.entries()].map(([date, name]) => ({ date, name })),
    rows,
  });
}));

// GET /api/reports/leave-balance?year=YYYY&department=...&employee_id=...
router.get('/leave-balance', asyncHandler(async (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year)) ? Number(req.query.year) : Number(todayStr().slice(0, 4));
  const settings = await getSettings();

  const params = [];
  let where = 'active = 1';
  if (isPositiveInt(req.query.employee_id)) {
    where = 'id = ?';
    params.push(Number(req.query.employee_id));
  }
  if (isFilled(req.query.department)) {
    where += ' AND department = ?';
    params.push(String(req.query.department));
  }
  const [employees] = await pool.query(`SELECT * FROM employees WHERE ${where} ORDER BY employee_code`, params);
  const balances = await computeBalances(employees, year, settings);

  const rows = employees.map((employee) => ({
    ...employeeInfo(employee),
    start_date: employee.start_date,
    ...balances.get(employee.id),
  }));

  res.json({
    year,
    leave_types: LEAVE_TYPES,
    quotas: settings.leave_quotas,
    annual_leave_min_service_months: settings.annual_leave_min_service_months,
    annual_leave_carry_over_max: settings.annual_leave_carry_over_max,
    rows,
  });
}));

module.exports = router;
