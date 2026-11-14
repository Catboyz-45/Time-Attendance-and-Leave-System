// หน้าฟอร์มลงเวลา: เพิ่มใหม่ หรือแก้ไขเมื่อ URL มี ?id=...

const validateAttendance = (data) => {
    const errors = [];
    if (!data.employee_id) errors.push('กรุณาเลือกพนักงาน');
    if (!data.date) errors.push('กรุณากรอกวันที่');
    else if (data.date > todayStr()) errors.push('วันที่ต้องไม่เกินวันนี้');
    if (!data.time_in) errors.push('กรุณากรอกเวลาเข้างาน');
    if (data.time_in && data.time_out && data.time_out <= data.time_in) errors.push('เวลาออกงานต้องอยู่หลังเวลาเข้างาน');
    return errors;
};

onAppReady(async () => {
    const form = document.getElementById('attendance-form');
    const messageDom = document.getElementById('page-message');
    const id = getParam('id');

    form.elements.date.max = todayStr();
    const employees = await loadEmployees();

    if (id) {
        document.getElementById('page-title').textContent = 'แก้ไขการลงเวลา';
        document.getElementById('submit-btn').textContent = 'บันทึกการแก้ไข';
        const deleteButton = document.getElementById('delete-btn');
        deleteButton.classList.remove('hidden');

        const record = await api(`/attendance/${encodeURIComponent(id)}`);
        fillEmployeeSelect(form.elements.employee_id, employees, { selected: record.employee_id });
        setFormValues(form, {
            date: record.date,
            time_in: formatTime(record.time_in),
            time_out: record.time_out ? formatTime(record.time_out) : '',
            note: record.note,
        });

        deleteButton.addEventListener('click', async () => {
            if (!window.confirm(`ลบการลงเวลาของ ${employeeLabel(record)} วันที่ ${formatThaiDate(record.date)} ใช่หรือไม่?`)) return;
            await withBusy(deleteButton, async () => {
                try {
                    await api(`/attendance/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    setFlash('success', 'ลบข้อมูลการลงเวลาเรียบร้อย');
                    window.location.href = 'history.html?tab=attendance';
                } catch (error) {
                    showError(error);
                }
            });
        });
    } else {
        fillEmployeeSelect(form.elements.employee_id, employees, { selected: getParam('employee_id') || '' });
        form.elements.date.value = getParam('date') || todayStr();
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = formValues(form);
        const errors = validateAttendance(data);
        if (errors.length > 0) {
            showMessage(messageDom, 'danger', 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors);
            return;
        }

        await withBusy(document.getElementById('submit-btn'), async () => {
            try {
                if (id) {
                    const result = await api(`/attendance/${encodeURIComponent(id)}`, { method: 'PUT', body: data });
                    if (result.warnings && result.warnings.length > 0) {
                        setFlash('warning', 'แก้ไขข้อมูลการลงเวลาเรียบร้อย แต่มีข้อควรตรวจสอบ', result.warnings);
                    } else {
                        setFlash('success', 'แก้ไขข้อมูลการลงเวลาเรียบร้อย');
                    }
                    window.location.href = 'history.html?tab=attendance';
                    return;
                }
                const result = await api('/attendance', { method: 'POST', body: data });
                const employee = employees.find((row) => String(row.id) === data.employee_id);
                const text = `บันทึกการลงเวลาของ ${employee ? employeeLabel(employee) : ''} เรียบร้อย`;
                if (result.warnings && result.warnings.length > 0) {
                    showMessage(messageDom, 'warning', `${text} แต่มีข้อควรตรวจสอบ`, result.warnings);
                } else {
                    showMessage(messageDom, 'success', text);
                }
                // พร้อมกรอกคนถัดไป (เก็บวันที่ไว้)
                form.elements.employee_id.value = '';
                form.elements.time_in.value = '';
                form.elements.time_out.value = '';
                form.elements.note.value = '';
                form.elements.employee_id.focus();
            } catch (error) {
                showError(error, messageDom);
            }
        });
    });
});
