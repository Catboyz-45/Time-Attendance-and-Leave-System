// สิทธิ์วันลาของพนักงานในแต่ละปี: โควตา, วันลาพักร้อนสะสมจากปีก่อน, ใช้ไป, รออนุมัติ, คงเหลือ
// ใช้ร่วมกันทั้งรายงานวันลาคงเหลือ, คำเตือนตอนบันทึกการลา และหน้าพิมพ์ใบลา
const { pool } = require('./db');
const { LEAVE_TYPES, ANNUAL_LEAVE_TYPE, loadCalendar } = require('./settings');
const { leaveDaysInRange } = require('./dates');

// สะสมย้อนหลังได้ไม่เกินกี่ปี (จำกัดไว้เพื่อไม่ให้คำนวณย้อนไปไกลเกินจำเป็น)
const CARRY_LOOKBACK_YEARS = 5;

// วันที่เริ่มมีสิทธิ์ลาพักร้อน = วันเริ่มงาน + จำนวนเดือนที่กำหนด (null = ไม่ได้กรอกวันเริ่มงาน ถือว่ามีสิทธิ์)
const annualEligibleFrom = (employee, settings) => {
  if (!employee.start_date) return null;
  const [y, m, d] = employee.start_date.split('-').map(Number);
  const months = Number(settings.annual_leave_min_service_months || 0);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  // เช่น 31 ม.ค. + 1 เดือน: ไม่มีวันที่ 31 ก.พ. ให้ใช้วันสุดท้ายของเดือนแทน
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
};

// โควตาลาพักร้อนของปี: ได้เต็มจำนวนในปีที่ทำงานครบตามเงื่อนไข ปีก่อนหน้านั้นได้ 0
const annualQuotaForYear = (year, eligibleFrom, settings) => {
  const base = settings.leave_quotas[ANNUAL_LEAVE_TYPE];
  if (base === undefined || base === null) return null;
  if (eligibleFrom && eligibleFrom > `${year}-12-31`) return 0;
  return base;
};

/**
 * คำนวณสิทธิ์วันลาจากข้อมูลที่โหลดมาแล้ว (ไม่แตะฐานข้อมูล ใช้ร่วมกับโหมดทดลองบน GitHub Pages ได้)
 * employees: แถวจากตาราง employees (ต้องมี id, start_date)
 * leaves: คำขอลาที่ไม่ใช่ "ไม่อนุมัติ" ตั้งแต่ปี firstYearFor(year) ถึงปี year
 * calendar: ปฏิทินตั้งแต่ปี firstYearFor(year) ถึงปี year
 * คืนค่า Map(employee_id -> { eligible_from, balances: { [ประเภท]: { quota, carried, used, pending, remaining } } })
 *   quota = null หมายถึงไม่จำกัด, remaining = quota + carried - used (ไม่รวมที่รออนุมัติ)
 */
const firstYearFor = (year, settings) => (Number(settings.annual_leave_carry_over_max || 0) > 0
  ? year - CARRY_LOOKBACK_YEARS : year);

const buildBalances = (employees, leaves, year, settings, calendar) => {
  const result = new Map();
  const carryMax = Number(settings.annual_leave_carry_over_max || 0);
  const firstYear = firstYearFor(year, settings);
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;

  const leavesByEmployee = new Map();
  for (const leave of leaves) {
    if (!leavesByEmployee.has(leave.employee_id)) leavesByEmployee.set(leave.employee_id, []);
    leavesByEmployee.get(leave.employee_id).push(leave);
  }

  for (const employee of employees) {
    const employeeLeaves = leavesByEmployee.get(employee.id) || [];
    const eligibleFrom = annualEligibleFrom(employee, settings);

    const balances = {};
    for (const type of LEAVE_TYPES) {
      const quota = type === ANNUAL_LEAVE_TYPE
        ? annualQuotaForYear(year, eligibleFrom, settings)
        : (settings.leave_quotas[type] ?? null);
      balances[type] = {
        quota, carried: 0, used: 0, pending: 0, remaining: null,
      };
    }

    for (const leave of employeeLeaves) {
      const balance = balances[leave.leave_type];
      if (!balance) continue;
      const days = leaveDaysInRange(leave, yearFrom, yearTo, calendar);
      if (leave.status === 'approved') balance.used += days;
      else balance.pending += days;
    }

    // วันลาพักร้อนที่เหลือของแต่ละปี สะสมไปปีถัดไปได้ไม่เกิน carryMax วัน
    const annual = balances[ANNUAL_LEAVE_TYPE];
    if (carryMax > 0 && annual && annual.quota !== null) {
      let carry = 0;
      const startYear = Math.max(firstYear, eligibleFrom ? Number(eligibleFrom.slice(0, 4)) : firstYear);
      for (let y = startYear; y < year; y += 1) {
        const used = employeeLeaves
          .filter((leave) => leave.leave_type === ANNUAL_LEAVE_TYPE && leave.status === 'approved')
          .reduce((sum, leave) => sum + leaveDaysInRange(leave, `${y}-01-01`, `${y}-12-31`, calendar), 0);
        carry = Math.min(Math.max(annualQuotaForYear(y, eligibleFrom, settings) + carry - used, 0), carryMax);
      }
      annual.carried = carry;
    }

    for (const balance of Object.values(balances)) {
      if (balance.quota !== null) balance.remaining = balance.quota + balance.carried - balance.used;
    }
    result.set(employee.id, { eligible_from: eligibleFrom, balances });
  }
  return result;
};

// โหลดคำขอลาและวันหยุดจากฐานข้อมูล แล้วคำนวณด้วย buildBalances
const computeBalances = async (employees, year, settings, { excludeLeaveId = 0 } = {}) => {
  if (employees.length === 0) return new Map();
  const firstYear = firstYearFor(year, settings);
  const yearTo = `${year}-12-31`;

  const [leaves] = await pool.query(
    `SELECT employee_id, leave_type, start_date, end_date, half_day, status FROM leave_requests
     WHERE deleted_at IS NULL AND status <> 'rejected' AND employee_id IN (?)
       AND start_date <= ? AND end_date >= ? AND id <> ?`,
    [employees.map((employee) => employee.id), yearTo, `${firstYear}-01-01`, excludeLeaveId],
  );
  const calendar = await loadCalendar(`${firstYear}-01-01`, yearTo, settings);
  return buildBalances(employees, leaves, year, settings, calendar);
};

module.exports = {
  computeBalances, buildBalances, annualEligibleFrom, firstYearFor,
};
