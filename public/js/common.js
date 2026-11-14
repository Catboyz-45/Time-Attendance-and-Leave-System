// ฟังก์ชันที่ใช้ร่วมกันทุกหน้า (โหลดไฟล์นี้ก่อนสคริปต์ของแต่ละหน้า)

const LEAVE_TYPES = ['ลาป่วย', 'ลากิจ', 'ลาพักร้อน', 'อื่น ๆ'];
const LEAVE_STATUS_LABELS = { pending: 'รออนุมัติ', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ' };
const WEEKDAY_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// ไอคอนเส้น (SVG) ที่ใช้ในเมนูและปุ่ม
const ICON_PATHS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-5-5.7"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    upload: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    print: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
};

const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

// เมนูด้านซ้าย แบ่งเป็นกลุ่ม (adminOnly = แสดงเฉพาะผู้ดูแลระบบ)
const NAV_GROUPS = [
    {
        label: 'งานประจำวัน',
        items: [
            { page: 'dashboard', href: 'index.html', label: 'ภาพรวม', icon: 'dashboard' },
            { page: 'attendance', href: 'history.html?tab=attendance', label: 'การลงเวลา', icon: 'clock' },
            { page: 'leave', href: 'history.html?tab=leave', label: 'การลา', icon: 'calendar', countId: 'nav-pending-count' },
        ],
    },
    {
        label: 'ข้อมูล',
        items: [
            { page: 'employees', href: 'employees.html', label: 'พนักงาน', icon: 'users' },
            { page: 'reports', href: 'reports.html', label: 'รายงาน', icon: 'chart' },
            { page: 'import', href: 'import.html', label: 'นำเข้าข้อมูล', icon: 'upload' },
        ],
    },
    {
        label: 'ระบบ',
        items: [
            { page: 'settings', href: 'settings.html', label: 'ตั้งค่า', icon: 'settings' },
            { page: 'audit', href: 'audit.html', label: 'ประวัติการแก้ไข', icon: 'history', adminOnly: true },
        ],
    },
];

const App = { user: null };

// ===================== เรียก API =====================

class ApiError extends Error {
    constructor(message, status, errors = []) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
}

const buildQuery = (query) => {
    const params = new URLSearchParams();
    Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const text = params.toString();
    return text ? `?${text}` : '';
};

const redirectToLogin = () => {
    const next = window.location.pathname.split('/').pop() + window.location.search;
    window.location.href = `login.html${buildQuery({ next })}`;
};

// เรียก API แล้วคืนค่า JSON ถ้าเซิร์ฟเวอร์ตอบ error จะ throw ApiError พร้อมข้อความจากเซิร์ฟเวอร์
const api = async (path, { method = 'GET', body, query } = {}) => {
    let response;
    try {
        response = await fetch(`/api${path}${buildQuery(query)}`, {
            method,
            credentials: 'same-origin',
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch (error) {
        throw new ApiError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบเครือข่าย', 0);
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && !path.startsWith('/auth/login')) {
        redirectToLogin();
        throw new ApiError('กรุณาเข้าสู่ระบบ', 401);
    }
    if (response.status === 403 && data.code === 'MUST_CHANGE_PASSWORD') {
        window.location.href = 'settings.html#password';
        throw new ApiError(data.message, 403);
    }
    if (!response.ok) {
        throw new ApiError(data.message || `เกิดข้อผิดพลาด (${response.status})`, response.status, data.errors || []);
    }
    return data;
};

// ===================== เริ่มต้นหน้า: ตรวจ login แล้ววาดเมนู =====================

const renderHeader = (user) => {
    const header = document.getElementById('app-header');
    if (!header) return;
    const currentPage = document.body.dataset.page;
    const groups = NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.adminOnly || user.role === 'admin');
        if (items.length === 0) return '';
        const links = items.map((item) => {
            const active = item.page === currentPage;
            const count = item.countId ? `<span class="nav-count hidden" id="${item.countId}"></span>` : '';
            return `<a href="${item.href}" class="${active ? 'active' : ''}"${active ? ' aria-current="page"' : ''}>${icon(item.icon)}<span>${escapeHtml(item.label)}</span>${count}</a>`;
        }).join('');
        return `<div class="nav-group"><div class="nav-group-label">${escapeHtml(group.label)}</div>${links}</div>`;
    }).join('');

    const roleLabel = user.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ฝ่ายบุคคล (HR)';
    const initial = Array.from((user.display_name || user.username || '?').trim())[0] || '?';

    header.className = 'sidebar';
    header.innerHTML = `
        <div class="sidebar-top">
            <a class="brand" href="index.html">
                <span class="brand-mark">${icon('clock', 20)}</span>
                <span class="brand-text"><strong>ลงเวลาและการลา</strong><span>สำหรับฝ่ายบุคคล</span></span>
            </a>
            <button type="button" class="icon-btn menu-toggle" id="menu-toggle" aria-expanded="false" aria-controls="sidebar-body" aria-label="เปิดเมนู">${icon('menu', 20)}</button>
        </div>
        <div class="sidebar-body" id="sidebar-body">
            <nav class="nav" aria-label="เมนูหลัก">${groups}</nav>
            <div class="user-box">
                <span class="avatar" aria-hidden="true">${escapeHtml(initial)}</span>
                <span class="user-info">
                    <span class="name" title="${escapeHtml(user.username)}">${escapeHtml(user.display_name)}</span>
                    <span class="role">${roleLabel}</span>
                </span>
                <button type="button" class="icon-btn" id="logout-btn" aria-label="ออกจากระบบ" title="ออกจากระบบ">${icon('logout', 16)}</button>
            </div>
        </div>`;

    const toggle = document.getElementById('menu-toggle');
    toggle.addEventListener('click', () => {
        const open = header.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
        toggle.innerHTML = icon(open ? 'close' : 'menu', 20);
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await api('/auth/logout', { method: 'POST' });
        } finally {
            window.location.href = 'login.html';
        }
    });

    refreshPendingCount();
};

// ตัวเลขใบลารอผลข้างเมนู "การลา" (ไม่สำคัญพอจะแจ้ง error ถ้าโหลดไม่ได้)
const refreshPendingCount = async () => {
    const badge = document.getElementById('nav-pending-count');
    if (!badge) return;
    try {
        const { total } = await api('/leave_requests', { query: { status: 'pending', page_size: 1 } });
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.title = `ใบลารอผลอนุมัติ ${total} รายการ`;
        badge.classList.toggle('hidden', !total);
    } catch (error) {
        badge.classList.add('hidden');
    }
};

// ใช้แทน DOMContentLoaded ในทุกหน้าที่ต้อง login: init(user) จะถูกเรียกหลังตรวจสิทธิ์แล้ว
const onAppReady = (init) => {
    document.addEventListener('DOMContentLoaded', async () => {
        try {
            App.user = await api('/auth/me');
        } catch (error) {
            if (error.status !== 401) showFatal(error.message);
            return;
        }

        if (App.user.must_change_password && document.body.dataset.page !== 'settings') {
            window.location.href = 'settings.html#password';
            return;
        }

        renderHeader(App.user);
        document.body.classList.remove('app-loading');
        showFlash();

        try {
            await init(App.user);
        } catch (error) {
            console.error(error);
            showPageMessage('danger', error.message || 'เกิดข้อผิดพลาด');
        }
    });
};

const showFatal = (message) => {
    document.body.classList.remove('app-loading');
    const main = document.querySelector('main');
    if (main) main.innerHTML = `<div class="message danger">${escapeHtml(message)}</div>`;
};

// ===================== ข้อความแจ้งเตือน =====================

const showMessage = (messageDom, type, message, errors = []) => {
    if (!messageDom) return;
    messageDom.textContent = '';
    const title = document.createElement('div');
    title.textContent = message;
    messageDom.appendChild(title);

    if (errors && errors.length > 0) {
        const list = document.createElement('ul');
        errors.forEach((error) => {
            const item = document.createElement('li');
            item.textContent = error;
            list.appendChild(item);
        });
        messageDom.appendChild(list);
    }
    messageDom.className = `message ${type}`;
};

const hideMessage = (messageDom) => {
    if (messageDom) messageDom.className = 'message';
};

// กล่องข้อความหลักของหน้า (<div id="page-message">)
const showPageMessage = (type, message, errors = []) => {
    const dom = document.getElementById('page-message');
    showMessage(dom, type, message, errors);
    if (dom) dom.scrollIntoView({ block: 'nearest' });
};

const showError = (error, dom = document.getElementById('page-message')) => {
    showMessage(dom, 'danger', error.message || 'เกิดข้อผิดพลาด', error.errors || []);
    if (dom) dom.scrollIntoView({ block: 'nearest' });
};

// ข้อความที่จะแสดงในหน้าถัดไปหลัง redirect (เช่น "บันทึกเรียบร้อย")
const setFlash = (type, message, errors = []) => {
    try {
        sessionStorage.setItem('flash', JSON.stringify({ type, message, errors }));
    } catch {
        // ไม่เป็นไรถ้าเก็บไม่ได้
    }
};

const showFlash = () => {
    try {
        const raw = sessionStorage.getItem('flash');
        if (!raw) return;
        sessionStorage.removeItem('flash');
        const flash = JSON.parse(raw);
        showPageMessage(flash.type, flash.message, flash.errors);
    } catch {
        // ไม่เป็นไรถ้าอ่านไม่ได้
    }
};

// ===================== จัดรูปแบบข้อมูล =====================

// แปลงอักขระพิเศษก่อนใส่ลง HTML เพื่อป้องกัน XSS (ใช้กับทุกค่าที่มาจากฐานข้อมูล)
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// 'YYYY-MM-DD' -> '2 เม.ย. 2568' (สร้าง Date จากปี/เดือน/วันโดยตรง ไม่ให้ timezone ทำให้วันเลื่อน)
const formatThaiDate = (dateString, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString || '');
    if (!match) return '-';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString('th-TH', options);
};

const formatDateRange = (start, end) => (start === end ? formatThaiDate(start) : `${formatThaiDate(start)} – ${formatThaiDate(end)}`);

// 'YYYY-MM-DD HH:MM:SS' -> '2 เม.ย. 2568 14:05'
const formatDateTime = (value) => {
    if (!value) return '-';
    const [date, time = ''] = String(value).split(/[ T]/);
    return `${formatThaiDate(date)} ${time.slice(0, 5)}`.trim();
};

// '08:30:00' -> '08:30'
const formatTime = (timeString) => (timeString ? timeString.slice(0, 5) : '-');

// 'YYYY-MM' -> 'เมษายน 2568'
const formatThaiMonth = (month) => formatThaiDate(`${month}-01`, { month: 'long', year: 'numeric' });

// นาที -> '45 นาที' หรือ '1 ชม. 30 นาที'
const formatMinutes = (minutes) => {
    const value = Math.round(Number(minutes) || 0);
    if (value < 60) return `${value} นาที`;
    const hours = Math.floor(value / 60);
    const rest = value % 60;
    return rest ? `${hours} ชม. ${rest} นาที` : `${hours} ชม.`;
};

// นาที -> ชั่วโมงทศนิยม 2 ตำแหน่ง (สำหรับรายงานเงินเดือน เช่น 90 -> 1.50)
const minutesToHours = (minutes) => (Math.round((Number(minutes) || 0) / 60 * 100) / 100).toFixed(2);

const formatDays = (value) => {
    if (value === null || value === undefined) return '-';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const employeeName = (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim();
const employeeLabel = (row) => `${row.employee_code} · ${employeeName(row)}`;

// ช่องพนักงานในตาราง: ชื่อตัวหนา บรรทัดล่างเป็นรหัสและแผนก
const employeeCell = (row) => `<div class="cell-title">${escapeHtml(employeeName(row))}</div>
    <div class="sub">${escapeHtml([row.employee_code, row.department].filter(Boolean).join(' · '))}</div>`;

// ปุ่มไอคอนในแถวตาราง (มีข้อความบอกสำหรับโปรแกรมอ่านหน้าจอและ tooltip)
const iconButton = (name, label, attrs = '', extraClass = '') => `<button type="button" class="btn secondary sm icon-only ${extraClass}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${attrs}>${icon(name, 16)}</button>`;
const iconLink = (name, label, href, attrs = '') => `<a class="btn secondary sm icon-only" href="${escapeHtml(href)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ${attrs}>${icon(name, 16)}</a>`;

const statusBadge = (status) => `<span class="badge ${escapeHtml(status)}">${escapeHtml(LEAVE_STATUS_LABELS[status] || status)}</span>`;

// วันนี้ตามเวลาเครื่องของผู้ใช้ เป็น 'YYYY-MM-DD'
const todayStr = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const currentMonth = () => todayStr().slice(0, 7);

const getParam = (name) => new URLSearchParams(window.location.search).get(name);

const debounce = (fn, wait = 300) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
};

// ปิดปุ่มระหว่างรอ เพื่อกันกดซ้ำ
const withBusy = async (button, work) => {
    if (button) button.disabled = true;
    try {
        return await work();
    } finally {
        if (button) button.disabled = false;
    }
};

// อ่านค่าจากฟอร์มเป็น object (checkbox -> true/false)
const formValues = (form) => {
    const values = {};
    Array.from(form.elements).forEach((element) => {
        if (!element.name || element.disabled) return;
        if (element.type === 'checkbox') values[element.name] = element.checked;
        else values[element.name] = typeof element.value === 'string' ? element.value.trim() : element.value;
    });
    return values;
};

const setFormValues = (form, values) => {
    Object.entries(values).forEach(([name, value]) => {
        const element = form.elements.namedItem(name);
        if (!element) return;
        if (element.type === 'checkbox') element.checked = Boolean(value);
        else element.value = value ?? '';
    });
};

// ===================== ข้อมูลที่ใช้บ่อย =====================

let employeesCache = null;

// รายชื่อพนักงานทั้งหมด (รวมคนที่ปิดสถานะแล้ว) สำหรับช่องเลือก
const loadEmployees = async () => {
    if (!employeesCache) {
        const data = await api('/employees', { query: { active: 'all', page_size: 5000 } });
        employeesCache = data.items;
    }
    return employeesCache;
};

// เติมตัวเลือกพนักงานลงใน <select> (คนที่ปิดสถานะแล้วจะแสดงเฉพาะเมื่อ includeInactive หรือถูกเลือกอยู่)
const fillEmployeeSelect = (select, employees, { selected = '', placeholder = 'เลือกพนักงาน', includeInactive = false } = {}) => {
    const options = employees
        .filter((employee) => employee.active || includeInactive || String(employee.id) === String(selected))
        .map((employee) => {
            const suffix = employee.active ? '' : ' (ปิดสถานะ)';
            const department = employee.department ? ` – ${employee.department}` : '';
            return `<option value="${employee.id}">${escapeHtml(employeeLabel(employee) + department + suffix)}</option>`;
        });
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${options.join('')}`;
    select.value = selected ? String(selected) : '';
};

const fillDepartmentSelect = async (select, placeholder = 'ทุกแผนก') => {
    const departments = await api('/employees/departments');
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${departments
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
};

const fillOptions = (select, items, placeholder) => {
    select.innerHTML = (placeholder !== undefined ? `<option value="">${escapeHtml(placeholder)}</option>` : '')
        + items.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
};

// ===================== บันทึกผลการอนุมัติการลา =====================
// การอนุมัติเกิดนอกระบบ (หัวหน้าเซ็นใบลา/ตอบใน LINE) HR เป็นผู้บันทึกผลและระบุว่าใครอนุมัติ

let approversCache = null;

// รายชื่อผู้อนุมัติที่เคยบันทึก ใช้เป็นตัวเลือกใน <datalist>
const loadApprovers = async () => {
    if (!approversCache) approversCache = await api('/leave_requests/approvers');
    return approversCache;
};

const fillApproverList = async (datalist) => {
    const names = await loadApprovers();
    datalist.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
};

// เปิดกล่องบันทึกผล คืนค่า { approver_name, status_note } หรือ null ถ้ากดยกเลิก
const openDecisionDialog = async ({ status, leave }) => {
    const approve = status === 'approved';
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
        <form method="dialog" novalidate>
            <h2>${approve ? 'บันทึกผล: อนุมัติ' : 'บันทึกผล: ไม่อนุมัติ'}</h2>
            <p class="muted small">${escapeHtml(employeeLabel(leave))} · ${escapeHtml(leave.leave_type)}${leave.half_day ? ' (ครึ่งวัน)' : ''}
                · ${escapeHtml(formatDateRange(leave.start_date, leave.end_date))}</p>
            <div class="message" data-role="error"></div>
            <div class="field">
                <label for="dialog-approver">ผู้อนุมัติ (เช่น หัวหน้างานที่เซ็นใบลา)</label>
                <input id="dialog-approver" name="approver_name" type="text" maxlength="100" list="dialog-approvers" autocomplete="off" required>
                <datalist id="dialog-approvers"></datalist>
            </div>
            <div class="field">
                <label for="dialog-note">${approve ? 'หมายเหตุ (ไม่บังคับ)' : 'เหตุผลที่ไม่อนุมัติ (ไม่บังคับ)'}</label>
                <input id="dialog-note" name="status_note" type="text" maxlength="255" placeholder="${approve ? 'เช่น มีใบรับรองแพทย์' : 'เช่น ช่วงปิดงบ'}">
            </div>
            <div class="form-actions">
                <button type="button" class="btn secondary" value="cancel" data-role="cancel">ยกเลิก</button>
                <button type="submit" class="btn ${approve ? 'success' : 'danger'}" value="ok">บันทึกผล</button>
            </div>
        </form>`;
    document.body.appendChild(dialog);

    const form = dialog.querySelector('form');
    const approverInput = form.elements.approver_name;
    approverInput.value = leave.approver_name || '';
    fillApproverList(dialog.querySelector('datalist')).catch(() => {});

    return new Promise((resolve) => {
        let result = null;
        form.addEventListener('submit', (event) => {
            const values = formValues(form);
            if (!values.approver_name) {
                event.preventDefault();
                showMessage(dialog.querySelector('[data-role=error]'), 'danger', 'กรุณาระบุผู้อนุมัติ');
                approverInput.focus();
                return;
            }
            result = { approver_name: values.approver_name, status_note: values.status_note };
        });
        dialog.querySelector('[data-role=cancel]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => {
            dialog.remove();
            if (result) approversCache = null; // มีชื่อใหม่ ให้โหลดรายชื่อใหม่ครั้งหน้า
            resolve(result);
        });
        dialog.showModal();
        approverInput.focus();
    });
};

// บันทึกผลอนุมัติจากปุ่มในรายการ แล้วแสดงข้อความ (คืนค่า true เมื่อบันทึกสำเร็จ)
const recordDecision = async (leave, status) => {
    const decision = await openDecisionDialog({ status, leave });
    if (!decision) return false;
    try {
        const result = await api(`/leave_requests/${leave.id}/status`, {
            method: 'PATCH', body: { status, ...decision },
        });
        if (result.warnings && result.warnings.length > 0) {
            showPageMessage('warning', 'บันทึกผลแล้ว แต่มีข้อควรระวัง', result.warnings);
        } else {
            showPageMessage('success', `บันทึกผล "${LEAVE_STATUS_LABELS[status]}" โดย ${decision.approver_name} เรียบร้อย`);
        }
        refreshPendingCount();
        return true;
    } catch (error) {
        showError(error);
        return false;
    }
};

// ===================== ส่งใบลาให้หัวหน้า: ข้อความสำหรับ LINE และสิทธิ์วันลา =====================

// สิทธิ์วันลาทั้งหมดของปี = โควตา + วันลาพักร้อนสะสมจากปีก่อน (null = ไม่จำกัด)
const entitlement = (balance) => (balance.quota === null ? null : balance.quota + (balance.carried || 0));

// สิทธิ์วันลาทุกประเภทของพนักงานในปีที่ลา โดยไม่นับใบลานี้เอง (ถ้าอนุมัติไปแล้ว)
// คืนค่า { year, eligible_from, rows: [{ type, quota, carried, entitled, used, remaining, thisLeave, after }] }
const leaveBalanceFor = async (leave) => {
    const year = leave.start_date.slice(0, 4);
    const data = await api('/reports/leave-balance', { query: { year, employee_id: leave.employee_id } });
    const info = data.rows[0] || { balances: {} };
    const rows = data.leave_types.map((type) => {
        const balance = info.balances[type] || { quota: null, carried: 0, used: 0 };
        const isThisType = type === leave.leave_type;
        const used = balance.used - (isThisType && leave.status === 'approved' ? leave.days : 0);
        const entitled = entitlement(balance);
        const remaining = entitled === null ? null : entitled - used;
        const thisLeave = isThisType ? leave.days : 0;
        return {
            type,
            quota: balance.quota,
            carried: balance.carried || 0,
            entitled,
            used,
            remaining,
            thisLeave,
            after: remaining === null ? null : remaining - thisLeave,
        };
    });
    return { year: Number(year), eligible_from: info.eligible_from || null, rows };
};

// ข้อความสรุปใบลา สำหรับวางส่งหัวหน้าใน LINE / อีเมล
const buildApprovalMessage = (leave, balance) => {
    const row = balance.rows.find((item) => item.type === leave.leave_type);
    const lines = [
        'ขออนุมัติการลา',
        `พนักงาน: ${employeeName(leave)} (${leave.employee_code})${leave.department ? ` · ${leave.department}` : ''}`,
        `ประเภท: ${leave.leave_type}${leave.half_day ? ' (ครึ่งวัน)' : ''}`,
        `วันที่: ${formatDateRange(leave.start_date, leave.end_date)} (${formatDays(leave.days)} วันทำงาน)`,
        `เหตุผล: ${leave.reason}`,
    ];
    if (row && row.quota !== null) {
        lines.push(`สิทธิ์${leave.leave_type}ปี ${balance.year + 543}: เหลือ ${formatDays(row.remaining)} วัน → หลังลาครั้งนี้เหลือ ${formatDays(row.after)} วัน`);
        if (row.after < 0) lines.push(`⚠ ลาเกินสิทธิ์ ${formatDays(-row.after)} วัน`);
    }
    lines.push('', 'รบกวนตอบกลับว่า อนุมัติ / ไม่อนุมัติ ครับ/ค่ะ');
    return lines.join('\n');
};

// คัดลอกข้อความ: ใช้ Clipboard API ถ้าได้ (https/localhost) ไม่งั้นใช้วิธีเลือกข้อความแล้วคัดลอก
const copyText = async (text, textarea) => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // ลองวิธีถัดไป
    }
    if (textarea) {
        textarea.focus();
        textarea.select();
        try {
            return document.execCommand('copy');
        } catch {
            return false;
        }
    }
    return false;
};

// เปิดกล่องข้อความส่งหัวหน้า (แก้ไขข้อความได้ก่อนคัดลอก)
const openApprovalMessage = async (leaveId) => {
    const leave = await api(`/leave_requests/${encodeURIComponent(leaveId)}`);
    const text = buildApprovalMessage(leave, await leaveBalanceFor(leave));

    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
        <h2>ข้อความส่งหัวหน้า</h2>
        <p class="muted small">คัดลอกแล้ววางใน LINE หรืออีเมลถึงผู้อนุมัติ แก้ข้อความได้ก่อนคัดลอก</p>
        <div class="field">
            <textarea rows="9" aria-label="ข้อความ"></textarea>
        </div>
        <div class="message" data-role="status"></div>
        <div class="form-actions">
            <a class="btn secondary" href="print-leave.html?id=${encodeURIComponent(leave.id)}" target="_blank" rel="noopener">พิมพ์ใบลา</a>
            <button type="button" class="btn secondary" data-role="close">ปิด</button>
            <button type="button" class="btn" data-role="copy">คัดลอกข้อความ</button>
        </div>`;
    document.body.appendChild(dialog);
    const textarea = dialog.querySelector('textarea');
    textarea.value = text;

    dialog.querySelector('[data-role=close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('[data-role=copy]').addEventListener('click', async () => {
        const ok = await copyText(textarea.value, textarea);
        showMessage(
            dialog.querySelector('[data-role=status]'),
            ok ? 'success' : 'warning',
            ok ? 'คัดลอกแล้ว นำไปวางในแชทได้เลย' : 'คัดลอกอัตโนมัติไม่ได้ กรุณากด Ctrl+C (Mac: ⌘+C) เพื่อคัดลอกข้อความที่เลือกไว้',
        );
        if (!ok) textarea.select();
    });
    dialog.showModal();
};

// ===================== ตารางและการแบ่งหน้า =====================

const setTableMessage = (container, message, isError = false) => {
    container.innerHTML = `<p class="table-message${isError ? ' error' : ''}">${escapeHtml(message)}</p>`;
};

// แสดง "รายการที่ x-y จาก z" และปุ่มก่อนหน้า/ถัดไป
const renderPagination = (container, { page, page_size: pageSize, total }, onChange) => {
    if (!container) return;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const last = Math.min(total, page * pageSize);
    container.innerHTML = `
        <span>รายการที่ ${first}–${last} จาก ${total}</span>
        <span class="pagination">
            <button type="button" class="btn secondary sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>ก่อนหน้า</button>
            <span>หน้า ${page} / ${pages}</span>
            <button type="button" class="btn secondary sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>ถัดไป</button>
        </span>`;
    container.querySelectorAll('button[data-page]').forEach((button) => {
        button.addEventListener('click', () => onChange(Number(button.dataset.page)));
    });
};

// ===================== ดาวน์โหลด CSV (เปิดใน Excel ได้ ภาษาไทยไม่เพี้ยน) =====================

const toCsv = (rows) => rows
    .map((row) => row.map((cell) => {
        const text = String(cell ?? '');
        // ป้องกันสูตร Excel ที่แฝงมาในข้อมูล (CSV injection)
        const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
        return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    }).join(','))
    .join('\r\n');

const downloadCsv = (filename, rows) => {
    const blob = new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
