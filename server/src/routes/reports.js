// รายงาน: สรุปรายเดือน (มาทำงาน/สาย/ขาด/OT/ลา) และวันลาคงเหลือรายปี
const express = require('express');
const { pool } = require('../db');
const {
  LEAVE_TYPES, getSettings, lateThreshold, loadCalendar,
} = require('../settings');
const { todayStr, monthRange, countWorkingDays } = require('../dates');
const { computeBalances } = require('../balances');
const { buildMonthlyRows, employeeInfo } = require('../monthlyReport');
const { asyncHandler } = require('../http');
const { isFilled, isValidMonth, isPositiveInt } = require('../validate');

const router = express.Router();

// GET /api/reports/monthly?month=YYYY-MM&department=...
router.get('/monthly', asyncHandler(async (req, res) => {
  const today = todayStr();
  const month = isValidMonth(req.query.month) ? req.query.month : today.slice(0, 7);
  const { from, to } = monthRange(month);
  const settings = await getSettings();
  const calendar = await loadCalendar(from, to, settings);

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
  const rows = buildMonthlyRows({
    employees, attendance, leaves, from, to, today, settings, calendar,
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
