// หน้าประวัติ: แท็บการลงเวลา / การลา พร้อมตัวกรอง แบ่งหน้า export และปุ่มจัดการ
// ทุกค่าจากฐานข้อมูลผ่าน escapeHtml ก่อนใส่ลง HTML

const PAGE_SIZE = 50;
const FILTER_KEYS = {
    attendance: ['q', 'employee_id', 'department', 'from', 'to', 'late', 'missing_out', 'conflict'],
    leave: ['q', 'employee_id', 'department', 'from', 'to', 'status', 'leave_type'],
};

const TABS = {
    attendance: {
        title: 'ประวัติการลงเวลา',
        apiPath: '/attendance',
        addHref: 'attendance.html',
        addLabel: '+ ลงเวลา',
        emptyText: 'ไม่พบข้อมูลการลงเวลา',
        headers: ['วันที่', 'พนักงาน', 'เข้างาน', 'ออกงาน', 'หมายเหตุ', ''],
        row: (row) => `
            <tr>
                <td class="nowrap">${escapeHtml(formatThaiDate(row.date))}
                    ${row.day_type === 'holiday' ? '<div><span class="badge">วันหยุด</span></div>' : ''}
                    ${row.day_type === 'weekend' ? '<div><span class="badge">วันหยุดสัปดาห์</span></div>' : ''}</td>
                <td class="emp-cell">${employeeCell(row)}</td>
                <td class="nowrap">${escapeHtml(formatTime(row.time_in))}
                    ${row.is_late ? `<div><span class="badge late">สาย ${escapeHtml(formatMinutes(row.late_minutes))}</span></div>` : ''}</td>
                <td class="nowrap">${row.time_out ? escapeHtml(formatTime(row.time_out)) : '<span class="badge pending">ยังไม่ลง</span>'}
                    ${row.early_minutes ? `<div><span class="badge pending">ออกก่อน ${escapeHtml(formatMinutes(row.early_minutes))}</span></div>` : ''}
                    ${row.ot_minutes ? `<div><span class="badge update">OT ${escapeHtml(formatMinutes(row.ot_minutes))}</span></div>` : ''}
                    ${row.holiday_minutes ? `<div><span class="badge update">ทำงาน ${escapeHtml(formatMinutes(row.holiday_minutes))}</span></div>` : ''}</td>
                <td>${escapeHtml(row.note || '')} ${row.source === 'import' ? '<span class="badge">นำเข้า</span>' : ''}
                    ${row.on_leave ? '<div><span class="badge error" title="วันนี้มีใบลาเต็มวันที่อนุมัติแล้ว">ขัดกับใบลา</span></div>' : ''}</td>
                <td class="actions-cell">
                    ${iconLink('edit', 'แก้ไข', `attendance.html?id=${encodeURIComponent(row.id)}`)}
                    ${iconButton('trash', 'ลบ', `data-delete="${escapeHtml(row.id)}" data-label="${escapeHtml(`${employeeLabel(row)} วันที่ ${formatThaiDate(row.date)}`)}"`, 'danger-ghost')}
                </td>
            </tr>`,
        csvHeaders: ['วันที่', 'ประเภทวัน', 'รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'แผนก', 'เวลาเข้างาน', 'เวลาออกงาน',
            'สาย (นาที)', 'ออกก่อน (นาที)', 'OT (นาที)', 'ทำงานวันหยุด (นาที)', 'ขัดกับใบลา', 'หมายเหตุ', 'ที่มา'],
        csvRow: (row) => [
            row.date, { workday: 'วันทำงาน', weekend: 'วันหยุดสัปดาห์', holiday: 'วันหยุด' }[row.day_type] || '',
            row.employee_code, row.first_name, row.last_name, row.department || '',
            formatTime(row.time_in), row.time_out ? formatTime(row.time_out) : '',
            row.late_minutes, row.early_minutes, row.ot_minutes, row.holiday_minutes, row.on_leave ? 'ใช่' : '',
            row.note || '', row.source === 'import' ? 'นำเข้า' : 'บันทึกเอง',
        ],
    },
    leave: {
        title: 'ประวัติการลา',
        apiPath: '/leave_requests',
        addHref: 'leave.html',
        addLabel: '+ บันทึกการลา',
        emptyText: 'ไม่พบข้อมูลการลา',
        headers: ['พนักงาน', 'การลา', 'วัน', 'เหตุผล', 'สถานะ', ''],
        row: (row) => `
            <tr>
                <td class="emp-cell">${employeeCell(row)}</td>
                <td><div class="cell-title nowrap">${escapeHtml(row.leave_type)}${row.half_day ? ' (ครึ่งวัน)' : ''}</div>
                    <div class="sub">${escapeHtml(formatDateRange(row.start_date, row.end_date))}</div></td>
                <td class="num">${escapeHtml(formatDays(row.days))}</td>
                <td><div class="reason">${escapeHtml(row.reason)}</div></td>
                <td>
                    ${statusBadge(row.status)}
                    ${row.approver_name && row.status !== 'pending' ? `<div class="approver">โดย ${escapeHtml(row.approver_name)}</div>` : ''}
                    ${row.status_note ? `<div class="small muted">${escapeHtml(row.status_note)}</div>` : ''}
                </td>
                <td class="actions-cell">
                    ${row.status === 'pending' ? `
                        <button type="button" class="btn secondary sm" data-copy="${escapeHtml(row.id)}">ส่งหัวหน้า</button>
                        <button type="button" class="btn success sm" data-status="approved" data-id="${escapeHtml(row.id)}">อนุมัติ</button>
                        <button type="button" class="btn secondary sm" data-status="rejected" data-id="${escapeHtml(row.id)}">ไม่อนุมัติ</button>` : ''}
                    ${iconLink('print', 'พิมพ์ใบลา', `print-leave.html?id=${encodeURIComponent(row.id)}`, 'target="_blank" rel="noopener"')}
                    ${iconLink('edit', 'แก้ไข', `leave.html?id=${encodeURIComponent(row.id)}`)}
                    ${iconButton('trash', 'ลบ', `data-delete="${escapeHtml(row.id)}" data-label="${escapeHtml(`${employeeLabel(row)} (${formatDateRange(row.start_date, row.end_date)})`)}"`, 'danger-ghost')}
                </td>
            </tr>`,
        csvHeaders: ['วันที่เริ่มลา', 'วันที่สิ้นสุดลา', 'รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'แผนก', 'ประเภทการลา', 'ครึ่งวัน', 'จำนวนวัน', 'เหตุผล', 'สถานะ', 'ผู้อนุมัติ', 'หมายเหตุการอนุมัติ', 'บันทึกผลโดย (HR)'],
        csvRow: (row) => [
            row.start_date, row.end_date, row.employee_code, row.first_name, row.last_name, row.department || '',
            row.leave_type, row.half_day ? 'ใช่' : '', row.days, row.reason, LEAVE_STATUS_LABELS[row.status],
            row.approver_name || '', row.status_note || '', row.decided_by_name || '',
        ],
    },
};

// แท็บปัจจุบันมาจาก URL (?tab=leave) เพื่อให้เมนูด้านบนไฮไลต์ถูกอัน
let currentTab = getParam('tab') === 'leave' ? 'leave' : 'attendance';
let currentPage = 1;
let currentItems = [];
document.body.dataset.page = currentTab;

const filterForm = () => document.getElementById('filters');

// อ่านตัวกรองจากฟอร์ม (เฉพาะที่ใช้กับแท็บนี้)
const currentFilters = () => {
    const values = formValues(filterForm());
    const filters = {};
    FILTER_KEYS[currentTab].forEach((key) => {
        const value = values[key];
        if (value === true) filters[key] = 1;
        else if (value) filters[key] = value;
    });
    return filters;
};

// เก็บตัวกรองไว้ใน URL เพื่อกดย้อนกลับ/แชร์ลิงก์ได้
const syncUrl = () => {
    const query = buildQuery({ tab: currentTab, ...currentFilters(), page: currentPage > 1 ? currentPage : '' });
    window.history.replaceState(null, '', `history.html${query}`);
};

const applyTabUi = () => {
    const tab = TABS[currentTab];
    document.body.dataset.page = currentTab;
    document.getElementById('page-title').textContent = tab.title;
    document.title = `${tab.title} · ระบบลงเวลาและการลา`;
    const addButton = document.getElementById('add-btn');
    addButton.href = tab.addHref;
    addButton.textContent = tab.addLabel;
    document.querySelectorAll('.tabs button').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === currentTab);
    });
    document.querySelectorAll('[data-for]').forEach((element) => {
        element.classList.toggle('hidden', element.dataset.for !== currentTab);
    });
    document.querySelectorAll('.nav a').forEach((link) => {
        link.classList.toggle('active', link.getAttribute('href') === `history.html?tab=${currentTab}`);
    });
};

const loadTable = async () => {
    const tab = TABS[currentTab];
    const container = document.getElementById('table');
    const pagination = document.getElementById('pagination');
    syncUrl();

    let data;
    try {
        data = await api(tab.apiPath, { query: { ...currentFilters(), page: currentPage, page_size: PAGE_SIZE } });
    } catch (error) {
        setTableMessage(container, `โหลดข้อมูลไม่สำเร็จ: ${error.message}`, true);
        pagination.innerHTML = '';
        return;
    }
    currentItems = data.items;

    if (data.items.length === 0) {
        setTableMessage(container, tab.emptyText);
    } else {
        container.innerHTML = `
            <div class="table-wrap">
                <table class="data">
                    <thead><tr>${tab.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
                    <tbody>${data.items.map(tab.row).join('')}</tbody>
                </table>
            </div>`;
    }
    renderPagination(pagination, data, (page) => {
        currentPage = page;
        loadTable();
    });
};

const reload = () => {
    currentPage = 1;
    loadTable();
};

// export ทุกหน้าตามตัวกรองปัจจุบัน
const exportCsv = async (button) => {
    const tab = TABS[currentTab];
    await withBusy(button, async () => {
        try {
            const data = await api(tab.apiPath, { query: { ...currentFilters(), page: 1, page_size: 5000 } });
            if (data.total > data.items.length) {
                showPageMessage('warning', `ข้อมูลมี ${data.total} รายการ export ได้ครั้งละ 5000 รายการ กรุณาเลือกช่วงวันที่ให้แคบลง`);
            }
            const filters = currentFilters();
            const range = filters.from || filters.to ? `_${filters.from || ''}_${filters.to || ''}` : '';
            downloadCsv(
                `${currentTab === 'leave' ? 'leave' : 'attendance'}${range}.csv`,
                [tab.csvHeaders, ...data.items.map(tab.csvRow)],
            );
        } catch (error) {
            showError(error);
        }
    });
};

onAppReady(async () => {
    const form = filterForm();
    fillOptions(form.elements.leave_type, LEAVE_TYPES.map((type) => [type, type]), 'ทุกประเภท');
    const [employees] = await Promise.all([loadEmployees(), fillDepartmentSelect(form.elements.department)]);
    fillEmployeeSelect(form.elements.employee_id, employees, { placeholder: 'ทุกคน', includeInactive: true });

    // ตัวกรองเริ่มต้นจาก URL
    const params = new URLSearchParams(window.location.search);
    setFormValues(form, {
        q: params.get('q') || '',
        employee_id: params.get('employee_id') || '',
        department: params.get('department') || '',
        from: params.get('from') || '',
        to: params.get('to') || '',
        status: params.get('status') || '',
        leave_type: params.get('leave_type') || '',
        late: params.get('late') === '1',
        missing_out: params.get('missing_out') === '1',
        conflict: params.get('conflict') === '1',
    });
    currentPage = Number(params.get('page')) || 1;

    applyTabUi();
    await loadTable();

    form.addEventListener('change', reload);
    form.elements.q.addEventListener('input', debounce(reload, 350));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        reload();
    });
    document.getElementById('clear-btn').addEventListener('click', () => {
        form.reset();
        reload();
    });

    document.querySelectorAll('.tabs button').forEach((button) => {
        button.addEventListener('click', () => {
            if (button.dataset.tab === currentTab) return;
            currentTab = button.dataset.tab;
            applyTabUi();
            reload();
        });
    });

    document.getElementById('export-btn').addEventListener('click', (event) => exportCsv(event.currentTarget));

    // ปุ่มในตาราง (ผูกครั้งเดียวที่ตัวตาราง)
    document.getElementById('table').addEventListener('click', async (event) => {
        const deleteButton = event.target.closest('button[data-delete]');
        const statusButton = event.target.closest('button[data-status]');
        const copyButton = event.target.closest('button[data-copy]');

        if (copyButton) {
            await withBusy(copyButton, async () => {
                try {
                    await openApprovalMessage(copyButton.dataset.copy);
                } catch (error) {
                    showError(error);
                }
            });
        }

        if (deleteButton) {
            if (!window.confirm(`ลบรายการ ${deleteButton.dataset.label} ใช่หรือไม่?`)) return;
            await withBusy(deleteButton, async () => {
                try {
                    const result = await api(`${TABS[currentTab].apiPath}/${deleteButton.dataset.delete}`, { method: 'DELETE' });
                    showPageMessage('success', result.message);
                    await loadTable();
                } catch (error) {
                    showError(error);
                }
            });
        }

        if (statusButton) {
            const leave = currentItems.find((row) => String(row.id) === statusButton.dataset.id);
            if (!leave) return;
            await withBusy(statusButton, async () => {
                if (await recordDecision(leave, statusButton.dataset.status)) await loadTable();
            });
        }
    });
});
