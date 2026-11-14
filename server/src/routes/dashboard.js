// ข้อมูลหน้าภาพรวมของวันนี้: ใครมาสาย, ใครลา, ใครยังไม่ลงเวลา, คำขอลาที่รออนุมัติ
const express = require('express');
const { pool } = require('../db');
const { getSettings, lateThreshold, loadCalendar } = require('../settings');
const { todayStr, addDays, isWorkingDay } = require('../dates');
const { recordMetrics } = require('../worktime');
const { asyncHandler } = require('../http');

const router = express.Router();
const EMPLOYEE_COLUMNS = 'e.id AS employee_id, e.employee_code, e.first_name, e.last_name, e.department';

router.get('/', asyncHandler(async (req, res) => {
  const today = todayStr();
  const settings = await getSettings();
  const threshold = lateThreshold(settings);
  const calendar = await loadCalendar(today, today, settings);
  const workingDay = isWorkingDay(today, calendar);

  const [[{ activeEmployees }]] = await pool.query(
    'SELECT COUNT(*) AS activeEmployees FROM employees WHERE active = 1 AND (start_date IS NULL OR start_date <= ?)',
    [today],
  );

  const [attendanceToday] = await pool.query(
    `SELECT a.id, a.time_in, a.time_out, ${EMPLOYEE_COLUMNS}
     FROM attendance a JOIN employees e ON e.id = a.employee_id
     WHERE a.date = ? AND a.deleted_at IS NULL
     ORDER BY a.time_in`,
    [today],
  );

  const [onLeave] = await pool.query(
    `SELECT l.id, l.leave_type, l.start_date, l.end_date, l.half_day, ${EMPLOYEE_COLUMNS}
     FROM leave_requests l JOIN employees e ON e.id = l.employee_id
     WHERE l.status = 'approved' AND l.deleted_at IS NULL AND l.start_date <= ? AND l.end_date >= ?
     ORDER BY e.employee_code`,
    [today, today],
  );

  const [[{ pendingTotal }]] = await pool.query(
    "SELECT COUNT(*) AS pendingTotal FROM leave_requests WHERE status = 'pending' AND deleted_at IS NULL",
  );
  const [pending] = await pool.query(
    `SELECT l.id, l.leave_type, l.start_date, l.end_date, l.half_day, l.reason, ${EMPLOYEE_COLUMNS}
     FROM leave_requests l JOIN employees e ON e.id = l.employee_id
     WHERE l.status = 'pending' AND l.deleted_at IS NULL
     ORDER BY l.start_date, l.id LIMIT 10`,
  );

  // พนักงานที่ยังไม่ลงเวลาวันนี้ และไม่ได้ลาเต็มวัน (นับเฉพาะวันทำงาน)
  let notCheckedIn = [];
  if (workingDay) {
    [notCheckedIn] = await pool.query(
      `SELECT ${EMPLOYEE_COLUMNS}
       FROM employees e
       WHERE e.active = 1 AND (e.start_date IS NULL OR e.start_date <= ?)
         AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.date = ? AND a.deleted_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'approved'
                         AND l.deleted_at IS NULL AND l.half_day = 0 AND l.start_date <= ? AND l.end_date >= ?)
       ORDER BY e.employee_code`,
      [today, today, today, today],
    );
  }

  // วันก่อนหน้า (30 วันล่าสุด) ที่ลืมลงเวลาออก
  const [[{ missingOutPrevious }]] = await pool.query(
    `SELECT COUNT(*) AS missingOutPrevious FROM attendance
     WHERE time_out IS NULL AND deleted_at IS NULL AND date < ? AND date >= ?`,
    [today, addDays(today, -30)],
  );

  res.json({
    today,
    is_working_day: workingDay,
    holiday_name: calendar.holidays.get(today) || null,
    late_after: threshold,
    active_employees: activeEmployees,
    checked_in: attendanceToday.length,
    late: attendanceToday
      .map((row) => ({ ...row, ...recordMetrics({ ...row, date: today }, settings, calendar) }))
      .filter((row) => row.is_late),
    missing_out_today: attendanceToday.filter((row) => !row.time_out).length,
    missing_out_previous: missingOutPrevious,
    on_leave: onLeave.map((row) => ({ ...row, half_day: Boolean(row.half_day) })),
    pending_leaves: { total: pendingTotal, items: pending.map((row) => ({ ...row, half_day: Boolean(row.half_day) })) },
    not_checked_in: { total: notCheckedIn.length, items: notCheckedIn.slice(0, 50) },
  });
}));

module.exports = router;
