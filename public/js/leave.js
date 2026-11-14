// หน้าฟอร์มบันทึกการลา: เพิ่มใหม่ หรือแก้ไขเมื่อ URL มี ?id=...

const validateLeave = (data) => {
    const errors = [];
    if (!data.employee_id) errors.push('กรุณาเลือกพนักงาน');
    if (!data.leave_type) errors.push('กรุณาเลือกประเภทการลา');
    if (!data.start_date) errors.push('กรุณากรอกวันที่เริ่มลา');
    if (!data.end_date) errors.push('กรุณากรอกวันที่สิ้นสุดลา');
    if (data.start_date && data.end_date && data.end_date < data.start_date) errors.push('วันที่สิ้นสุดลาต้องไม่ก่อนวันที่เริ่มลา');
    if (data.half_day && data.start_date !== data.end_date) errors.push('ลาครึ่งวันได้เฉพาะเมื่อลาวันเดียว');
    if (!data.reason) errors.push('กรุณากรอกเหตุผลการลา');
    return errors;
};

// แสดงวันลาที่ใช้ไปและคงเหลือของพนักงานที่เลือก (ตามปีของวันที่เริ่มลา)
const updateBalanceHint = async (form, excludeLeave) => {
    const hint = document.getElementById('balance-hint');
    const employeeId = form.elements.employee_id.value;
    const type = form.elements.leave_type.value;
    if (!employeeId) {
        hint.textContent = 'เลือกพนักงานเพื่อดูวันลาคงเหลือ';
        return;
    }
    const year = (form.elements.start_date.value || todayStr()).slice(0, 4);
    try {
        const data = await api('/reports/leave-balance', { query: { year, employee_id: employeeId } });
        const balance = data.rows[0] && data.rows[0].balances[type];
        if (!balance) {
            hint.textContent = '-';
            return;
        }
        // ตอนแก้ไขรายการที่อนุมัติแล้ว ไม่นับรายการนี้ซ้ำ
        const used = balance.used - (excludeLeave && excludeLeave.status === 'approved' && excludeLeave.leave_type === type
            && excludeLeave.start_date.slice(0, 4) === year ? excludeLeave.days : 0);
        const pending = balance.pending > 0 ? ` · รออนุมัติ ${formatDays(balance.pending)} วัน` : '';
        if (balance.quota === null) {
            hint.textContent = `ปี ${Number(year) + 543}: ใช้ไปแล้ว ${formatDays(used)} วัน (ไม่จำกัดโควตา)${pending}`;
        } else {
            const remaining = balance.quota - used;
            hint.innerHTML = `ปี ${Number(year) + 543}: ใช้ไป ${formatDays(used)} จาก ${formatDays(balance.quota)} วัน · `
                + `<span class="${remaining < 0 ? 'negative' : ''}">คงเหลือ ${formatDays(remaining)} วัน</span>${escapeHtml(pending)}`;
        }
    } catch (error) {
        hint.textContent = 'โหลดข้อมูลวันลาไม่สำเร็จ';
    }
};

onAppReady(async () => {
    const form = document.getElementById('leave-form');
    const messageDom = document.getElementById('page-message');
    const id = getParam('id');
    const halfDay = form.elements.half_day;

    fillOptions(form.elements.leave_type, LEAVE_TYPES.map((type) => [type, type]));
    const employees = await loadEmployees();
    let existing = null;

    // ลาครึ่งวันได้เฉพาะเมื่อวันเริ่มและวันสิ้นสุดเป็นวันเดียวกัน
    const syncHalfDay = () => {
        const sameDay = form.elements.start_date.value && form.elements.start_date.value === form.elements.end_date.value;
        halfDay.disabled = !sameDay;
        if (!sameDay) halfDay.checked = false;
    };

    form.elements.start_date.addEventListener('change', () => {
        if (!form.elements.end_date.value || form.elements.end_date.value < form.elements.start_date.value) {
            form.elements.end_date.value = form.elements.start_date.value;
        }
        syncHalfDay();
        updateBalanceHint(form, existing);
    });
    form.elements.end_date.addEventListener('change', syncHalfDay);
    form.elements.employee_id.addEventListener('change', () => updateBalanceHint(form, existing));
    form.elements.leave_type.addEventListener('change', () => updateBalanceHint(form, existing));

    if (id) {
        document.getElementById('page-title').textContent = 'แก้ไขการลา';
        document.getElementById('submit-btn').textContent = 'บันทึกการแก้ไข';
        existing = await api(`/leave_requests/${encodeURIComponent(id)}`);
        fillEmployeeSelect(form.elements.employee_id, employees, { selected: existing.employee_id });
        setFormValues(form, {
            leave_type: existing.leave_type,
            start_date: existing.start_date,
            end_date: existing.end_date,
            reason: existing.reason,
            status: existing.status,
            status_note: existing.status_note,
        });
        syncHalfDay();
        halfDay.checked = existing.half_day;
        if (existing.decided_at) {
            document.getElementById('decided-info').textContent = `${LEAVE_STATUS_LABELS[existing.status]}โดย ${existing.decided_by_name || '-'} เมื่อ ${formatDateTime(existing.decided_at)}`;
        }

        const deleteButton = document.getElementById('delete-btn');
        deleteButton.classList.remove('hidden');
        deleteButton.addEventListener('click', async () => {
            if (!window.confirm(`ลบคำขอลาของ ${employeeLabel(existing)} (${formatDateRange(existing.start_date, existing.end_date)}) ใช่หรือไม่?`)) return;
            await withBusy(deleteButton, async () => {
                try {
                    await api(`/leave_requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    setFlash('success', 'ลบคำขอลาเรียบร้อย');
                    window.location.href = 'history.html?tab=leave';
                } catch (error) {
                    showError(error);
                }
            });
        });
    } else {
        fillEmployeeSelect(form.elements.employee_id, employees, { selected: getParam('employee_id') || '' });
        syncHalfDay();
    }
    updateBalanceHint(form, existing);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formValues(form);
        data.half_day = halfDay.checked;
        const errors = validateLeave(data);
        if (errors.length > 0) {
            showMessage(messageDom, 'danger', 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors);
            return;
        }

        await withBusy(document.getElementById('submit-btn'), async () => {
            try {
                const result = id
                    ? await api(`/leave_requests/${encodeURIComponent(id)}`, { method: 'PUT', body: data })
                    : await api('/leave_requests', { method: 'POST', body: data });
                const text = `${id ? 'แก้ไข' : 'บันทึก'}คำขอลาเรียบร้อย (${formatDays(result.days)} วันทำงาน)`;
                if (result.warnings && result.warnings.length > 0) {
                    setFlash('warning', `${text} แต่มีข้อควรระวัง`, result.warnings);
                } else {
                    setFlash('success', text);
                }
                window.location.href = 'history.html?tab=leave';
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });
});
