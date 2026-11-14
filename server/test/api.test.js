// ทดสอบ API แบบ end-to-end กับเซิร์ฟเวอร์ที่รันอยู่
// ⚠️ ใช้กับฐานข้อมูลทดสอบเท่านั้น (สคริปต์จะสร้างพนักงาน/ข้อมูลทดสอบในเดือน มี.ค. 2568 และเปลี่ยนการตั้งค่า)
//
// วิธีรัน:
//   TEST_USERNAME=admin TEST_PASSWORD=<รหัสผ่าน> npm test
//   ถ้าบัญชียังต้องเปลี่ยนรหัสผ่าน ให้ใส่ TEST_NEW_PASSWORD=<รหัสใหม่> ด้วย
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RUN_ID = Date.now().toString(36).slice(-6).toUpperCase();
const DEPARTMENT = `ทดสอบ-${RUN_ID}`;
const APPROVER = 'คุณประเสริฐ (หัวหน้าฝ่าย)';

// fetch ที่จำ cookie ของ session ไว้ (แยกตามผู้ใช้)
const createClient = () => {
  let cookie = '';
  const request = async (method, path, body, { raw = false } = {}) => {
    const headers = cookie ? { Cookie: cookie } : {};
    if (raw) headers['Content-Type'] = 'application/octet-stream';
    else if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers,
      body: raw ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };
  return request;
};

const admin = createClient();
const state = { holidayIds: [] };

after(async () => {
  for (const id of state.holidayIds) await admin('DELETE', `/holidays/${id}`);
});

const addAttendance = async (employeeId, date, timeIn, timeOut = '') => {
  const res = await admin('POST', '/attendance', {
    employee_id: employeeId, date, time_in: timeIn, time_out: timeOut,
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
};

test('ต้อง login ก่อนใช้ API', async () => {
  const anonymous = createClient();
  const res = await anonymous('GET', '/employees');
  assert.equal(res.status, 401);
});

test('login ผิดรหัสผ่านได้ 401', async () => {
  const res = await createClient()('POST', '/auth/login', { username: process.env.TEST_USERNAME || 'admin', password: 'wrong-password' });
  assert.equal(res.status, 401);
});

test('admin login (และเปลี่ยนรหัสผ่านถ้าจำเป็น)', async () => {
  const username = process.env.TEST_USERNAME || 'admin';
  const res = await admin('POST', '/auth/login', { username, password: process.env.TEST_PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.role, 'admin');

  if (res.data.must_change_password) {
    const blocked = await admin('GET', '/employees');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'MUST_CHANGE_PASSWORD');

    assert.ok(process.env.TEST_NEW_PASSWORD, 'ต้องตั้ง TEST_NEW_PASSWORD เพราะบัญชีนี้ต้องเปลี่ยนรหัสผ่าน');
    const changed = await admin('POST', '/auth/change-password', {
      current_password: process.env.TEST_PASSWORD, new_password: process.env.TEST_NEW_PASSWORD,
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
  }
  const me = await admin('GET', '/auth/me');
  assert.equal(me.data.must_change_password, false);
});

test('ตั้งค่า: เวลางาน 08:30–17:30, OT ขั้นต่ำ 30 นาที, ลาพักร้อนเมื่อครบ 12 เดือน, สะสมได้ 3 วัน', async () => {
  const res = await admin('PUT', '/settings', {
    company_name: 'บริษัททดสอบ',
    work_start_time: '08:30',
    work_end_time: '17:30',
    late_grace_minutes: 0,
    ot_min_minutes: 30,
    work_days: [1, 2, 3, 4, 5],
    leave_quotas: { 'ลาป่วย': 30, 'ลากิจ': 3, 'ลาพักร้อน': 6 },
    annual_leave_min_service_months: 12,
    annual_leave_carry_over_max: 3,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const bad = await admin('PUT', '/settings', {
    work_start_time: '18:00', work_end_time: '08:00', late_grace_minutes: -1, ot_min_minutes: 999, work_days: [], leave_quotas: {},
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.length >= 4);
});

test('วันหยุด: เพิ่ม, ซ้ำไม่ได้, เพิ่มหลายวัน (ข้ามวันที่มีแล้ว)', async () => {
  const res = await admin('POST', '/holidays', { date: '2025-03-05', name: `วันหยุดทดสอบ ${RUN_ID}` });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  state.holidayIds.push(res.data.id);
  const duplicate = await admin('POST', '/holidays', { date: '2025-03-05', name: 'ซ้ำ' });
  assert.equal(duplicate.status, 409);

  const bulk = await admin('POST', '/holidays/bulk', {
    items: [{ date: '2025-03-05', name: 'ซ้ำ' }, { date: '2025-12-30', name: `วันหยุดคัดลอก ${RUN_ID}` }],
  });
  assert.equal(bulk.status, 201, JSON.stringify(bulk.data));
  assert.equal(bulk.data.created, 1);
  assert.deepEqual(bulk.data.skipped, ['2025-03-05']);
  const list = await admin('GET', '/holidays?year=2025');
  const copied = list.data.items.find((item) => item.date === '2025-12-30');
  state.holidayIds.push(copied.id);
});

test('พนักงาน: เพิ่ม, รหัสซ้ำ, ตรวจข้อมูล', async () => {
  const add = async (prefix, firstName, startDate) => {
    const res = await admin('POST', '/employees', {
      employee_code: `${prefix}${RUN_ID}`, first_name: firstName, last_name: 'ทดสอบ', department: DEPARTMENT, position: 'พนักงาน', start_date: startDate,
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    return res.data.id;
  };
  state.a = await add('A', 'สมชาย', '2020-01-01');
  state.b = await add('B', 'สมหญิง', '2020-01-01');
  state.c = await add('C', 'มานี', '2025-01-15'); // เริ่มงานปี 2025 ยังลาพักร้อนไม่ได้ในปีนั้น

  const duplicate = await admin('POST', '/employees', { employee_code: `A${RUN_ID}`, first_name: 'x', last_name: 'y' });
  assert.equal(duplicate.status, 409);

  const invalid = await admin('POST', '/employees', { employee_code: 'มีช่องว่าง 1', first_name: '' });
  assert.equal(invalid.status, 400);

  const search = await admin('GET', `/employees?q=${encodeURIComponent(`A${RUN_ID}`)}`);
  assert.equal(search.data.total, 1);
});

test('ลงเวลา: สาย/ออกก่อน/OT/ทำงานวันหยุด, ห้ามซ้ำ, ห้ามวันในอนาคต', async () => {
  await addAttendance(state.a, '2025-03-03', '08:20', '17:30'); // ปกติ
  await addAttendance(state.a, '2025-03-04', '08:45', '17:30'); // สาย 15 นาที
  state.attendanceMar6 = (await addAttendance(state.a, '2025-03-06', '08:30')).id; // ยังไม่ลงเวลาออก
  await addAttendance(state.a, '2025-03-07', '08:30', '19:00'); // OT 90 นาที
  await addAttendance(state.a, '2025-03-08', '09:00', '12:00'); // วันเสาร์ ทำงาน 180 นาที
  await addAttendance(state.a, '2025-03-13', '08:30', '16:30'); // ออกก่อน 60 นาที
  await addAttendance(state.a, '2025-03-14', '08:30', '17:50'); // เกินเวลา 20 นาที ไม่ถึง OT ขั้นต่ำ

  const duplicate = await admin('POST', '/attendance', { employee_id: state.a, date: '2025-03-03', time_in: '09:00' });
  assert.equal(duplicate.status, 409);

  const future = await admin('POST', '/attendance', { employee_id: state.a, date: '2999-01-01', time_in: '09:00' });
  assert.equal(future.status, 400);

  // มาสายนับเฉพาะวันทำงาน (วันเสาร์ 09:00 ไม่นับ)
  const late = await admin('GET', `/attendance?employee_id=${state.a}&late=1`);
  assert.equal(late.data.total, 1);
  assert.equal(late.data.items[0].date, '2025-03-04');
  assert.equal(late.data.items[0].late_minutes, 15);

  const all = await admin('GET', `/attendance?employee_id=${state.a}`);
  const byDate = Object.fromEntries(all.data.items.map((row) => [row.date, row]));
  assert.equal(byDate['2025-03-07'].ot_minutes, 90);
  assert.equal(byDate['2025-03-14'].ot_minutes, 0);
  assert.equal(byDate['2025-03-13'].early_minutes, 60);
  assert.equal(byDate['2025-03-08'].day_type, 'weekend');
  assert.equal(byDate['2025-03-08'].holiday_minutes, 180);
  assert.equal(byDate['2025-03-08'].is_late, false);
});

test('การลา: นับเฉพาะวันทำงาน, ห้ามซ้อน, ห้ามลาเฉพาะวันหยุด, ต้องระบุผู้อนุมัติ, เตือนเกินสิทธิ์', async () => {
  const sick = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลาป่วย', reason: 'ไข้หวัด', start_date: '2025-03-10', end_date: '2025-03-11', status: 'pending',
  });
  assert.equal(sick.status, 201, JSON.stringify(sick.data));
  assert.equal(sick.data.days, 2);
  state.sickLeave = sick.data.id;

  const overlap = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ธุระ', start_date: '2025-03-11', end_date: '2025-03-11',
  });
  assert.equal(overlap.status, 400);

  const weekend = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ธุระ', start_date: '2025-03-08', end_date: '2025-03-09',
  });
  assert.equal(weekend.status, 400);

  const holidayOnly = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ธุระ', start_date: '2025-03-05', end_date: '2025-03-05',
  });
  assert.equal(holidayOnly.status, 400);

  const acrossHoliday = await admin('POST', '/leave_requests', {
    employee_id: state.b, leave_type: 'ลาพักร้อน', reason: 'เที่ยว', start_date: '2025-03-04', end_date: '2025-03-06',
  });
  assert.equal(acrossHoliday.data.days, 2, 'วันที่ 5 เป็นวันหยุด จึงนับแค่ 2 วัน');

  // HR บันทึกผลแทนหัวหน้า: ต้องระบุผู้อนุมัติ
  const noApprover = await admin('PATCH', `/leave_requests/${state.sickLeave}/status`, { status: 'approved' });
  assert.equal(noApprover.status, 400);

  const approve = await admin('PATCH', `/leave_requests/${state.sickLeave}/status`, {
    status: 'approved', approver_name: APPROVER, status_note: 'มีใบรับรองแพทย์',
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  const approved = await admin('GET', `/leave_requests/${state.sickLeave}`);
  assert.equal(approved.data.status, 'approved');
  assert.equal(approved.data.approver_name, APPROVER);
  assert.ok(approved.data.decided_by_name, 'ต้องบันทึกว่า HR คนไหนเป็นผู้บันทึกผล');

  const approvers = await admin('GET', '/leave_requests/approvers');
  assert.ok(approvers.data.includes(APPROVER));

  const createWithoutApprover = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ไปธนาคาร', start_date: '2025-03-12', end_date: '2025-03-12', status: 'approved',
  });
  assert.equal(createWithoutApprover.status, 400);

  const halfDay = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ไปธนาคาร', start_date: '2025-03-12', end_date: '2025-03-12', half_day: true, status: 'approved', approver_name: APPROVER,
  });
  assert.equal(halfDay.data.days, 0.5);

  const overQuota = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ธุระที่ต่างจังหวัด', start_date: '2025-03-17', end_date: '2025-03-20', status: 'approved', approver_name: APPROVER,
  });
  assert.equal(overQuota.status, 201);
  assert.equal(overQuota.data.days, 4);
  assert.equal(overQuota.data.warnings.length, 1, 'ลากิจรวม 4.5 วัน เกินสิทธิ์ 3 วัน ต้องมีคำเตือน');

  const pendingList = await admin('GET', `/leave_requests?department=${encodeURIComponent(DEPARTMENT)}&status=pending`);
  assert.equal(pendingList.data.total, 1);
});

test('เตือนเมื่อการลงเวลากับใบลาที่อนุมัติแล้วขัดกัน', async () => {
  const leave = await admin('POST', '/leave_requests', {
    employee_id: state.c, leave_type: 'ลาป่วย', reason: 'ป่วย', start_date: '2025-03-24', end_date: '2025-03-25', status: 'approved', approver_name: APPROVER,
  });
  assert.equal(leave.status, 201, JSON.stringify(leave.data));

  const attendance = await addAttendance(state.c, '2025-03-24', '08:30', '17:30');
  assert.equal(attendance.warnings.length, 1, 'ลงเวลาในวันที่ลาป่วยต้องมีคำเตือน');

  const conflicts = await admin('GET', `/attendance?employee_id=${state.c}&conflict=1`);
  assert.equal(conflicts.data.total, 1);
  assert.equal(conflicts.data.items[0].on_leave, true);

  // บันทึกใบลาทับวันที่มีการลงเวลาอยู่แล้ว ก็ต้องเตือนเช่นกัน
  await addAttendance(state.c, '2025-03-26', '08:30', '17:30');
  const leaveOverAttendance = await admin('POST', '/leave_requests', {
    employee_id: state.c, leave_type: 'ลากิจ', reason: 'ธุระ', start_date: '2025-03-26', end_date: '2025-03-26',
  });
  assert.equal(leaveOverAttendance.status, 201);
  assert.ok(leaveOverAttendance.data.warnings.some((warning) => warning.includes('ลงเวลาทำงาน')));
});

test('ลาพักร้อน: ต้องทำงานครบ 12 เดือน และสะสมวันที่เหลือได้ไม่เกิน 3 วัน', async () => {
  const early = await admin('POST', '/leave_requests', {
    employee_id: state.c, leave_type: 'ลาพักร้อน', reason: 'เที่ยว', start_date: '2025-03-27', end_date: '2025-03-27',
  });
  assert.equal(early.status, 201);
  assert.ok(early.data.warnings.some((warning) => warning.includes('ยังทำงานไม่ครบ')), JSON.stringify(early.data.warnings));

  const balance2025 = await admin('GET', `/reports/leave-balance?year=2025&employee_id=${state.c}`);
  const c2025 = balance2025.data.rows[0];
  assert.equal(c2025.eligible_from, '2026-01-15');
  assert.equal(c2025.balances['ลาพักร้อน'].quota, 0);

  const balance2026 = await admin('GET', `/reports/leave-balance?year=2026&employee_id=${state.c}`);
  assert.equal(balance2026.data.rows[0].balances['ลาพักร้อน'].quota, 6);

  // A เริ่มงานปี 2020 ไม่เคยลาพักร้อน: ยกยอดจากปีก่อนได้สูงสุด 3 วัน
  const a2025 = (await admin('GET', `/reports/leave-balance?year=2025&employee_id=${state.a}`)).data.rows[0];
  assert.deepEqual(a2025.balances['ลาพักร้อน'], {
    quota: 6, carried: 3, used: 0, pending: 0, remaining: 9,
  });
});

test('นำเข้าไฟล์: รวมเวลาสแกนหลายครั้ง, แจ้งแถวที่ผิด, นำเข้าซ้ำไม่เปลี่ยนข้อมูล', async () => {
  const rows = [
    { line: 2, employee_code: `B${RUN_ID}`, date: '2025-03-03', time_in: '17:35' },
    { line: 3, employee_code: `B${RUN_ID}`, date: '2025-03-03', time_in: '08:10' },
    { line: 4, employee_code: `b${RUN_ID}`, date: '2025-03-07', time_in: '08:05' },
    { line: 5, employee_code: 'NOPE999', date: '2025-03-03', time_in: '08:00' },
    { line: 6, employee_code: `B${RUN_ID}`, date: '2025-13-40', time_in: '08:00' },
    { line: 7, employee_code: `C${RUN_ID}`, date: '2025-03-25', time_in: '08:30' },
  ];
  const preview = await admin('POST', '/import/attendance', { rows, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.deepEqual(
    { create: preview.data.summary.create, error: preview.data.summary.error },
    { create: 3, error: 2 },
  );
  const onLeave = preview.data.results.find((row) => row.lines.includes(7));
  assert.ok(onLeave.messages.some((message) => message.includes('ที่อนุมัติแล้ว')), 'ต้องเตือนว่าตรงกับวันลา');

  const before = await admin('GET', `/attendance?employee_id=${state.b}`);
  assert.equal(before.data.total, 0, 'dry run ต้องไม่บันทึกข้อมูล');

  const commit = await admin('POST', '/import/attendance', { rows: rows.slice(0, 5), dry_run: false, file_name: 'test.csv' });
  assert.equal(commit.data.summary.create, 2);

  const list = await admin('GET', `/attendance?employee_id=${state.b}&from=2025-03-01&to=2025-03-31`);
  const byDate = Object.fromEntries(list.data.items.map((row) => [row.date, row]));
  assert.equal(byDate['2025-03-03'].time_in, '08:10:00');
  assert.equal(byDate['2025-03-03'].time_out, '17:35:00');
  assert.equal(byDate['2025-03-07'].time_out, null);
  assert.equal(byDate['2025-03-03'].source, 'import');

  const again = await admin('POST', '/import/attendance', { rows: rows.slice(0, 5), dry_run: true });
  assert.equal(again.data.summary.unchanged, 2);
});

test('อ่านไฟล์ Excel (.xlsx): วันที่+เวลา และเวลาอย่างเดียว', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Scan');
  sheet.addRow(['รหัสพนักงาน', 'วันเวลา', 'เวลาออก']);
  sheet.addRow(['E001', new Date(Date.UTC(2025, 2, 3, 8, 25)), new Date(Date.UTC(1899, 11, 30, 17, 35))]);
  sheet.addRow(['E002', new Date(Date.UTC(2025, 2, 4)), '']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const res = await admin('POST', '/import/parse-xlsx', buffer, { raw: true });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.rows[0], ['รหัสพนักงาน', 'วันเวลา', 'เวลาออก']);
  assert.deepEqual(res.data.rows[1], ['E001', '2025-03-03 08:25', '17:35']);
  assert.deepEqual(res.data.rows[2].slice(0, 2), ['E002', '2025-03-04']);

  const notExcel = await admin('POST', '/import/parse-xlsx', Buffer.from('a,b,c'), { raw: true });
  assert.equal(notExcel.status, 400);
});

test('รายงานรายเดือน มี.ค. 2025', async () => {
  const res = await admin('GET', `/reports/monthly?month=2025-03&department=${encodeURIComponent(DEPARTMENT)}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.working_days, 20, 'มี.ค. 2025 มีวันทำงาน 21 วัน ลบวันหยุดทดสอบ 1 วัน');
  const a = res.data.rows.find((row) => row.employee_id === state.a);
  assert.equal(a.present_days, 6, 'นับเฉพาะวันทำงาน (ไม่รวมวันเสาร์)');
  assert.equal(a.late_days, 1);
  assert.equal(a.late_minutes, 15);
  assert.equal(a.early_leave_days, 1);
  assert.equal(a.early_minutes, 60);
  assert.equal(a.ot_minutes, 90);
  assert.equal(a.holiday_work_days, 1);
  assert.equal(a.holiday_minutes, 180);
  assert.equal(a.missing_out_days, 1);
  assert.equal(a.leave_days['ลาป่วย'], 2);
  assert.equal(a.leave_days['ลากิจ'], 4.5);
  assert.equal(a.total_leave_days, 6.5);
  // 20 วันทำงาน - มาทำงาน 6 - ลาเต็มวัน 6 - ลาครึ่งวัน 0.5 = ขาด 7.5
  assert.equal(a.absent_days, 7.5);
  assert.equal(a.conflict_days, 0);

  const b = res.data.rows.find((row) => row.employee_id === state.b);
  assert.equal(b.present_days, 2);
  assert.equal(b.leave_days['ลาพักร้อน'], 0, 'คำขอลาที่ยังไม่อนุมัติไม่นับในรายงาน');

  const c = res.data.rows.find((row) => row.employee_id === state.c);
  assert.equal(c.conflict_days, 1);
});

test('วันลาคงเหลือปี 2025', async () => {
  const res = await admin('GET', `/reports/leave-balance?year=2025&department=${encodeURIComponent(DEPARTMENT)}`);
  const a = res.data.rows.find((row) => row.employee_id === state.a);
  assert.deepEqual(a.balances['ลาป่วย'], {
    quota: 30, carried: 0, used: 2, pending: 0, remaining: 28,
  });
  assert.equal(a.balances['ลากิจ'].remaining, -1.5);
  const b = res.data.rows.find((row) => row.employee_id === state.b);
  assert.equal(b.balances['ลาพักร้อน'].pending, 2);
});

test('ลบแบบ soft delete และลงเวลาวันเดิมใหม่ได้', async () => {
  const deleted = await admin('DELETE', `/attendance/${state.attendanceMar6}`);
  assert.equal(deleted.status, 200);
  const get = await admin('GET', `/attendance/${state.attendanceMar6}`);
  assert.equal(get.status, 404);
  const again = await admin('POST', '/attendance', {
    employee_id: state.a, date: '2025-03-06', time_in: '08:25', time_out: '17:30',
  });
  assert.equal(again.status, 201, JSON.stringify(again.data));
});

test('audit log บันทึกการนำเข้าและการลบ', async () => {
  const res = await admin('GET', '/audit?entity=attendance');
  const actions = res.data.items.map((row) => row.action);
  assert.ok(actions.includes('import'));
  assert.ok(actions.includes('delete'));
  const deleted = res.data.items.find((row) => row.action === 'delete' && row.entity_id === state.attendanceMar6);
  assert.equal(deleted.details.date, '2025-03-06');
});

test('หน้าภาพรวมตอบข้อมูลครบ', async () => {
  const res = await admin('GET', '/dashboard');
  assert.equal(res.status, 200);
  for (const key of ['today', 'active_employees', 'late', 'on_leave', 'pending_leaves', 'not_checked_in']) {
    assert.ok(key in res.data, `ไม่มี ${key}`);
  }
});

test('ผู้ใช้ HR: ต้องเปลี่ยนรหัสผ่าน, ไม่มีสิทธิ์ admin, ปิดบัญชีแล้วใช้งานไม่ได้', async () => {
  const username = `hr_${RUN_ID.toLowerCase()}`;
  const created = await admin('POST', '/users', {
    username, display_name: 'HR ทดสอบ', role: 'hr', password: 'TempPass123',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const hr = createClient();
  const login = await hr('POST', '/auth/login', { username, password: 'TempPass123' });
  assert.equal(login.data.must_change_password, true);
  const change = await hr('POST', '/auth/change-password', { current_password: 'TempPass123', new_password: 'NewPass12345' });
  assert.equal(change.status, 200);

  assert.equal((await hr('GET', '/employees')).status, 200);
  assert.equal((await hr('GET', '/users')).status, 403);
  assert.equal((await hr('GET', '/audit')).status, 403);
  assert.equal((await hr('PUT', '/settings', {})).status, 403);

  const deactivate = await admin('PUT', `/users/${created.data.id}`, { active: false });
  assert.equal(deactivate.status, 200);
  assert.equal((await hr('GET', '/employees')).status, 401);
});

test('logout แล้วใช้งานไม่ได้', async () => {
  const client = createClient();
  const username = process.env.TEST_USERNAME || 'admin';
  const password = process.env.TEST_NEW_PASSWORD || process.env.TEST_PASSWORD;
  await client('POST', '/auth/login', { username, password });
  assert.equal((await client('GET', '/auth/me')).status, 200);
  await client('POST', '/auth/logout');
  assert.equal((await client('GET', '/auth/me')).status, 401);
});
