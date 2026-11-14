// หน้าประวัติการแก้ไข (audit log) สำหรับผู้ดูแลระบบ

const ENTITY_LABELS = {
    attendance: 'การลงเวลา',
    leave: 'การลา',
    employee: 'พนักงาน',
    user: 'ผู้ใช้ระบบ',
    holiday: 'วันหยุด',
    settings: 'การตั้งค่า',
};

const ACTION_LABELS = {
    create: 'เพิ่ม',
    update: 'แก้ไข',
    delete: 'ลบ',
    status: 'อนุมัติ/ไม่อนุมัติ',
    import: 'นำเข้าไฟล์',
    login: 'เข้าสู่ระบบ',
    login_failed: 'เข้าสู่ระบบไม่สำเร็จ',
    logout: 'ออกจากระบบ',
    change_password: 'เปลี่ยนรหัสผ่าน',
};

const FIELD_LABELS = {
    employee_id: 'พนักงาน (ID)',
    employee_code: 'รหัสพนักงาน',
    first_name: 'ชื่อ',
    last_name: 'นามสกุล',
    department: 'แผนก',
    position: 'ตำแหน่ง',
    start_date: 'วันที่เริ่ม',
    end_date: 'วันที่สิ้นสุด',
    active: 'สถานะใช้งาน',
    date: 'วันที่',
    time_in: 'เวลาเข้า',
    time_out: 'เวลาออก',
    note: 'หมายเหตุ',
    leave_type: 'ประเภทการลา',
    half_day: 'ครึ่งวัน',
    reason: 'เหตุผล',
    status: 'สถานะ',
    status_note: 'หมายเหตุการอนุมัติ',
    days: 'จำนวนวัน',
    display_name: 'ชื่อที่แสดง',
    role: 'สิทธิ์',
    username: 'ชื่อผู้ใช้',
    password: 'รหัสผ่าน',
    name: 'ชื่อ',
    create: 'เพิ่มใหม่',
    update: 'อัปเดต',
    unchanged: 'ไม่เปลี่ยน',
    error: 'ผิดพลาด',
    rows: 'จำนวนแถว',
    file_name: 'ไฟล์',
};

let page = 1;

const formatValue = (value) => {
    if (value === null || value === undefined || value === '') return '–';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

// แสดงรายละเอียด: ถ้าเป็นการแก้ไขจะแสดง "ค่าเดิม → ค่าใหม่"
const formatDetails = (details) => {
    if (!details || typeof details !== 'object' || Object.keys(details).length === 0) return '';
    return Object.entries(details).map(([key, value]) => {
        const label = FIELD_LABELS[key] || key;
        if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
            return `${escapeHtml(label)}: ${escapeHtml(formatValue(value.from))} → ${escapeHtml(formatValue(value.to))}`;
        }
        return `${escapeHtml(label)}: ${escapeHtml(formatValue(value))}`;
    }).join('<br>');
};

const loadTable = async () => {
    const container = document.getElementById('table');
    const query = { ...formValues(document.getElementById('filters')), page, page_size: 50 };
    let data;
    try {
        data = await api('/audit', { query });
    } catch (error) {
        setTableMessage(container, `โหลดข้อมูลไม่สำเร็จ: ${error.message}`, true);
        return;
    }

    if (data.items.length === 0) {
        setTableMessage(container, 'ไม่พบประวัติ');
    } else {
        container.innerHTML = `
            <div class="table-wrap">
                <table class="data">
                    <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>ข้อมูล</th><th>รายละเอียด</th><th>IP</th></tr></thead>
                    <tbody>${data.items.map((row) => `
                        <tr>
                            <td class="nowrap">${escapeHtml(formatDateTime(row.created_at))}</td>
                            <td>${escapeHtml(row.username || '-')}</td>
                            <td><span class="badge ${row.action === 'delete' || row.action === 'login_failed' ? 'error' : ''}">${escapeHtml(ACTION_LABELS[row.action] || row.action)}</span></td>
                            <td class="nowrap">${escapeHtml(ENTITY_LABELS[row.entity] || row.entity)}${row.entity_id ? ` #${escapeHtml(row.entity_id)}` : ''}</td>
                            <td class="small">${formatDetails(row.details)}</td>
                            <td class="small muted">${escapeHtml(row.ip || '')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }
    renderPagination(document.getElementById('pagination'), data, (newPage) => {
        page = newPage;
        loadTable();
    });
};

onAppReady(async (user) => {
    if (user.role !== 'admin') {
        showPageMessage('danger', 'หน้านี้สำหรับผู้ดูแลระบบเท่านั้น');
        document.querySelector('section.card').classList.add('hidden');
        return;
    }

    const form = document.getElementById('filters');
    fillOptions(form.elements.entity, Object.entries(ENTITY_LABELS), 'ทั้งหมด');
    fillOptions(form.elements.action, Object.entries(ACTION_LABELS), 'ทั้งหมด');
    const usersData = await api('/users');
    fillOptions(form.elements.user_id, usersData.items.map((row) => [row.id, `${row.display_name} (${row.username})`]), 'ทุกคน');

    await loadTable();
    form.addEventListener('change', () => {
        page = 1;
        loadTable();
    });
    form.addEventListener('submit', (event) => event.preventDefault());
});
