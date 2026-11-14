// ทดสอบ API แบบ end-to-end กับเซิร์ฟเวอร์ที่รันอยู่
// ⚠️ ใช้กับฐานข้อมูลทดสอบเท่านั้น (สคริปต์จะสร้างพนักงาน/ข้อมูลทดสอบในเดือน มี.ค. 2568)
//
// วิธีรัน:
//   TEST_USERNAME=admin TEST_PASSWORD=<รหัสผ่าน> npm test
//   ถ้าบัญชียังต้องเปลี่ยนรหัสผ่าน ให้ใส่ TEST_NEW_PASSWORD=<รหัสใหม่> ด้วย
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RUN_ID = Date.now().toString(36).slice(-6).toUpperCase();
const DEPARTMENT = `ทดสอบ-${RUN_ID}`;

// fetch ที่จำ cookie ของ session ไว้ (แยกตามผู้ใช้)
const createClient = () => {
  let cookie = '';
  return async (method, path, body) => {
    const response = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };
};

const admin = createClient();
const state = {};

after(async () => {
  if (state.holidayId) await admin('DELETE', `/holidays/${state.holidayId}`);
});

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

test('ตั้งค่าเริ่มต้น (เข้างาน 08:30, จันทร์-ศุกร์, โควตาตามกฎหมาย)', async () => {
  const res = await admin('PUT', '/settings', {
    work_start_time: '08:30',
    work_end_time: '17:30',
    late_grace_minutes: 0,
    work_days: [1, 2, 3, 4, 5],
    leave_quotas: { 'ลาป่วย': 30, 'ลากิจ': 3, 'ลาพักร้อน': 6 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const bad = await admin('PUT', '/settings', {
    work_start_time: '18:00', work_end_time: '08:00', late_grace_minutes: -1, work_days: [], leave_quotas: {},
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.length >= 3);
});

test('วันหยุด: เพิ่มวันหยุด 5 มี.ค. 2025', async () => {
  const res = await admin('POST', '/holidays', { date: '2025-03-05', name: `วันหยุดทดสอบ ${RUN_ID}` });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  state.holidayId = res.data.id;
  const duplicate = await admin('POST', '/holidays', { date: '2025-03-05', name: 'ซ้ำ' });
  assert.equal(duplicate.status, 409);
});

test('พนักงาน: เพิ่ม, รหัสซ้ำ, ตรวจข้อมูล', async () => {
  const a = await admin('POST', '/employees', {
    employee_code: `A${RUN_ID}`, first_name: 'สมชาย', last_name: 'ทดสอบ', department: DEPARTMENT, position: 'พนักงาน', start_date: '2020-01-01',
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  state.a = a.data.id;

  const b = await admin('POST', '/employees', {
    employee_code: `B${RUN_ID}`, first_name: 'สมหญิง', last_name: 'ทดสอบ', department: DEPARTMENT, start_date: '2020-01-01',
  });
  assert.equal(b.status, 201);
  state.b = b.data.id;

  const duplicate = await admin('POST', '/employees', { employee_code: `A${RUN_ID}`, first_name: 'x', last_name: 'y' });
  assert.equal(duplicate.status, 409);

  const invalid = await admin('POST', '/employees', { employee_code: 'มีช่องว่าง 1', first_name: '' });
  assert.equal(invalid.status, 400);

  const search = await admin('GET', `/employees?q=${encodeURIComponent(`A${RUN_ID}`)}`);
  assert.equal(search.data.total, 1);
});

test('ลงเวลา: เพิ่ม, ห้ามซ้ำวันเดียวกัน, ห้ามวันในอนาคต, กรองคนมาสาย', async () => {
  const rows = [
    { date: '2025-03-03', time_in: '08:20', time_out: '17:30' },
    { date: '2025-03-04', time_in: '08:45', time_out: '17:30' },
    { date: '2025-03-06', time_in: '08:30', time_out: '' },
  ];
  for (const row of rows) {
    const res = await admin('POST', '/attendance', { employee_id: state.a, ...row });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    if (row.date === '2025-03-06') state.attendanceMar6 = res.data.id;
  }

  const duplicate = await admin('POST', '/attendance', { employee_id: state.a, date: '2025-03-03', time_in: '09:00' });
  assert.equal(duplicate.status, 409);

  const future = await admin('POST', '/attendance', { employee_id: state.a, date: '2999-01-01', time_in: '09:00' });
  assert.equal(future.status, 400);

  const late = await admin('GET', `/attendance?employee_id=${state.a}&late=1`);
  assert.equal(late.data.total, 1);
  assert.equal(late.data.items[0].date, '2025-03-04');
  assert.equal(late.data.items[0].is_late, true);
});

test('การลา: นับเฉพาะวันทำงาน, ห้ามซ้อน, ห้ามลาเฉพาะวันหยุด, เตือนเกินโควตา', async () => {
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

  const approve = await admin('PATCH', `/leave_requests/${state.sickLeave}/status`, { status: 'approved', status_note: 'มีใบรับรองแพทย์' });
  assert.equal(approve.status, 200, JSON.stringify(approve.data));
  const approved = await admin('GET', `/leave_requests/${state.sickLeave}`);
  assert.equal(approved.data.status, 'approved');
  assert.ok(approved.data.decided_by_name);

  const halfDay = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ไปธนาคาร', start_date: '2025-03-12', end_date: '2025-03-12', half_day: true, status: 'approved',
  });
  assert.equal(halfDay.data.days, 0.5);

  const overQuota = await admin('POST', '/leave_requests', {
    employee_id: state.a, leave_type: 'ลากิจ', reason: 'ธุระที่ต่างจังหวัด', start_date: '2025-03-17', end_date: '2025-03-20', status: 'approved',
  });
  assert.equal(overQuota.status, 201);
  assert.equal(overQuota.data.days, 4);
  assert.equal(overQuota.data.warnings.length, 1, 'ลากิจรวม 4.5 วัน เกินโควตา 3 วัน ต้องมีคำเตือน');

  const pendingList = await admin('GET', `/leave_requests?department=${encodeURIComponent(DEPARTMENT)}&status=pending`);
  assert.equal(pendingList.data.total, 1);
});

test('นำเข้าไฟล์: รวมเวลาสแกนหลายครั้ง, แจ้งแถวที่ผิด, นำเข้าซ้ำไม่เปลี่ยนข้อมูล', async () => {
  const rows = [
    { line: 2, employee_code: `B${RUN_ID}`, date: '2025-03-03', time_in: '17:35' },
    { line: 3, employee_code: `B${RUN_ID}`, date: '2025-03-03', time_in: '08:10' },
    { line: 4, employee_code: `b${RUN_ID}`, date: '2025-03-07', time_in: '08:05' },
    { line: 5, employee_code: 'NOPE999', date: '2025-03-03', time_in: '08:00' },
    { line: 6, employee_code: `B${RUN_ID}`, date: '2025-13-40', time_in: '08:00' },
  ];
  const preview = await admin('POST', '/import/attendance', { rows, dry_run: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.deepEqual(
    { create: preview.data.summary.create, error: preview.data.summary.error },
    { create: 2, error: 2 },
  );

  const before = await admin('GET', `/attendance?employee_id=${state.b}`);
  assert.equal(before.data.total, 0, 'dry run ต้องไม่บันทึกข้อมูล');

  const commit = await admin('POST', '/import/attendance', { rows, dry_run: false, file_name: 'test.csv' });
  assert.equal(commit.data.summary.create, 2);

  const list = await admin('GET', `/attendance?employee_id=${state.b}&from=2025-03-01&to=2025-03-31`);
  const byDate = Object.fromEntries(list.data.items.map((row) => [row.date, row]));
  assert.equal(byDate['2025-03-03'].time_in, '08:10:00');
  assert.equal(byDate['2025-03-03'].time_out, '17:35:00');
  assert.equal(byDate['2025-03-07'].time_out, null);
  assert.equal(byDate['2025-03-03'].source, 'import');

  const again = await admin('POST', '/import/attendance', { rows, dry_run: true });
  assert.equal(again.data.summary.unchanged, 2);
});

test('รายงานรายเดือน มี.ค. 2025', async () => {
  const res = await admin('GET', `/reports/monthly?month=2025-03&department=${encodeURIComponent(DEPARTMENT)}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.working_days, 20, 'มี.ค. 2025 มีวันทำงาน 21 วัน ลบวันหยุดทดสอบ 1 วัน');
  const a = res.data.rows.find((row) => row.employee_id === state.a);
  assert.equal(a.present_days, 3);
  assert.equal(a.late_days, 1);
  assert.equal(a.missing_out_days, 1);
  assert.equal(a.leave_days['ลาป่วย'], 2);
  assert.equal(a.leave_days['ลากิจ'], 4.5);
  assert.equal(a.total_leave_days, 6.5);
  // 20 วันทำงาน - มาทำงาน 3 - ลาเต็มวัน 6 - ลาครึ่งวัน 0.5 = ขาด 10.5
  assert.equal(a.absent_days, 10.5);

  const b = res.data.rows.find((row) => row.employee_id === state.b);
  assert.equal(b.present_days, 2);
  assert.equal(b.leave_days['ลาพักร้อน'], 0, 'คำขอลาที่ยังไม่อนุมัติไม่นับในรายงาน');
});

test('วันลาคงเหลือปี 2025', async () => {
  const res = await admin('GET', `/reports/leave-balance?year=2025&department=${encodeURIComponent(DEPARTMENT)}`);
  const a = res.data.rows.find((row) => row.employee_id === state.a);
  assert.deepEqual(a.balances['ลาป่วย'], {
    quota: 30, used: 2, pending: 0, remaining: 28,
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
