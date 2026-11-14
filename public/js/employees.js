// หน้าจัดการพนักงาน: รายชื่อ ค้นหา เพิ่ม แก้ไข ปิดสถานะ

let page = 1;
let editingId = null;
let lastItems = [];

const listQuery = () => {
    const values = formValues(document.getElementById('filters'));
    return { q: values.q, department: values.department, active: values.active };
};

const loadTable = async () => {
    const container = document.getElementById('table');
    let data;
    try {
        data = await api('/employees', { query: { ...listQuery(), page, page_size: 50 } });
    } catch (error) {
        setTableMessage(container, `โหลดข้อมูลไม่สำเร็จ: ${error.message}`, true);
        return;
    }
    lastItems = data.items;

    if (data.items.length === 0) {
        setTableMessage(container, 'ไม่พบพนักงาน');
    } else {
        container.innerHTML = `
            <div class="table-wrap">
                <table class="data">
                    <thead><tr>
                        <th>รหัส</th><th>ชื่อ-สกุล</th><th>แผนก</th><th>ตำแหน่ง</th><th>เริ่มงาน</th><th>สถานะ</th><th></th>
                    </tr></thead>
                    <tbody>${data.items.map((row) => `
                        <tr class="${row.active ? '' : 'inactive'}">
                            <td class="nowrap">${escapeHtml(row.employee_code)}</td>
                            <td>${escapeHtml(employeeName(row))}</td>
                            <td>${escapeHtml(row.department || '-')}</td>
                            <td>${escapeHtml(row.position || '-')}</td>
                            <td class="nowrap">${row.start_date ? escapeHtml(formatThaiDate(row.start_date)) : '-'}</td>
                            <td>${row.active ? '<span class="badge ok">ทำงานอยู่</span>' : '<span class="badge">ปิดสถานะ</span>'}</td>
                            <td class="actions-cell">
                                <a class="btn secondary sm" href="history.html?tab=attendance&amp;employee_id=${encodeURIComponent(row.id)}">ประวัติ</a>
                                <button type="button" class="btn secondary sm" data-edit="${escapeHtml(row.id)}">แก้ไข</button>
                            </td>
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

const refreshDepartments = async () => {
    const departments = await api('/employees/departments');
    document.getElementById('department-list').innerHTML = departments
        .map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
    const select = document.getElementById('filter-department');
    const selected = select.value;
    await fillDepartmentSelect(select);
    select.value = selected;
};

const openForm = (employee) => {
    const form = document.getElementById('employee-form');
    editingId = employee ? employee.id : null;
    form.reset();
    hideMessage(document.getElementById('form-message'));
    document.getElementById('form-title').textContent = employee ? `แก้ไขข้อมูล ${employeeLabel(employee)}` : 'เพิ่มพนักงาน';
    if (employee) {
        setFormValues(form, {
            employee_code: employee.employee_code,
            first_name: employee.first_name,
            last_name: employee.last_name,
            department: employee.department,
            position: employee.position,
            start_date: employee.start_date,
            active: Boolean(employee.active),
        });
    } else {
        form.elements.active.checked = true;
    }
    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.employee_code.focus();
};

const closeForm = () => {
    document.getElementById('employee-form').classList.add('hidden');
    editingId = null;
};

onAppReady(async () => {
    const filters = document.getElementById('filters');
    const form = document.getElementById('employee-form');

    await Promise.all([refreshDepartments(), loadTable()]);

    filters.addEventListener('change', () => { page = 1; loadTable(); });
    filters.elements.q.addEventListener('input', debounce(() => { page = 1; loadTable(); }, 350));
    filters.addEventListener('submit', (event) => event.preventDefault());

    document.getElementById('add-btn').addEventListener('click', () => openForm(null));
    document.getElementById('cancel-btn').addEventListener('click', closeForm);

    document.getElementById('table').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-edit]');
        if (!button) return;
        const employee = lastItems.find((row) => String(row.id) === button.dataset.edit);
        if (employee) openForm(employee);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formValues(form);
        const messageDom = document.getElementById('form-message');
        const errors = [];
        if (!data.employee_code) errors.push('กรุณากรอกรหัสพนักงาน');
        if (!data.first_name) errors.push('กรุณากรอกชื่อ');
        if (!data.last_name) errors.push('กรุณากรอกนามสกุล');
        if (errors.length > 0) {
            showMessage(messageDom, 'danger', 'กรุณากรอกข้อมูลให้ครบถ้วน', errors);
            return;
        }
        if (editingId && !data.active && lastItems.find((row) => row.id === editingId)?.active
            && !window.confirm('ปิดสถานะพนักงานคนนี้? (ข้อมูลเดิมยังอยู่ และเปิดสถานะคืนได้)')) {
            return;
        }

        await withBusy(document.getElementById('save-btn'), async () => {
            try {
                const result = editingId
                    ? await api(`/employees/${editingId}`, { method: 'PUT', body: data })
                    : await api('/employees', { method: 'POST', body: data });
                closeForm();
                showPageMessage('success', result.message);
                await Promise.all([refreshDepartments(), loadTable()]);
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });

    document.getElementById('export-btn').addEventListener('click', async (event) => {
        await withBusy(event.currentTarget, async () => {
            try {
                const data = await api('/employees', { query: { ...listQuery(), page_size: 5000 } });
                downloadCsv('employees.csv', [
                    ['รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'แผนก', 'ตำแหน่ง', 'วันที่เริ่มงาน', 'สถานะ'],
                    ...data.items.map((row) => [
                        row.employee_code, row.first_name, row.last_name, row.department || '', row.position || '',
                        row.start_date || '', row.active ? 'ทำงานอยู่' : 'ปิดสถานะ',
                    ]),
                ]);
            } catch (error) {
                showError(error);
            }
        });
    });
});
