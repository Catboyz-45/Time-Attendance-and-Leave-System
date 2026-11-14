// โหมดทดลองสำหรับ GitHub Pages: จำลองเซิร์ฟเวอร์ /api ไว้ในเบราว์เซอร์
//
// - ทุกคำขอ /api/* ที่หน้าเว็บส่ง (ผ่าน apiFetch ใน common.js) จะถูกตอบจากไฟล์นี้แทนเซิร์ฟเวอร์จริง
// - ข้อมูลเก็บใน localStorage ของเบราว์เซอร์ผู้ใช้เท่านั้น (แต่ละคนเห็นข้อมูลของตัวเอง ไม่กระทบคนอื่น)
// - การคำนวณ (สาย/OT, วันลาคงเหลือ, รายงานรายเดือน, นำเข้าไฟล์) ใช้โค้ดชุดเดียวกับเซิร์ฟเวอร์จริง
//   ซึ่ง demo/build.mjs รวมมาไว้ใน window.TALSLib
// - ข้อความ error และรูปแบบข้อมูลที่ตอบกลับ ตรงกับ server/src/routes/* เพื่อให้หน้าเว็บทำงานเหมือนของจริง

(() => {
    const lib = window.TALSLib;
    const {
        isFilled, isValidDate, isValidTime, isValidMonth, normalizeTime, toBool, optionalText, isPositiveInt,
    } = lib.validate;
    const {
        todayStr, addDays, monthRange, isWorkingDay, countWorkingDays, leaveDaysInRange,
    } = lib.dates;
    const { recordMetrics } = lib.worktime;
    const {
        LEAVE_TYPES, LEAVE_STATUSES, ANNUAL_LEAVE_TYPE, DEFAULT_SETTINGS, lateThreshold,
    } = lib.settings;
    const { buildBalances, firstYearFor } = lib.balances;
    const { buildMonthlyRows, employeeInfo } = lib.monthlyReport;
    const {
        MAX_ROWS, MAX_SHEET_ROWS, sheetRows, mergeRows, planImport,
    } = lib.importRows;

    const STORAGE_KEY = 'tals-demo-v1';
    const DEMO_PASSWORD = 'demo1234';
    const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

    // ===================== error แบบเดียวกับ server/src/http.js =====================

    class HttpError extends Error {
        constructor(status, message, errors = [], extra = {}) {
            super(message);
            this.status = status;
            this.errors = errors;
            this.extra = extra;
        }
    }
    const badRequest = (errors) => new HttpError(400, 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors);
    const notFound = (message = 'ไม่พบข้อมูล') => new HttpError(404, message);
    const conflict = (message) => new HttpError(409, message);
    const parseId = (value, message) => {
        if (!/^\d{1,10}$/.test(String(value))) throw notFound(message);
        return Number(value);
    };
    const parsePagination = (query, { defaultSize = 50, maxSize = 5000 } = {}) => {
        const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
        const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.page_size, 10) || defaultSize));
        return { page, pageSize, offset: (page - 1) * pageSize };
    };
    const paginate = (rows, query, options) => {
        const { page, pageSize, offset } = parsePagination(query, options);
        return {
            items: rows.slice(offset, offset + pageSize), total: rows.length, page, page_size: pageSize,
        };
    };

    // ===================== เวลา =====================

    const nowStr = () => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date()).map((part) => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    };
    const pad = (n) => String(n).padStart(2, '0');
    const minutesToTime = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const like = (text, query) => String(text || '').toLowerCase().includes(String(query).trim().toLowerCase());

    // ===================== ข้อมูลตัวอย่าง =====================

    // สุ่มแบบกำหนดผลได้ (seed เดียวกันได้ข้อมูลชุดเดิม)
    const rng = (seed) => () => {
        /* eslint-disable no-bitwise */
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        /* eslint-enable no-bitwise */
    };

    const FIXED_HOLIDAYS = [
        ['01-01', 'วันขึ้นปีใหม่'], ['04-06', 'วันจักรี'], ['04-13', 'วันสงกรานต์'], ['04-14', 'วันสงกรานต์'],
        ['04-15', 'วันสงกรานต์'], ['05-01', 'วันแรงงานแห่งชาติ'], ['05-04', 'วันฉัตรมงคล'],
        ['06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี'], ['07-28', 'วันเฉลิมพระชนมพรรษา ร.10'],
        ['08-12', 'วันแม่แห่งชาติ'], ['10-13', 'วันนวมินทรมหาราช'], ['10-23', 'วันปิยมหาราช'],
        ['12-05', 'วันพ่อแห่งชาติ'], ['12-10', 'วันรัฐธรรมนูญ'], ['12-31', 'วันสิ้นปี'],
    ];

    const APPROVERS = {
        ฝ่ายขาย: 'คุณสมชาย ใจดี (ผู้จัดการฝ่ายขาย)',
        บัญชี: 'คุณศิริพร ทองดี (ผู้จัดการฝ่ายบัญชี)',
        ฝ่ายผลิต: 'คุณมานะ ดีงาม (หัวหน้าฝ่ายผลิต)',
        คลังสินค้า: 'คุณมานะ ดีงาม (หัวหน้าฝ่ายผลิต)',
        ฝ่ายบุคคล: 'คุณกมลวรรณ เพชรรัตน์ (ผู้จัดการฝ่ายบุคคล)',
    };

    const createSeed = () => {
        const today = todayStr();
        const year = Number(today.slice(0, 4));
        const random = rng(Number(today.replace(/-/g, '')));
        const settings = {
            ...clone(DEFAULT_SETTINGS),
            company_name: 'บริษัท ตัวอย่างการค้า จำกัด',
            annual_leave_carry_over_max: 3,
        };

        const holidays = [];
        for (const y of [year - 1, year, year + 1]) {
            for (const [md, name] of FIXED_HOLIDAYS) holidays.push({ id: holidays.length + 1, date: `${y}-${md}`, name });
        }
        const calendar = { workDays: new Set(settings.work_days), holidays: new Map(holidays.map((h) => [h.date, h.name])) };
        const working = (date) => isWorkingDay(date, calendar);
        // วันทำงานที่ใกล้ที่สุด: offset < 0 ถอยหลัง, offset >= 0 เดินหน้า
        const workday = (offset) => {
            let date = addDays(today, offset);
            const step = offset < 0 ? -1 : 1;
            while (!working(date)) date = addDays(date, step);
            return date;
        };
        const nthWorkday = (start, count) => {
            let date = start;
            let left = count - 1;
            while (left > 0) {
                date = addDays(date, 1);
                if (working(date)) left -= 1;
            }
            return date;
        };

        const monthsAgo = (months) => {
            const [y, m, d] = today.split('-').map(Number);
            const date = new Date(Date.UTC(y, m - 1 - months, Math.min(d, 28)));
            return date.toISOString().slice(0, 10);
        };

        const employeeRows = [
            ['EMP001', 'สมชาย', 'ใจดี', 'ฝ่ายขาย', 'ผู้จัดการฝ่ายขาย', '2016-03-01'],
            ['EMP002', 'วิภาวดี', 'ศรีสุข', 'บัญชี', 'เจ้าหน้าที่บัญชี', '2019-07-15'],
            ['EMP003', 'ธนพล', 'แก้วมณี', 'คลังสินค้า', 'หัวหน้าคลังสินค้า', '2018-01-08'],
            ['EMP004', 'ปิยะนุช', 'รุ่งเรือง', 'ฝ่ายขาย', 'พนักงานขาย', '2021-05-03'],
            ['EMP005', 'อนุชา', 'บุญมา', 'ฝ่ายผลิต', 'ช่างเทคนิค', '2020-11-16'],
            ['EMP006', 'ศิริพร', 'ทองดี', 'บัญชี', 'ผู้จัดการฝ่ายบัญชี', '2015-09-01'],
            ['EMP007', 'มานะ', 'ดีงาม', 'ฝ่ายผลิต', 'หัวหน้าฝ่ายผลิต', '2017-04-10'],
            ['EMP008', 'ชไมพร', 'สุขใจ', 'ฝ่ายบุคคล', 'เจ้าหน้าที่บุคคล', '2022-02-14'],
            ['EMP009', 'กิตติ', 'ศักดิ์ดี', 'ฝ่ายผลิต', 'พนักงานผลิต', '2023-06-01'],
            ['EMP010', 'นภา', 'ใจงาม', 'ฝ่ายขาย', 'พนักงานขาย', monthsAgo(4)],
            ['EMP011', 'ณัฐวุฒิ', 'พรหมมา', 'คลังสินค้า', 'พนักงานคลังสินค้า', '2024-01-15'],
            ['EMP012', 'กมลวรรณ', 'เพชรรัตน์', 'ฝ่ายบุคคล', 'ผู้จัดการฝ่ายบุคคล', '2014-08-01'],
            ['EMP013', 'วรเชษฐ์', 'มั่นคง', 'ฝ่ายผลิต', 'พนักงานผลิต', null],
            ['EMP014', 'จิราพร', 'แสงทอง', 'ฝ่ายขาย', 'พนักงานขาย', '2020-02-01'],
        ];
        const createdAt = `${monthsAgo(14)} 09:00:00`;
        const employees = employeeRows.map(([code, first, last, department, position, start], index) => ({
            id: index + 1,
            employee_code: code,
            first_name: first,
            last_name: last,
            department,
            position,
            start_date: start,
            active: code === 'EMP014' ? 0 : 1,
            created_at: start && start > createdAt.slice(0, 10) ? `${start} 09:00:00` : createdAt,
            updated_at: createdAt,
        }));
        const resignedOn = workday(-45); // EMP014 ลาออกแล้ว

        const users = [
            {
                id: 1, username: 'demo', display_name: 'ผู้ทดลองใช้', role: 'admin', active: 1, must_change_password: 0, last_login_at: nowStr(), created_at: createdAt,
            },
            {
                id: 2, username: 'hr.wanna', display_name: 'วรรณา (HR)', role: 'hr', active: 1, must_change_password: 0, last_login_at: `${workday(-1)} 08:12:41`, created_at: createdAt,
            },
            {
                id: 3, username: 'hr.old', display_name: 'บัญชีเก่า (ปิดแล้ว)', role: 'hr', active: 0, must_change_password: 0, last_login_at: `${monthsAgo(6)} 10:03:00`, created_at: createdAt,
            },
        ];

        // ใบลา [รหัส, ประเภท, วันเริ่ม, วันสิ้นสุด, ครึ่งวัน, เหตุผล, สถานะ, หมายเหตุผล]
        const leaveSpecs = [];
        const span = (offset, days) => {
            const start = workday(offset);
            return [start, nthWorkday(start, days)];
        };
        leaveSpecs.push(['EMP007', ANNUAL_LEAVE_TYPE, `${year - 1}-10-06`, `${year - 1}-10-09`, 0, 'พาครอบครัวไปเที่ยวเชียงใหม่', 'approved', null]);
        leaveSpecs.push(['EMP002', 'ลาป่วย', ...span(-40, 1), 0, 'เป็นไข้หวัด มีใบรับรองแพทย์', 'approved', 'แนบใบรับรองแพทย์แล้ว']);
        leaveSpecs.push(['EMP005', 'ลากิจ', ...span(-33, 1), 0, 'ไปติดต่อราชการที่อำเภอ', 'approved', null]);
        leaveSpecs.push(['EMP007', ANNUAL_LEAVE_TYPE, ...span(-26, 3), 0, 'พาครอบครัวไปเที่ยวต่างจังหวัด', 'approved', null]);
        leaveSpecs.push(['EMP003', 'ลาป่วย', ...span(-20, 1), 0, 'ปวดหลัง ไปพบแพทย์', 'approved', null]);
        leaveSpecs.push(['EMP004', 'ลากิจ', ...span(-15, 1), 1, 'ติดต่อธนาคารช่วงเช้า', 'approved', null]);
        leaveSpecs.push(['EMP011', 'ลาป่วย', ...span(-12, 2), 0, 'ท้องเสีย', 'approved', null]);
        leaveSpecs.push(['EMP009', 'ลากิจ', ...span(-9, 1), 0, 'ไปงานบวชเพื่อนที่ต่างจังหวัด', 'rejected', 'ช่วงนั้นงานเร่ง ขอให้เลื่อนเป็นเดือนหน้า']);
        leaveSpecs.push(['EMP006', ANNUAL_LEAVE_TYPE, ...span(-6, 2), 0, 'ธุระส่วนตัว', 'approved', null]);
        leaveSpecs.push(['EMP012', ANNUAL_LEAVE_TYPE, workday(-1), workday(2), 0, 'พักผ่อนประจำปี', 'approved', null]);
        if (working(today)) leaveSpecs.push(['EMP008', 'ลาป่วย', today, today, 0, 'ปวดหัว เป็นไข้', 'approved', 'โทรแจ้งหัวหน้าตอนเช้า']);
        leaveSpecs.push(['EMP005', 'ลาป่วย', ...span(-1, 1), 0, 'ปวดฟัน ไปหาหมอฟัน', 'pending', null]);
        leaveSpecs.push(['EMP001', ANNUAL_LEAVE_TYPE, ...span(5, 3), 0, 'เดินทางไปต่างประเทศกับครอบครัว', 'pending', null]);
        leaveSpecs.push(['EMP002', 'ลากิจ', ...span(8, 1), 1, 'พาลูกไปหาหมอ (ครึ่งเช้า)', 'pending', null]);
        leaveSpecs.push(['EMP010', ANNUAL_LEAVE_TYPE, ...span(10, 2), 0, 'กลับบ้านต่างจังหวัด', 'pending', null]);

        const byCode = new Map(employees.map((e) => [e.employee_code, e]));
        const leaves = leaveSpecs.map(([code, type, start, end, half, reason, status, note], index) => {
            const employee = byCode.get(code);
            const decided = status !== 'pending';
            const created = `${addDays(start, start > today ? -7 : -3)} 09:${pad(10 + index)}:00`;
            return {
                id: index + 1,
                employee_id: employee.id,
                leave_type: type,
                start_date: start,
                end_date: end,
                half_day: half,
                reason,
                status,
                status_note: note,
                approver_name: decided ? APPROVERS[employee.department] : null,
                decided_by: decided ? 2 : null,
                decided_at: decided ? `${addDays(created.slice(0, 10), 1)} 10:${pad(20 + index)}:00` : null,
                created_at: created,
                updated_at: created,
                deleted_at: null,
            };
        });

        const fullDayLeave = (employeeId, date) => leaves.some((l) => l.employee_id === employeeId && !l.half_day
            && l.status !== 'rejected' && l.start_date <= date && l.end_date >= date);

        // การลงเวลา 75 วันย้อนหลัง
        const nowMinutes = (() => {
            const [h, m] = nowStr().slice(11, 16).split(':').map(Number);
            return h * 60 + m;
        })();
        const lateProne = new Set(['EMP004', 'EMP009']);
        const attendance = [];
        const push = (employee, date, timeIn, timeOut, extra = {}) => {
            attendance.push({
                id: attendance.length + 1,
                employee_id: employee.id,
                date,
                time_in: minutesToTime(timeIn),
                time_out: timeOut === null ? null : minutesToTime(timeOut),
                note: null,
                source: 'import',
                created_at: `${date} 18:30:00`,
                updated_at: `${date} 18:30:00`,
                deleted_at: null,
                ...extra,
            });
        };
        for (let offset = -75; offset <= 0; offset += 1) {
            const date = addDays(today, offset);
            if (!working(date)) continue;
            const isToday = date === today;
            for (const employee of employees) {
                const start = employee.start_date || employee.created_at.slice(0, 10);
                if (date < start) continue;
                if (!employee.active && date > resignedOn) continue;
                if (fullDayLeave(employee.id, date)) continue;
                if (!isToday && random() < 0.02) continue; // ขาดงาน
                if (isToday && random() < 0.18) continue; // ยังไม่มา
                const lateChance = lateProne.has(employee.employee_code) ? 0.22 : 0.07;
                const timeIn = random() < lateChance ? 8 * 60 + 31 + Math.floor(random() * 40) : 8 * 60 + Math.floor(random() * 29);
                let timeOut;
                const r = random();
                if (r < 0.18) timeOut = 18 * 60 + Math.floor(random() * 120); // OT
                else if (r < 0.21) timeOut = 16 * 60 + Math.floor(random() * 60); // ออกก่อน
                else timeOut = 17 * 60 + 30 + Math.floor(random() * 20);
                if (isToday) timeOut = nowMinutes >= timeOut ? timeOut : null;
                else if (offset > -30 && random() < 0.02) timeOut = null; // ลืมสแกนออก
                if (isToday && timeIn > nowMinutes) continue;
                push(employee, date, timeIn, timeOut, isToday ? { source: 'manual', created_at: `${date} ${minutesToTime(timeIn)}` } : {});
            }
        }
        // ทำงานวันเสาร์ (นับเป็นทำงานวันหยุด)
        for (const [code, offset] of [['EMP005', -16], ['EMP009', -16], ['EMP005', -30]]) {
            let date = addDays(today, offset);
            while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 6) date = addDays(date, -1);
            push(byCode.get(code), date, 8 * 60 + 30, 12 * 60 + 40, { source: 'manual', note: 'มาซ่อมเครื่องจักรวันเสาร์' });
        }
        // ข้อมูลขัดกัน: มีการลงเวลาในวันที่ลาป่วยที่อนุมัติแล้ว (ให้เห็นป้าย "ขัดกับใบลา")
        const conflictLeave = leaves.find((l) => l.reason === 'ปวดหลัง ไปพบแพทย์');
        push(byCode.get('EMP003'), conflictLeave.start_date, 8 * 60 + 12, 17 * 60 + 35);
        // บันทึกเองโดย HR พร้อมหมายเหตุ
        const manual = attendance.find((row) => row.employee_id === 4 && row.date < today && row.time_out);
        if (manual) Object.assign(manual, { source: 'manual', note: 'ลืมสแกนนิ้ว HR บันทึกแทน' });
        attendance.sort((a, b) => (a.date === b.date ? a.employee_id - b.employee_id : a.date.localeCompare(b.date)));
        attendance.forEach((row, index) => { row.id = index + 1; });

        const audit = [];
        const log = (createdAt2, userId, action, entity, entityId, details) => audit.push({
            id: 0, user_id: userId, username: users.find((u) => u.id === userId)?.username || null, action, entity, entity_id: entityId, details, ip: '127.0.0.1', created_at: createdAt2,
        });
        log(`${employees[9].start_date} 09:15:00`, 2, 'create', 'employee', 10, { employee_code: 'EMP010', first_name: 'นภา', last_name: 'ใจงาม', department: 'ฝ่ายขาย' });
        log(`${resignedOn} 17:40:00`, 2, 'update', 'employee', 14, { active: { from: 1, to: 0 } });
        for (const leave of leaves) {
            log(leave.created_at, 2, 'create', 'leave', leave.id, { leave_type: leave.leave_type, start_date: leave.start_date, end_date: leave.end_date });
            if (leave.decided_at) log(leave.decided_at, 2, 'status', 'leave', leave.id, { status: { from: 'pending', to: leave.status }, approver_name: { from: null, to: leave.approver_name } });
        }
        for (let offset = -21; offset < 0; offset += 7) {
            log(`${workday(offset)} 18:35:00`, 2, 'import', 'attendance', null, {
                rows: 64, create: 60, update: 2, unchanged: 0, error: 2, file_name: `scan-${workday(offset)}.xlsx`,
            });
        }
        log(`${workday(-1)} 08:12:41`, 2, 'login', 'user', 2, null);
        audit.sort((a, b) => a.created_at.localeCompare(b.created_at));
        audit.forEach((row, index) => { row.id = index + 1; });

        return {
            version: 1,
            created_on: today,
            settings,
            holidays,
            employees,
            users,
            passwords: { demo: DEMO_PASSWORD, 'hr.wanna': DEMO_PASSWORD, 'hr.old': DEMO_PASSWORD },
            leaves,
            attendance,
            audit,
            session: { userId: 1 },
            seq: {
                holidays: holidays.length, employees: employees.length, users: users.length, leaves: leaves.length, attendance: attendance.length, audit: audit.length,
            },
        };
    };

    // ===================== เก็บข้อมูล =====================

    let state = null;
    const load = () => {
        try {
            const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
            if (saved && saved.version === 1) return saved;
        } catch {
            // เบราว์เซอร์ไม่อนุญาตให้เก็บข้อมูล: ใช้ข้อมูลในหน่วยความจำแทน
        }
        return createSeed();
    };
    const save = () => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // ไม่เป็นไร ข้อมูลยังอยู่จนกว่าจะปิดหน้า
        }
    };
    state = load();
    save();

    const nextId = (table) => {
        state.seq[table] += 1;
        return state.seq[table];
    };
    const calendar = () => ({
        workDays: new Set(state.settings.work_days),
        holidays: new Map(state.holidays.map((h) => [h.date, h.name])),
    });
    const employeeById = (id) => state.employees.find((e) => e.id === Number(id));
    const userById = (id) => state.users.find((u) => u.id === Number(id));

    const logAudit = (ctx, {
        action, entity, entityId = null, details = null, username = null,
    }) => {
        state.audit.push({
            id: nextId('audit'),
            user_id: ctx.user ? ctx.user.id : null,
            username: ctx.user ? ctx.user.username : username,
            action,
            entity,
            entity_id: entityId,
            details: details ? clone(details) : null,
            ip: '127.0.0.1',
            created_at: nowStr(),
        });
    };
    const diff = (before, after) => {
        const changes = {};
        for (const key of Object.keys(after)) {
            const from = before[key] ?? null;
            const to = after[key] ?? null;
            if (String(from) !== String(to)) changes[key] = { from, to };
        }
        return changes;
    };

    // ===================== ผู้ใช้ / เข้าสู่ระบบ =====================

    const publicUser = (user) => ({
        id: user.id, username: user.username, display_name: user.display_name, role: user.role, must_change_password: Boolean(user.must_change_password),
    });
    const validatePassword = (password) => {
        if (typeof password !== 'string' || password.length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
        if (password.length > 72) return 'รหัสผ่านต้องไม่เกิน 72 ตัวอักษร';
        return null;
    };
    const requireAdmin = (ctx) => {
        if (ctx.user.role !== 'admin') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น');
    };

    // ===================== พนักงาน =====================

    const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;
    const validateEmployee = (body = {}) => {
        const errors = [];
        const code = isFilled(body.employee_code) ? String(body.employee_code).trim() : '';
        if (!code) errors.push('กรุณากรอกรหัสพนักงาน');
        else if (!CODE_RE.test(code)) errors.push('รหัสพนักงานใช้ได้เฉพาะ A-Z, 0-9, - และ _ ไม่เกิน 20 ตัว');
        if (!isFilled(body.first_name)) errors.push('กรุณากรอกชื่อ');
        if (!isFilled(body.last_name)) errors.push('กรุณากรอกนามสกุล');
        for (const [field, label] of [['first_name', 'ชื่อ'], ['last_name', 'นามสกุล'], ['department', 'แผนก'], ['position', 'ตำแหน่ง']]) {
            if (isFilled(body[field]) && String(body[field]).trim().length > 100) errors.push(`${label}ต้องไม่เกิน 100 ตัวอักษร`);
        }
        if (isFilled(body.start_date) && !isValidDate(body.start_date)) errors.push('รูปแบบวันที่เริ่มงานไม่ถูกต้อง');
        return {
            errors,
            data: {
                employee_code: code,
                first_name: optionalText(body.first_name),
                last_name: optionalText(body.last_name),
                department: optionalText(body.department),
                position: optionalText(body.position),
                start_date: isFilled(body.start_date) ? body.start_date : null,
                active: body.active === undefined ? 1 : (toBool(body.active) ? 1 : 0),
            },
        };
    };
    const getEmployee = (id) => {
        const employee = employeeById(id);
        if (!employee) throw notFound('ไม่พบข้อมูลพนักงาน');
        return employee;
    };
    const assertUniqueCode = (code, exceptId = 0) => {
        if (state.employees.some((e) => e.id !== exceptId && e.employee_code.toLowerCase() === code.toLowerCase())) {
            throw conflict('รหัสพนักงานนี้มีอยู่แล้ว');
        }
    };
    const fullName = (e) => `${e.first_name} ${e.last_name}`;

    // ===================== การลงเวลา =====================

    const activeAttendance = () => state.attendance.filter((a) => !a.deleted_at);
    const activeLeaves = () => state.leaves.filter((l) => !l.deleted_at);
    const onFullDayLeave = (employeeId, date) => activeLeaves().some((l) => l.employee_id === employeeId && l.status === 'approved'
        && !l.half_day && l.start_date <= date && l.end_date >= date);

    const attendanceRow = (a, settings, cal) => {
        const e = employeeById(a.employee_id);
        return {
            id: a.id,
            employee_id: a.employee_id,
            date: a.date,
            time_in: a.time_in,
            time_out: a.time_out,
            note: a.note,
            source: a.source,
            created_at: a.created_at,
            updated_at: a.updated_at,
            employee_code: e.employee_code,
            first_name: e.first_name,
            last_name: e.last_name,
            department: e.department,
            on_leave: onFullDayLeave(a.employee_id, a.date),
            ...recordMetrics(a, settings, cal),
        };
    };

    const conflictWarnings = (employeeId, date) => activeLeaves()
        .filter((l) => l.employee_id === employeeId && l.status === 'approved' && !l.half_day && l.start_date <= date && l.end_date >= date)
        .map((leave) => `วันนี้พนักงานมี${leave.leave_type}ที่อนุมัติแล้ว (${leave.start_date} ถึง ${leave.end_date}) `
            + 'กรุณาตรวจสอบว่ามาทำงานจริงหรือไม่ ถ้ามาทำงานควรแก้ไขหรือยกเลิกใบลา');

    const validateAttendance = (body = {}) => {
        const errors = [];
        if (!isPositiveInt(body.employee_id)) errors.push('กรุณาเลือกพนักงาน');
        else if (!employeeById(body.employee_id)) errors.push('ไม่พบพนักงานที่เลือก');
        if (!isFilled(body.date)) errors.push('กรุณากรอกวันที่');
        else if (!isValidDate(body.date)) errors.push('รูปแบบวันที่ไม่ถูกต้อง');
        else if (body.date > todayStr()) errors.push('วันที่ต้องไม่เกินวันนี้');
        if (!isFilled(body.time_in)) errors.push('กรุณากรอกเวลาเข้างาน');
        else if (!isValidTime(body.time_in)) errors.push('รูปแบบเวลาเข้างานไม่ถูกต้อง');
        const hasTimeOut = isFilled(body.time_out);
        if (hasTimeOut && !isValidTime(body.time_out)) errors.push('รูปแบบเวลาออกงานไม่ถูกต้อง');
        else if (hasTimeOut && isValidTime(body.time_in) && normalizeTime(body.time_out) <= normalizeTime(body.time_in)) {
            errors.push('เวลาออกงานต้องอยู่หลังเวลาเข้างาน');
        }
        if (isFilled(body.note) && String(body.note).trim().length > 255) errors.push('หมายเหตุต้องไม่เกิน 255 ตัวอักษร');
        return {
            errors,
            data: {
                employee_id: Number(body.employee_id),
                date: body.date,
                time_in: isValidTime(body.time_in) ? normalizeTime(body.time_in) : body.time_in,
                time_out: hasTimeOut && isValidTime(body.time_out) ? normalizeTime(body.time_out) : null,
                note: optionalText(body.note),
            },
        };
    };
    const DUPLICATE_ATTENDANCE = 'พนักงานคนนี้มีข้อมูลการลงเวลาของวันดังกล่าวแล้ว กรุณาแก้ไขรายการเดิมแทน';
    const assertNoDuplicateAttendance = (data, exceptId = 0) => {
        if (activeAttendance().some((a) => a.id !== exceptId && a.employee_id === data.employee_id && a.date === data.date)) {
            throw conflict(DUPLICATE_ATTENDANCE);
        }
    };
    const getAttendance = (id) => {
        const record = activeAttendance().find((a) => a.id === id);
        if (!record) throw notFound('ไม่พบข้อมูลการลงเวลา');
        return record;
    };

    // ===================== การลา =====================

    const leaveRow = (l, cal) => {
        const e = employeeById(l.employee_id);
        const decidedBy = l.decided_by ? userById(l.decided_by) : null;
        return {
            id: l.id,
            employee_id: l.employee_id,
            leave_type: l.leave_type,
            start_date: l.start_date,
            end_date: l.end_date,
            half_day: Boolean(l.half_day),
            reason: l.reason,
            status: l.status,
            status_note: l.status_note,
            approver_name: l.approver_name,
            decided_at: l.decided_at,
            created_at: l.created_at,
            updated_at: l.updated_at,
            employee_code: e.employee_code,
            first_name: e.first_name,
            last_name: e.last_name,
            department: e.department,
            position: e.position,
            decided_by_name: decidedBy ? decidedBy.display_name : null,
            days: leaveDaysInRange(l, l.start_date, l.end_date, cal),
        };
    };
    const getLeave = (id) => {
        const leave = activeLeaves().find((l) => l.id === id);
        if (!leave) throw notFound('ไม่พบข้อมูลคำขอลา');
        return leave;
    };

    const balancesFor = (employees, year, settings, excludeLeaveId = 0) => {
        const firstYear = firstYearFor(year, settings);
        const leaves = activeLeaves().filter((l) => l.status !== 'rejected' && l.id !== excludeLeaveId
            && employees.some((e) => e.id === l.employee_id) && l.start_date <= `${year}-12-31` && l.end_date >= `${firstYear}-01-01`);
        return buildBalances(employees, leaves, year, settings, calendar());
    };

    const leaveWarnings = (leave, days, settings, excludeId) => {
        const warnings = [];
        const employee = employeeById(leave.employee_id);
        if (!employee) return warnings;
        const year = Number(leave.start_date.slice(0, 4));
        const info = balancesFor([employee], year, settings, excludeId).get(employee.id);
        if (leave.leave_type === ANNUAL_LEAVE_TYPE && info.eligible_from && leave.start_date < info.eligible_from) {
            warnings.push(`พนักงานยังทำงานไม่ครบ ${settings.annual_leave_min_service_months} เดือน `
                + `(มีสิทธิ์ลาพักร้อนตั้งแต่ ${info.eligible_from})`);
        }
        const balance = info.balances[leave.leave_type];
        if (leave.status === 'approved' && balance && balance.remaining !== null && balance.remaining - days < 0) {
            warnings.push(`${leave.leave_type}ปี ${year} จะใช้รวม ${balance.used + days} วัน `
                + `เกินสิทธิ์ ${balance.quota + balance.carried} วัน`);
        }
        if (leave.status !== 'rejected' && !Number(leave.half_day)) {
            const dates = activeAttendance()
                .filter((a) => a.employee_id === leave.employee_id && a.date >= leave.start_date && a.date <= leave.end_date)
                .map((a) => a.date).sort();
            if (dates.length > 0) {
                warnings.push(`มีการลงเวลาทำงานในช่วงที่ลาแล้ว ${dates.length} วัน (${dates.join(', ')}) `
                    + 'กรุณาตรวจสอบว่าลาจริงหรือมาทำงาน');
            }
        }
        return warnings;
    };

    const validateApprover = (status, approverName) => {
        const errors = [];
        const name = optionalText(approverName);
        if ((status === 'approved' || status === 'rejected') && !name) errors.push('กรุณาระบุผู้อนุมัติ (เช่น หัวหน้างานที่เซ็นใบลา)');
        if (name && name.length > 100) errors.push('ชื่อผู้อนุมัติต้องไม่เกิน 100 ตัวอักษร');
        return errors;
    };

    const validateLeave = (body = {}, excludeId = 0) => {
        const errors = [];
        if (!isPositiveInt(body.employee_id)) errors.push('กรุณาเลือกพนักงาน');
        else if (!employeeById(body.employee_id)) errors.push('ไม่พบพนักงานที่เลือก');
        if (!isFilled(body.leave_type)) errors.push('กรุณาเลือกประเภทการลา');
        else if (!LEAVE_TYPES.includes(body.leave_type)) errors.push('ประเภทการลาไม่ถูกต้อง');
        if (!isFilled(body.reason)) errors.push('กรุณากรอกเหตุผลการลา');
        else if (String(body.reason).trim().length > 1000) errors.push('เหตุผลการลาต้องไม่เกิน 1000 ตัวอักษร');
        const startOk = isValidDate(body.start_date);
        const endOk = isValidDate(body.end_date);
        if (!isFilled(body.start_date)) errors.push('กรุณากรอกวันที่เริ่มลา');
        else if (!startOk) errors.push('รูปแบบวันที่เริ่มลาไม่ถูกต้อง');
        if (!isFilled(body.end_date)) errors.push('กรุณากรอกวันที่สิ้นสุดลา');
        else if (!endOk) errors.push('รูปแบบวันที่สิ้นสุดลาไม่ถูกต้อง');
        if (startOk && endOk && body.end_date < body.start_date) errors.push('วันที่สิ้นสุดลาต้องไม่ก่อนวันที่เริ่มลา');
        const halfDay = toBool(body.half_day);
        if (halfDay && startOk && endOk && body.start_date !== body.end_date) {
            errors.push('ลาครึ่งวันได้เฉพาะเมื่อวันเริ่มและวันสิ้นสุดเป็นวันเดียวกัน');
        }
        const status = body.status ?? 'pending';
        if (!LEAVE_STATUSES.includes(status)) errors.push('สถานะไม่ถูกต้อง');
        if (isFilled(body.status_note) && String(body.status_note).trim().length > 255) errors.push('หมายเหตุการอนุมัติต้องไม่เกิน 255 ตัวอักษร');
        errors.push(...validateApprover(status, body.approver_name));

        const data = {
            employee_id: Number(body.employee_id),
            leave_type: body.leave_type,
            start_date: body.start_date,
            end_date: body.end_date,
            half_day: halfDay ? 1 : 0,
            reason: optionalText(body.reason),
            status,
            status_note: optionalText(body.status_note),
            approver_name: optionalText(body.approver_name),
        };

        let days = 0;
        if (errors.length === 0) {
            days = leaveDaysInRange(data, data.start_date, data.end_date, calendar());
            if (days === 0) errors.push('ช่วงวันที่เลือกไม่มีวันทำงาน (ตรงกับวันหยุดทั้งหมด)');
            if (status !== 'rejected') {
                const overlaps = activeLeaves().filter((l) => l.employee_id === data.employee_id && l.status !== 'rejected'
                    && l.start_date <= data.end_date && l.end_date >= data.start_date && l.id !== excludeId);
                const twoHalfDays = halfDay && overlaps.length === 1 && overlaps[0].half_day;
                if (overlaps.length > 0 && !twoHalfDays) {
                    errors.push(`ช่วงวันที่ซ้อนกับคำขอลาที่มีอยู่แล้ว (${overlaps[0].start_date} ถึง ${overlaps[0].end_date})`);
                }
            }
        }
        return { errors, data, days };
    };

    const decisionFields = (newStatus, oldStatus, userId) => {
        if (newStatus === oldStatus) return {};
        if (newStatus === 'pending') return { decided_by: null, decided_at: null };
        return { decided_by: userId, decided_at: nowStr() };
    };

    // ===================== Excel =====================

    let excelPromise = null;
    const loadExcel = () => {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        if (!excelPromise) {
            excelPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = EXCELJS_URL;
                script.crossOrigin = 'anonymous';
                script.onload = () => resolve(window.ExcelJS);
                script.onerror = () => {
                    excelPromise = null;
                    reject(new HttpError(400, 'โหลดตัวอ่านไฟล์ Excel ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต หรือบันทึกไฟล์เป็น CSV'));
                };
                document.head.appendChild(script);
            });
        }
        return excelPromise;
    };

    // ===================== เส้นทาง API =====================

    const routes = [];
    const route = (method, pattern, handler, { auth = true } = {}) => {
        const keys = [];
        const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
        routes.push({
            method, regex, keys, handler, auth,
        });
    };

    // ----- auth -----
    route('POST', '/auth/login', (ctx) => {
        const username = String(ctx.body.username || '').trim();
        const password = String(ctx.body.password || '');
        if (!username || !password) throw badRequest(['กรุณากรอกชื่อผู้ใช้และรหัสผ่าน']);
        const user = state.users.find((u) => u.username === username);
        if (!user || !user.active || state.passwords[username] !== password) {
            logAudit(ctx, {
                action: 'login_failed', entity: 'user', entityId: user ? user.id : null, username,
            });
            throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }
        state.session.userId = user.id;
        user.last_login_at = nowStr();
        ctx.user = user;
        logAudit(ctx, { action: 'login', entity: 'user', entityId: user.id });
        return publicUser(user);
    }, { auth: false });

    route('POST', '/auth/logout', () => {
        const user = userById(state.session.userId);
        if (user) logAudit({ user }, { action: 'logout', entity: 'user', entityId: user.id });
        state.session.userId = null;
        return { message: 'ออกจากระบบแล้ว' };
    }, { auth: false });

    route('GET', '/auth/me', (ctx) => publicUser(ctx.user));

    route('POST', '/auth/change-password', (ctx) => {
        const currentPassword = String(ctx.body.current_password || '');
        const newPassword = ctx.body.new_password;
        const errors = [];
        if (!currentPassword) errors.push('กรุณากรอกรหัสผ่านปัจจุบัน');
        const passwordError = validatePassword(newPassword);
        if (passwordError) errors.push(passwordError);
        if (newPassword === currentPassword) errors.push('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
        if (errors.length > 0) throw badRequest(errors);
        if (state.passwords[ctx.user.username] !== currentPassword) throw badRequest(['รหัสผ่านปัจจุบันไม่ถูกต้อง']);
        state.passwords[ctx.user.username] = newPassword;
        ctx.user.must_change_password = 0;
        logAudit(ctx, { action: 'change_password', entity: 'user', entityId: ctx.user.id });
        return { message: 'เปลี่ยนรหัสผ่านเรียบร้อย' };
    });

    // ----- dashboard -----
    route('GET', '/dashboard', () => {
        const today = todayStr();
        const settings = state.settings;
        const cal = calendar();
        const workingDay = isWorkingDay(today, cal);
        const pick = (e) => ({
            employee_id: e.id, employee_code: e.employee_code, first_name: e.first_name, last_name: e.last_name, department: e.department,
        });
        const current = state.employees.filter((e) => e.active && (!e.start_date || e.start_date <= today));
        const attendanceToday = activeAttendance().filter((a) => a.date === today)
            .sort((a, b) => a.time_in.localeCompare(b.time_in))
            .map((a) => ({
                id: a.id, time_in: a.time_in, time_out: a.time_out, ...pick(employeeById(a.employee_id)),
            }));
        const byCode = (a, b) => a.employee_code.localeCompare(b.employee_code);
        const onLeave = activeLeaves().filter((l) => l.status === 'approved' && l.start_date <= today && l.end_date >= today)
            .map((l) => ({
                id: l.id, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date, half_day: Boolean(l.half_day), ...pick(employeeById(l.employee_id)),
            })).sort(byCode);
        const pending = activeLeaves().filter((l) => l.status === 'pending')
            .sort((a, b) => (a.start_date === b.start_date ? a.id - b.id : a.start_date.localeCompare(b.start_date)));
        const notCheckedIn = workingDay
            ? current.filter((e) => !attendanceToday.some((a) => a.employee_id === e.id) && !onFullDayLeave(e.id, today)).map(pick).sort(byCode)
            : [];
        return {
            today,
            is_working_day: workingDay,
            holiday_name: cal.holidays.get(today) || null,
            late_after: lateThreshold(settings),
            active_employees: current.length,
            checked_in: attendanceToday.length,
            late: attendanceToday.map((row) => ({ ...row, ...recordMetrics({ ...row, date: today }, settings, cal) })).filter((row) => row.is_late),
            missing_out_today: attendanceToday.filter((row) => !row.time_out).length,
            missing_out_previous: activeAttendance().filter((a) => !a.time_out && a.date < today && a.date >= addDays(today, -30)).length,
            on_leave: onLeave,
            pending_leaves: {
                total: pending.length,
                items: pending.slice(0, 10).map((l) => ({
                    id: l.id, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date, half_day: Boolean(l.half_day), reason: l.reason, ...pick(employeeById(l.employee_id)),
                })),
            },
            not_checked_in: { total: notCheckedIn.length, items: notCheckedIn.slice(0, 50) },
        };
    });

    // ----- employees -----
    route('GET', '/employees', (ctx) => {
        const q = ctx.query;
        const active = q.active ?? '1';
        const rows = state.employees.filter((e) => {
            if ((active === '1' || active === '0') && e.active !== Number(active)) return false;
            if (isFilled(q.department) && e.department !== String(q.department)) return false;
            if (isFilled(q.q) && ![e.employee_code, fullName(e), e.department, e.position].some((v) => like(v, q.q))) return false;
            return true;
        }).sort((a, b) => (b.active - a.active) || a.employee_code.localeCompare(b.employee_code));
        return paginate(rows, q);
    });
    route('GET', '/employees/departments', () => [...new Set(state.employees.map((e) => e.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th')));
    route('GET', '/employees/:id', (ctx) => getEmployee(parseId(ctx.params.id, 'ไม่พบข้อมูลพนักงาน')));
    route('POST', '/employees', (ctx) => {
        const { errors, data } = validateEmployee(ctx.body);
        if (errors.length > 0) throw badRequest(errors);
        assertUniqueCode(data.employee_code);
        const id = nextId('employees');
        state.employees.push({
            id, ...data, created_at: nowStr(), updated_at: nowStr(),
        });
        logAudit(ctx, {
            action: 'create', entity: 'employee', entityId: id, details: data,
        });
        return [201, { message: 'เพิ่มพนักงานเรียบร้อย', id }];
    });
    route('PUT', '/employees/:id', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบข้อมูลพนักงาน');
        const before = getEmployee(id);
        const { errors, data } = validateEmployee({ active: before.active, ...ctx.body });
        if (errors.length > 0) throw badRequest(errors);
        assertUniqueCode(data.employee_code, id);
        const changes = diff(before, data);
        Object.assign(before, data, { updated_at: nowStr() });
        logAudit(ctx, {
            action: 'update', entity: 'employee', entityId: id, details: changes,
        });
        return { message: 'บันทึกข้อมูลพนักงานเรียบร้อย' };
    });

    // ----- attendance -----
    route('GET', '/attendance', (ctx) => {
        const q = ctx.query;
        const settings = state.settings;
        const threshold = lateThreshold(settings);
        const cal = calendar();
        const rows = activeAttendance().filter((a) => {
            const e = employeeById(a.employee_id);
            if (isPositiveInt(q.employee_id) && a.employee_id !== Number(q.employee_id)) return false;
            if (isFilled(q.department) && e.department !== String(q.department)) return false;
            if (isValidDate(q.from) && a.date < q.from) return false;
            if (isValidDate(q.to) && a.date > q.to) return false;
            if (toBool(q.late) && !(a.time_in > threshold && isWorkingDay(a.date, cal))) return false;
            if (toBool(q.missing_out) && a.time_out) return false;
            if (toBool(q.conflict) && !onFullDayLeave(a.employee_id, a.date)) return false;
            if (isFilled(q.q) && !like(e.employee_code, q.q) && !like(fullName(e), q.q)) return false;
            return true;
        }).sort((a, b) => b.date.localeCompare(a.date)
            || employeeById(a.employee_id).employee_code.localeCompare(employeeById(b.employee_id).employee_code));
        const page = paginate(rows, q);
        page.items = page.items.map((a) => attendanceRow(a, settings, cal));
        page.late_after = threshold;
        return page;
    });
    route('GET', '/attendance/:id', (ctx) => attendanceRow(getAttendance(parseId(ctx.params.id, 'ไม่พบข้อมูลการลงเวลา')), state.settings, calendar()));
    route('POST', '/attendance', (ctx) => {
        const { errors, data } = validateAttendance(ctx.body);
        if (errors.length > 0) throw badRequest(errors);
        assertNoDuplicateAttendance(data);
        const id = nextId('attendance');
        state.attendance.push({
            id, ...data, source: 'manual', created_at: nowStr(), updated_at: nowStr(), deleted_at: null,
        });
        logAudit(ctx, {
            action: 'create', entity: 'attendance', entityId: id, details: data,
        });
        return [201, { message: 'บันทึกข้อมูลการลงเวลาเรียบร้อย', id, warnings: conflictWarnings(data.employee_id, data.date) }];
    });
    route('PUT', '/attendance/:id', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบข้อมูลการลงเวลา');
        const before = getAttendance(id);
        const { errors, data } = validateAttendance(ctx.body);
        if (errors.length > 0) throw badRequest(errors);
        assertNoDuplicateAttendance(data, id);
        const changes = diff(before, data);
        Object.assign(before, data, { updated_at: nowStr() });
        logAudit(ctx, {
            action: 'update', entity: 'attendance', entityId: id, details: changes,
        });
        return { message: 'แก้ไขข้อมูลการลงเวลาเรียบร้อย', warnings: conflictWarnings(data.employee_id, data.date) };
    });
    route('DELETE', '/attendance/:id', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบข้อมูลการลงเวลา');
        const before = getAttendance(id);
        before.deleted_at = nowStr();
        logAudit(ctx, {
            action: 'delete',
            entity: 'attendance',
            entityId: id,
            details: {
                employee_code: employeeById(before.employee_id).employee_code, date: before.date, time_in: before.time_in, time_out: before.time_out,
            },
        });
        return { message: 'ลบข้อมูลการลงเวลาเรียบร้อย' };
    });

    // ----- leave -----
    route('GET', '/leave_requests', (ctx) => {
        const q = ctx.query;
        const cal = calendar();
        const rows = activeLeaves().filter((l) => {
            const e = employeeById(l.employee_id);
            if (isPositiveInt(q.employee_id) && l.employee_id !== Number(q.employee_id)) return false;
            if (isFilled(q.department) && e.department !== String(q.department)) return false;
            if (isValidDate(q.from) && l.end_date < q.from) return false;
            if (isValidDate(q.to) && l.start_date > q.to) return false;
            if (LEAVE_STATUSES.includes(q.status) && l.status !== q.status) return false;
            if (LEAVE_TYPES.includes(q.leave_type) && l.leave_type !== q.leave_type) return false;
            if (isFilled(q.q) && !like(e.employee_code, q.q) && !like(fullName(e), q.q)) return false;
            return true;
        }).sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id);
        const page = paginate(rows, q);
        page.items = page.items.map((l) => leaveRow(l, cal));
        return page;
    });
    route('GET', '/leave_requests/approvers', () => {
        const counts = new Map();
        for (const l of activeLeaves()) {
            if (l.approver_name) counts.set(l.approver_name, (counts.get(l.approver_name) || 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
    });
    route('GET', '/leave_requests/:id', (ctx) => leaveRow(getLeave(parseId(ctx.params.id, 'ไม่พบข้อมูลคำขอลา')), calendar()));
    route('POST', '/leave_requests', (ctx) => {
        const settings = state.settings;
        const { errors, data, days } = validateLeave(ctx.body);
        if (errors.length > 0) throw badRequest(errors);
        const warnings = leaveWarnings(data, days, settings, 0);
        const id = nextId('leaves');
        state.leaves.push({
            id, ...data, decided_by: null, decided_at: null, ...decisionFields(data.status, 'pending', ctx.user.id), created_at: nowStr(), updated_at: nowStr(), deleted_at: null,
        });
        logAudit(ctx, {
            action: 'create', entity: 'leave', entityId: id, details: { ...data, days },
        });
        return [201, {
            message: 'บันทึกคำขอลาเรียบร้อย', id, days, warnings,
        }];
    });
    route('PUT', '/leave_requests/:id', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบข้อมูลคำขอลา');
        const settings = state.settings;
        const before = getLeave(id);
        const { errors, data, days } = validateLeave(ctx.body, id);
        if (errors.length > 0) throw badRequest(errors);
        const warnings = leaveWarnings(data, days, settings, id);
        const changes = diff(before, data);
        Object.assign(before, data, decisionFields(data.status, before.status, ctx.user.id), { updated_at: nowStr() });
        logAudit(ctx, {
            action: 'update', entity: 'leave', entityId: id, details: changes,
        });
        return { message: 'แก้ไขคำขอลาเรียบร้อย', days, warnings };
    });
    route('PATCH', '/leave_requests/:id/status', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบข้อมูลคำขอลา');
        const settings = state.settings;
        const before = getLeave(id);
        const { status } = ctx.body;
        const statusNote = optionalText(ctx.body.status_note);
        const approverName = optionalText(ctx.body.approver_name);
        const errors = [];
        if (!LEAVE_STATUSES.includes(status)) errors.push('สถานะไม่ถูกต้อง');
        if (statusNote && statusNote.length > 255) errors.push('หมายเหตุการอนุมัติต้องไม่เกิน 255 ตัวอักษร');
        errors.push(...validateApprover(status, approverName));
        if (errors.length > 0) throw badRequest(errors);
        if (before.status === 'rejected' && status !== 'rejected') {
            const check = validateLeave({ ...before, status, approver_name: approverName }, id);
            if (check.errors.length > 0) throw badRequest(check.errors);
        }
        const days = leaveDaysInRange(before, before.start_date, before.end_date, calendar());
        const warnings = leaveWarnings({ ...before, status }, days, settings, id);
        const changes = diff(
            { status: before.status, approver_name: before.approver_name, status_note: before.status_note },
            { status, approver_name: approverName, status_note: statusNote },
        );
        Object.assign(before, {
            status, status_note: statusNote, approver_name: approverName, ...decisionFields(status, before.status, ctx.user.id), updated_at: nowStr(),
        });
        logAudit(ctx, {
            action: 'status', entity: 'leave', entityId: id, details: changes,
        });
        return { message: 'บันทึกผลการอนุมัติเรียบร้อย', warnings };
    });
    route('DELETE', '/leave_requests/:id', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบข้อมูลคำขอลา');
        const before = getLeave(id);
        before.deleted_at = nowStr();
        logAudit(ctx, {
            action: 'delete',
            entity: 'leave',
            entityId: id,
            details: {
                employee_code: employeeById(before.employee_id).employee_code, leave_type: before.leave_type, start_date: before.start_date, end_date: before.end_date, status: before.status,
            },
        });
        return { message: 'ลบคำขอลาเรียบร้อย' };
    });

    // ----- reports -----
    route('GET', '/reports/monthly', (ctx) => {
        const today = todayStr();
        const month = isValidMonth(ctx.query.month) ? ctx.query.month : today.slice(0, 7);
        const { from, to } = monthRange(month);
        const settings = state.settings;
        const cal = calendar();
        const attendance = activeAttendance().filter((a) => a.date >= from && a.date <= to);
        const leaves = activeLeaves().filter((l) => l.status === 'approved' && l.start_date <= to && l.end_date >= from);
        const employees = state.employees.filter((e) => {
            if (isFilled(ctx.query.department) && e.department !== String(ctx.query.department)) return false;
            return (e.active && (e.start_date || e.created_at.slice(0, 10)) <= to)
                || attendance.some((a) => a.employee_id === e.id)
                || leaves.some((l) => l.employee_id === e.id);
        }).sort((a, b) => a.employee_code.localeCompare(b.employee_code));
        const rows = buildMonthlyRows({
            employees, attendance, leaves, from, to, today, settings, calendar: cal,
        });
        const holidays = state.holidays.filter((h) => h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date));
        return {
            month,
            from,
            to,
            working_days: countWorkingDays(from, to, cal),
            late_after: lateThreshold(settings),
            work_start_time: settings.work_start_time,
            work_end_time: settings.work_end_time,
            ot_min_minutes: settings.ot_min_minutes,
            leave_types: LEAVE_TYPES,
            holidays: holidays.map(({ date, name }) => ({ date, name })),
            rows,
        };
    });
    route('GET', '/reports/leave-balance', (ctx) => {
        const year = /^\d{4}$/.test(String(ctx.query.year)) ? Number(ctx.query.year) : Number(todayStr().slice(0, 4));
        const settings = state.settings;
        let employees = isPositiveInt(ctx.query.employee_id)
            ? state.employees.filter((e) => e.id === Number(ctx.query.employee_id))
            : state.employees.filter((e) => e.active);
        if (isFilled(ctx.query.department)) employees = employees.filter((e) => e.department === String(ctx.query.department));
        employees.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
        const balances = balancesFor(employees, year, settings);
        return {
            year,
            leave_types: LEAVE_TYPES,
            quotas: settings.leave_quotas,
            annual_leave_min_service_months: settings.annual_leave_min_service_months,
            annual_leave_carry_over_max: settings.annual_leave_carry_over_max,
            rows: employees.map((e) => ({ ...employeeInfo(e), start_date: e.start_date, ...balances.get(e.id) })),
        };
    });

    // ----- import -----
    route('POST', '/import/parse-xlsx', async (ctx) => {
        const file = ctx.rawBody;
        if (!file || !file.size) throw badRequest(['ไม่พบไฟล์']);
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
            throw badRequest(['ไฟล์นี้ไม่ใช่ Excel แบบ .xlsx (ถ้าเป็น .xls รุ่นเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx หรือ CSV)']);
        }
        const ExcelJS = await loadExcel();
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(buffer);
        } catch {
            throw badRequest(['อ่านไฟล์ Excel ไม่ได้ ไฟล์อาจเสียหรือมีรหัสผ่าน']);
        }
        const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
        if (!sheet) throw badRequest(['ไม่พบข้อมูลในไฟล์']);
        if (sheet.actualRowCount > MAX_SHEET_ROWS) throw badRequest([`ไฟล์มีมากกว่า ${MAX_SHEET_ROWS} แถว กรุณาแบ่งไฟล์`]);
        return { sheet: sheet.name, rows: sheetRows(sheet) };
    });
    route('POST', '/import/attendance', (ctx) => {
        const inputRows = Array.isArray(ctx.body.rows) ? ctx.body.rows : null;
        if (!inputRows || inputRows.length === 0) throw badRequest(['ไม่พบข้อมูลที่จะนำเข้า']);
        if (inputRows.length > MAX_ROWS) throw badRequest([`นำเข้าได้ครั้งละไม่เกิน ${MAX_ROWS} แถว กรุณาแบ่งไฟล์`]);
        const dryRun = ctx.body.dry_run === undefined ? true : toBool(ctx.body.dry_run);
        const { results, entries } = mergeRows(inputRows, todayStr());
        const employeesByCode = new Map(state.employees.map((e) => [e.employee_code.toLowerCase(), e]));
        const existing = new Map(activeAttendance().map((a) => [`${a.employee_id}|${a.date}`, a]));
        const leaveOn = (employeeId, date) => activeLeaves().find((l) => l.employee_id === employeeId && l.status === 'approved'
            && !l.half_day && l.start_date <= date && l.end_date >= date);
        const { actions, summary } = planImport({
            entries, results, employeesByCode, existing, leaveOn, rowCount: inputRows.length,
        });
        if (dryRun) return { dry_run: true, summary, results };
        for (const action of actions) {
            if (action.type === 'create') {
                state.attendance.push({
                    id: nextId('attendance'),
                    employee_id: action.employee.id,
                    date: action.entry.date,
                    time_in: action.entry.time_in,
                    time_out: action.entry.time_out,
                    note: null,
                    source: 'import',
                    created_at: nowStr(),
                    updated_at: nowStr(),
                    deleted_at: null,
                });
            } else {
                Object.assign(action.current, { time_in: action.timeIn, time_out: action.timeOut, updated_at: nowStr() });
            }
        }
        logAudit(ctx, {
            action: 'import',
            entity: 'attendance',
            details: { ...summary, file_name: isFilled(ctx.body.file_name) ? String(ctx.body.file_name).slice(0, 200) : null },
        });
        return { dry_run: false, summary, results };
    });

    // ----- settings / holidays -----
    route('GET', '/settings', () => ({ ...clone(state.settings), leave_types: LEAVE_TYPES }));
    route('PUT', '/settings', (ctx) => {
        requireAdmin(ctx);
        const body = ctx.body || {};
        const before = state.settings;
        const errors = [];
        const companyName = isFilled(body.company_name) ? String(body.company_name).trim() : '';
        if (companyName.length > 150) errors.push('ชื่อบริษัทต้องไม่เกิน 150 ตัวอักษร');
        if (!isValidTime(body.work_start_time)) errors.push('รูปแบบเวลาเข้างานไม่ถูกต้อง');
        if (!isValidTime(body.work_end_time)) errors.push('รูปแบบเวลาเลิกงานไม่ถูกต้อง');
        if (isValidTime(body.work_start_time) && isValidTime(body.work_end_time)
            && normalizeTime(body.work_end_time) <= normalizeTime(body.work_start_time)) errors.push('เวลาเลิกงานต้องอยู่หลังเวลาเข้างาน');
        const integerSetting = (key, label, min, max) => {
            if (body[key] === undefined || body[key] === '') return before[key];
            const value = Number(body[key]);
            if (!Number.isInteger(value) || value < min || value > max) errors.push(`${label}ต้องเป็นจำนวนเต็ม ${min}-${max}`);
            return value;
        };
        const grace = integerSetting('late_grace_minutes', 'เวลาผ่อนผันการมาสาย (นาที) ', 0, 240);
        const otMin = integerSetting('ot_min_minutes', 'OT ขั้นต่ำ (นาที) ', 0, 240);
        const serviceMonths = integerSetting('annual_leave_min_service_months', 'อายุงานขั้นต่ำก่อนลาพักร้อน (เดือน) ', 0, 60);
        const carryOver = integerSetting('annual_leave_carry_over_max', 'วันลาพักร้อนสะสมสูงสุด ', 0, 60);
        const workDays = Array.isArray(body.work_days) ? [...new Set(body.work_days.map(Number))].sort() : [];
        if (workDays.length === 0 || workDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) errors.push('กรุณาเลือกวันทำงานอย่างน้อย 1 วัน');
        const quotas = {};
        const inputQuotas = body.leave_quotas || {};
        for (const type of LEAVE_TYPES) {
            const value = inputQuotas[type];
            if (value === undefined || value === null || value === '') continue;
            const number = Number(value);
            if (!Number.isFinite(number) || number < 0 || number > 365 || number * 2 !== Math.round(number * 2)) {
                errors.push(`โควตา${type}ต้องเป็นตัวเลข 0-365 (ใส่ทีละครึ่งวันได้)`);
            } else {
                quotas[type] = number;
            }
        }
        if (errors.length > 0) throw badRequest(errors);
        const after = {
            company_name: companyName,
            work_start_time: body.work_start_time.slice(0, 5),
            work_end_time: body.work_end_time.slice(0, 5),
            late_grace_minutes: grace,
            ot_min_minutes: otMin,
            work_days: workDays,
            leave_quotas: quotas,
            annual_leave_min_service_months: serviceMonths,
            annual_leave_carry_over_max: carryOver,
        };
        const changes = diff(
            Object.fromEntries(Object.entries(before).map(([k, v]) => [k, JSON.stringify(v)])),
            Object.fromEntries(Object.entries(after).map(([k, v]) => [k, JSON.stringify(v)])),
        );
        state.settings = { ...before, ...after };
        logAudit(ctx, { action: 'update', entity: 'settings', details: changes });
        return { message: 'บันทึกการตั้งค่าเรียบร้อย' };
    });
    route('GET', '/holidays', (ctx) => {
        const year = /^\d{4}$/.test(String(ctx.query.year)) ? ctx.query.year : todayStr().slice(0, 4);
        const items = state.holidays.filter((h) => h.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date));
        return { items, year: Number(year) };
    });
    route('POST', '/holidays', (ctx) => {
        const { date, name } = ctx.body || {};
        const errors = [];
        if (!isValidDate(date)) errors.push('กรุณากรอกวันที่ให้ถูกต้อง');
        if (!isFilled(name)) errors.push('กรุณากรอกชื่อวันหยุด');
        else if (String(name).trim().length > 100) errors.push('ชื่อวันหยุดต้องไม่เกิน 100 ตัวอักษร');
        if (errors.length > 0) throw badRequest(errors);
        if (state.holidays.some((h) => h.date === date)) throw conflict('วันที่นี้ถูกตั้งเป็นวันหยุดแล้ว');
        const id = nextId('holidays');
        state.holidays.push({ id, date, name: String(name).trim() });
        logAudit(ctx, {
            action: 'create', entity: 'holiday', entityId: id, details: { date, name },
        });
        return [201, { message: 'เพิ่มวันหยุดเรียบร้อย', id }];
    });
    route('POST', '/holidays/bulk', (ctx) => {
        const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
        if (items.length === 0) throw badRequest(['ไม่มีวันหยุดที่จะเพิ่ม']);
        if (items.length > 100) throw badRequest(['เพิ่มได้ครั้งละไม่เกิน 100 วัน']);
        const errors = [];
        items.forEach((item, index) => {
            if (!isValidDate(item.date)) errors.push(`รายการที่ ${index + 1}: วันที่ไม่ถูกต้อง`);
            if (!isFilled(item.name) || String(item.name).trim().length > 100) errors.push(`รายการที่ ${index + 1}: ชื่อวันหยุดไม่ถูกต้อง`);
        });
        if (errors.length > 0) throw badRequest(errors);
        const created = [];
        const skipped = [];
        for (const item of items) {
            if (state.holidays.some((h) => h.date === item.date)) {
                skipped.push(item.date);
                continue;
            }
            const holiday = { id: nextId('holidays'), date: item.date, name: String(item.name).trim() };
            state.holidays.push(holiday);
            created.push(holiday);
        }
        if (created.length > 0) {
            logAudit(ctx, { action: 'create', entity: 'holiday', details: { คัดลอก: created.length, dates: created.map((h) => h.date).join(', ') } });
        }
        return [201, { message: `เพิ่มวันหยุด ${created.length} วัน`, created: created.length, skipped }];
    });
    route('DELETE', '/holidays/:id', (ctx) => {
        const id = parseId(ctx.params.id, 'ไม่พบวันหยุด');
        const index = state.holidays.findIndex((h) => h.id === id);
        if (index < 0) throw notFound('ไม่พบวันหยุด');
        const [removed] = state.holidays.splice(index, 1);
        logAudit(ctx, {
            action: 'delete', entity: 'holiday', entityId: id, details: { date: removed.date, name: removed.name },
        });
        return { message: 'ลบวันหยุดเรียบร้อย' };
    });

    // ----- users (admin) -----
    const ROLES = ['admin', 'hr'];
    const USERNAME_RE = /^[a-zA-Z0-9._-]{3,50}$/;
    const userRow = (u) => ({
        id: u.id, username: u.username, display_name: u.display_name, role: u.role, active: u.active, must_change_password: u.must_change_password, last_login_at: u.last_login_at, created_at: u.created_at,
    });
    route('GET', '/users', (ctx) => {
        requireAdmin(ctx);
        return { items: [...state.users].sort((a, b) => (b.active - a.active) || a.username.localeCompare(b.username)).map(userRow) };
    });
    route('POST', '/users', (ctx) => {
        requireAdmin(ctx);
        const {
            username, display_name: displayName, role = 'hr', password,
        } = ctx.body;
        const errors = [];
        if (!isFilled(username) || !USERNAME_RE.test(username)) errors.push('ชื่อผู้ใช้ต้องมี 3-50 ตัว ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด และขีดล่าง');
        if (!isFilled(displayName)) errors.push('กรุณากรอกชื่อที่แสดง');
        else if (String(displayName).trim().length > 100) errors.push('ชื่อที่แสดงต้องไม่เกิน 100 ตัวอักษร');
        if (!ROLES.includes(role)) errors.push('สิทธิ์ไม่ถูกต้อง');
        const passwordError = validatePassword(password);
        if (passwordError) errors.push(passwordError);
        if (errors.length > 0) throw badRequest(errors);
        if (state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw conflict('ชื่อผู้ใช้นี้มีอยู่แล้ว');
        const id = nextId('users');
        state.users.push({
            id, username, display_name: String(displayName).trim(), role, active: 1, must_change_password: 1, last_login_at: null, created_at: nowStr(),
        });
        state.passwords[username] = password;
        logAudit(ctx, {
            action: 'create', entity: 'user', entityId: id, details: { username, display_name: displayName, role },
        });
        return [201, { message: 'เพิ่มผู้ใช้เรียบร้อย', id }];
    });
    route('PUT', '/users/:id', (ctx) => {
        requireAdmin(ctx);
        const id = parseId(ctx.params.id, 'ไม่พบผู้ใช้');
        const before = userById(id);
        if (!before) throw notFound('ไม่พบผู้ใช้');
        const { body } = ctx;
        const after = {
            display_name: isFilled(body.display_name) ? String(body.display_name).trim() : before.display_name,
            role: body.role ?? before.role,
            active: body.active === undefined ? before.active : (toBool(body.active) ? 1 : 0),
        };
        const errors = [];
        if (after.display_name.length > 100) errors.push('ชื่อที่แสดงต้องไม่เกิน 100 ตัวอักษร');
        if (!ROLES.includes(after.role)) errors.push('สิทธิ์ไม่ถูกต้อง');
        if (isFilled(body.password)) {
            const passwordError = validatePassword(body.password);
            if (passwordError) errors.push(passwordError);
        }
        if (id === ctx.user.id && (after.role !== 'admin' || !after.active)) errors.push('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
        const removesAdmin = before.role === 'admin' && before.active && (after.role !== 'admin' || !after.active);
        if (removesAdmin && state.users.filter((u) => u.role === 'admin' && u.active).length <= 1) errors.push('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
        if (errors.length > 0) throw badRequest(errors);
        const details = diff(before, after);
        Object.assign(before, after);
        if (isFilled(body.password)) {
            state.passwords[before.username] = body.password;
            before.must_change_password = 1;
            details.password = 'รีเซ็ตรหัสผ่าน';
        }
        logAudit(ctx, {
            action: 'update', entity: 'user', entityId: id, details,
        });
        return { message: 'บันทึกข้อมูลผู้ใช้เรียบร้อย' };
    });

    // ----- audit (admin) -----
    route('GET', '/audit', (ctx) => {
        requireAdmin(ctx);
        const q = ctx.query;
        const rows = state.audit.filter((row) => {
            if (q.entity && row.entity !== String(q.entity)) return false;
            if (q.action && row.action !== String(q.action)) return false;
            if (isPositiveInt(q.user_id) && row.user_id !== Number(q.user_id)) return false;
            if (isPositiveInt(q.entity_id) && row.entity_id !== Number(q.entity_id)) return false;
            if (isValidDate(q.from) && row.created_at < `${q.from} 00:00:00`) return false;
            if (isValidDate(q.to) && row.created_at > `${q.to} 23:59:59`) return false;
            return true;
        }).sort((a, b) => b.id - a.id);
        return paginate(rows, q, { defaultSize: 50, maxSize: 500 });
    });

    // ===================== ตัวรับคำขอ (แทน fetch) =====================

    const jsonResponse = (status, data) => new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json' },
    });

    const handle = async (url, options = {}) => {
        const parsed = new URL(url, window.location.href);
        const path = parsed.pathname.replace(/^.*?\/api(?=\/)/, '');
        const method = (options.method || 'GET').toUpperCase();
        const query = Object.fromEntries(parsed.searchParams.entries());
        let body = {};
        let rawBody = null;
        if (typeof options.body === 'string') {
            try {
                body = JSON.parse(options.body);
            } catch {
                return jsonResponse(400, { message: 'ข้อมูลที่ส่งมาไม่ใช่ JSON ที่ถูกต้อง', errors: [] });
            }
        } else if (options.body instanceof Blob) {
            rawBody = options.body;
        }

        // ให้รู้สึกเหมือนเรียกเซิร์ฟเวอร์จริง (ปุ่มแสดงสถานะกำลังบันทึกได้)
        await new Promise((resolve) => { setTimeout(resolve, 60); });

        const candidates = routes.filter((r) => r.regex.test(path));
        const matched = candidates.find((r) => r.method === method);
        if (!matched) {
            return jsonResponse(candidates.length > 0 ? 405 : 404, { message: 'ไม่พบ API ที่เรียก', errors: [] });
        }

        const params = {};
        const values = path.match(matched.regex).slice(1);
        matched.keys.forEach((key, index) => { params[key] = decodeURIComponent(values[index]); });
        const ctx = {
            params, query, body, rawBody, user: null,
        };

        try {
            if (matched.auth) {
                const user = userById(state.session.userId);
                if (!user || !user.active) {
                    state.session.userId = null;
                    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
                }
                ctx.user = user;
                if (user.must_change_password && !path.startsWith('/auth/')) {
                    throw new HttpError(403, 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน', [], { code: 'MUST_CHANGE_PASSWORD' });
                }
            }
            const result = await matched.handler(ctx);
            const [status, data] = Array.isArray(result) && typeof result[0] === 'number' && result.length === 2 && !Array.isArray(result[1])
                ? result : [200, result];
            save();
            return jsonResponse(status, data);
        } catch (error) {
            save();
            if (error instanceof HttpError) {
                return jsonResponse(error.status, { message: error.message, errors: error.errors, ...error.extra });
            }
            console.error('[demo]', error);
            return jsonResponse(500, { message: 'เกิดข้อผิดพลาดในโหมดทดลอง', errors: [] });
        }
    };

    const reset = () => {
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch {
            // ไม่เป็นไร
        }
        state = createSeed();
        save();
    };

    window.DemoServer = {
        fetch: (url, options) => {
            const text = String(url);
            if (!/\/api\//.test(new URL(text, window.location.href).pathname)) return window.fetch(url, options);
            return handle(text, options);
        },
        reset,
        credentials: { username: 'demo', password: DEMO_PASSWORD },
    };
})();
