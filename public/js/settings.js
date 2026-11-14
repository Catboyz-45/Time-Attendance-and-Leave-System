// หน้าตั้งค่า: เปลี่ยนรหัสผ่าน, เวลางาน/โควตา (admin), วันหยุด, ผู้ใช้ระบบ (admin)

// ===================== เปลี่ยนรหัสผ่าน =====================

const setupPasswordForm = (user) => {
    const form = document.getElementById('password-form');
    const messageDom = document.getElementById('password-message');

    if (user.must_change_password) {
        showMessage(messageDom, 'warning', 'กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน (รหัสผ่านปัจจุบันคือรหัสชั่วคราวที่ได้รับ)');
        document.getElementById('other-settings').classList.add('hidden');
        form.elements.current_password.focus();
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formValues(form);
        const errors = [];
        if (!data.current_password) errors.push('กรุณากรอกรหัสผ่านปัจจุบัน');
        if (!data.new_password || data.new_password.length < 8) errors.push('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
        if (data.new_password !== data.confirm_password) errors.push('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
        if (errors.length > 0) {
            showMessage(messageDom, 'danger', 'เปลี่ยนรหัสผ่านไม่สำเร็จ', errors);
            return;
        }

        await withBusy(document.getElementById('password-btn'), async () => {
            try {
                await api('/auth/change-password', {
                    method: 'POST',
                    body: { current_password: data.current_password, new_password: data.new_password },
                });
                form.reset();
                if (user.must_change_password) {
                    setFlash('success', 'ตั้งรหัสผ่านใหม่เรียบร้อย ยินดีต้อนรับ');
                    window.location.href = 'index.html';
                    return;
                }
                showMessage(messageDom, 'success', 'เปลี่ยนรหัสผ่านเรียบร้อย');
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });
};

// ===================== เวลางานและโควตา =====================

const setupWorkForm = async (user) => {
    const form = document.getElementById('work-form');
    const messageDom = document.getElementById('work-message');
    const settings = await api('/settings');
    const isAdmin = user.role === 'admin';

    document.getElementById('work-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((day) => `
        <label class="checkbox"><input type="checkbox" data-day="${day}" ${settings.work_days.includes(day) ? 'checked' : ''}> ${WEEKDAY_LABELS[day]}</label>`).join('');
    document.getElementById('quota-fields').innerHTML = settings.leave_types.map((type, index) => `
        <div class="field">
            <label for="quota-${index}">${escapeHtml(type)}</label>
            <input id="quota-${index}" type="number" min="0" max="365" step="0.5" data-quota="${escapeHtml(type)}"
                value="${settings.leave_quotas[type] ?? ''}" placeholder="ไม่จำกัด">
        </div>`).join('');
    setFormValues(form, {
        company_name: settings.company_name,
        work_start_time: settings.work_start_time,
        work_end_time: settings.work_end_time,
        late_grace_minutes: settings.late_grace_minutes,
    });

    document.getElementById('work-readonly-note').classList.toggle('hidden', isAdmin);
    if (!isAdmin) {
        Array.from(form.elements).forEach((element) => { element.disabled = true; });
        document.getElementById('work-btn').classList.add('hidden');
        return;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = {
            company_name: form.elements.company_name.value.trim(),
            work_start_time: form.elements.work_start_time.value,
            work_end_time: form.elements.work_end_time.value,
            late_grace_minutes: Number(form.elements.late_grace_minutes.value || 0),
            work_days: Array.from(form.querySelectorAll('[data-day]:checked')).map((input) => Number(input.dataset.day)),
            leave_quotas: Object.fromEntries(Array.from(form.querySelectorAll('[data-quota]'))
                .filter((input) => input.value !== '')
                .map((input) => [input.dataset.quota, Number(input.value)])),
        };
        await withBusy(document.getElementById('work-btn'), async () => {
            try {
                const result = await api('/settings', { method: 'PUT', body });
                showMessage(messageDom, 'success', result.message);
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });
};

// ===================== วันหยุด =====================

const loadHolidays = async () => {
    const year = document.getElementById('holiday-year').value;
    const container = document.getElementById('holiday-table');
    const data = await api('/holidays', { query: { year } });
    if (data.items.length === 0) {
        setTableMessage(container, `ยังไม่มีวันหยุดในปี ${Number(year) + 543}`);
        return;
    }
    container.innerHTML = `
        <div class="table-wrap">
            <table class="data">
                <thead><tr><th>วันที่</th><th>วัน</th><th>ชื่อวันหยุด</th><th></th></tr></thead>
                <tbody>${data.items.map((row) => `
                    <tr>
                        <td class="nowrap">${escapeHtml(formatThaiDate(row.date))}</td>
                        <td>${escapeHtml(formatThaiDate(row.date, { weekday: 'long' }))}</td>
                        <td>${escapeHtml(row.name)}</td>
                        <td class="actions-cell"><button type="button" class="btn danger sm" data-holiday="${escapeHtml(row.id)}"
                            data-label="${escapeHtml(`${row.name} (${formatThaiDate(row.date)})`)}">ลบ</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
};

const setupHolidays = async () => {
    const yearSelect = document.getElementById('holiday-year');
    const thisYear = Number(todayStr().slice(0, 4));
    fillOptions(yearSelect, [thisYear - 1, thisYear, thisYear + 1].map((year) => [year, `ปี ${year + 543}`]));
    yearSelect.value = String(thisYear);
    yearSelect.addEventListener('change', loadHolidays);
    await loadHolidays();

    const form = document.getElementById('holiday-form');
    const messageDom = document.getElementById('holiday-message');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formValues(form);
        if (!data.date || !data.name) {
            showMessage(messageDom, 'danger', 'กรุณากรอกวันที่และชื่อวันหยุด');
            return;
        }
        await withBusy(document.getElementById('holiday-btn'), async () => {
            try {
                await api('/holidays', { method: 'POST', body: data });
                showMessage(messageDom, 'success', `เพิ่ม "${data.name}" เรียบร้อย`);
                form.reset();
                yearSelect.value = data.date.slice(0, 4);
                await loadHolidays();
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });

    document.getElementById('holiday-table').addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-holiday]');
        if (!button || !window.confirm(`ลบวันหยุด ${button.dataset.label} ใช่หรือไม่?`)) return;
        await withBusy(button, async () => {
            try {
                await api(`/holidays/${button.dataset.holiday}`, { method: 'DELETE' });
                hideMessage(messageDom);
                await loadHolidays();
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });
};

// ===================== ผู้ใช้ระบบ =====================

let users = [];
let editingUserId = null;

const loadUsers = async () => {
    const data = await api('/users');
    users = data.items;
    document.getElementById('user-table').innerHTML = `
        <div class="table-wrap">
            <table class="data">
                <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>สิทธิ์</th><th>สถานะ</th><th>เข้าสู่ระบบล่าสุด</th><th></th></tr></thead>
                <tbody>${users.map((row) => `
                    <tr class="${row.active ? '' : 'inactive'}">
                        <td>${escapeHtml(row.username)}</td>
                        <td>${escapeHtml(row.display_name)}</td>
                        <td>${row.role === 'admin' ? 'ผู้ดูแลระบบ' : 'HR'}</td>
                        <td>${row.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิดใช้งาน</span>'}
                            ${row.must_change_password ? '<span class="badge pending">รอเปลี่ยนรหัส</span>' : ''}</td>
                        <td class="nowrap">${escapeHtml(formatDateTime(row.last_login_at))}</td>
                        <td class="actions-cell"><button type="button" class="btn secondary sm" data-user="${escapeHtml(row.id)}">แก้ไข</button></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
};

const openUserForm = (user) => {
    const form = document.getElementById('user-form');
    editingUserId = user ? user.id : null;
    form.reset();
    document.getElementById('user-form-title').textContent = user ? `แก้ไขผู้ใช้ ${user.username}` : 'เพิ่มผู้ใช้';
    form.elements.username.disabled = Boolean(user);
    document.getElementById('user-password-label').textContent = user ? 'รีเซ็ตรหัสผ่าน (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่านชั่วคราว';
    document.getElementById('user-password-hint').textContent = 'อย่างน้อย 8 ตัวอักษร ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเองตอน login ครั้งถัดไป';
    if (user) {
        setFormValues(form, {
            username: user.username, display_name: user.display_name, role: user.role, active: Boolean(user.active),
        });
    } else {
        form.elements.active.checked = true;
    }
    form.elements.active.closest('.field').classList.toggle('hidden', !user);
    form.classList.remove('hidden');
    (user ? form.elements.display_name : form.elements.username).focus();
};

const setupUsers = async () => {
    document.getElementById('users-card').classList.remove('hidden');
    await loadUsers();

    const form = document.getElementById('user-form');
    const messageDom = document.getElementById('user-message');
    document.getElementById('add-user-btn').addEventListener('click', () => openUserForm(null));
    document.getElementById('user-cancel-btn').addEventListener('click', () => form.classList.add('hidden'));
    document.getElementById('user-table').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-user]');
        if (button) openUserForm(users.find((row) => String(row.id) === button.dataset.user));
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formValues(form);
        if (!editingUserId && (!data.password || data.password.length < 8)) {
            showMessage(messageDom, 'danger', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
            return;
        }
        await withBusy(document.getElementById('user-save-btn'), async () => {
            try {
                const result = editingUserId
                    ? await api(`/users/${editingUserId}`, {
                        method: 'PUT',
                        body: {
                            display_name: data.display_name, role: data.role, active: data.active, password: data.password,
                        },
                    })
                    : await api('/users', { method: 'POST', body: data });
                form.classList.add('hidden');
                showMessage(messageDom, 'success', result.message);
                await loadUsers();
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });
};

onAppReady(async (user) => {
    setupPasswordForm(user);
    if (user.must_change_password) return;
    await Promise.all([setupWorkForm(user), setupHolidays()]);
    if (user.role === 'admin') await setupUsers();
    if (window.location.hash === '#password') document.getElementById('password-form').scrollIntoView();
});
