// หน้าลงเวลาทำงาน: ใช้ได้ทั้งเพิ่มข้อมูลใหม่ และแก้ไข (เมื่อ URL มี ?id=...)
// ต้องโหลด common.js ก่อนไฟล์นี้

let mode = 'CREATE';
let selectId = '';

const fields = () => ({
    employee_id: document.querySelector('input[name=employee_id]'),
    date: document.querySelector('input[name=date]'),
    time_in: document.querySelector('input[name=time_in]'),
    time_out: document.querySelector('input[name=time_out]'),
});

// ตรวจสอบข้อมูลฝั่งหน้าเว็บก่อนส่ง (เซิร์ฟเวอร์ตรวจซ้ำอีกครั้ง)
const validateData = (data) => {
    const errors = [];
    if (!data.employee_id) errors.push('กรุณากรอกรหัสพนักงาน');
    else if (!/^\d+$/.test(data.employee_id)) errors.push('รหัสพนักงานต้องเป็นตัวเลขเท่านั้น');
    if (!data.date) errors.push('กรุณากรอกวันที่');
    if (!data.time_in) errors.push('กรุณากรอกเวลาเข้างาน');
    if (data.time_in && data.time_out && data.time_out <= data.time_in) {
        errors.push('เวลาออกงานต้องอยู่หลังเวลาเข้างาน');
    }
    return errors;
};

document.addEventListener('DOMContentLoaded', async () => {
    const id = getIdFromUrl();
    const messageDom = document.getElementById('message');

    if (id) {
        mode = 'EDIT';
        selectId = id;
        document.getElementById('page-title').textContent = 'แก้ไขข้อมูลการลงเวลา';
        document.getElementById('submitBtn').textContent = 'บันทึกการแก้ไข';

        try {
            const attendance = await api(`/attendance/${encodeURIComponent(id)}`);
            const dom = fields();
            dom.employee_id.value = attendance.employee_id;
            dom.date.value = attendance.date; // เซิร์ฟเวอร์ส่งมาเป็น 'YYYY-MM-DD' ใช้กับ input type="date" ได้ทันที
            dom.time_in.value = formatTime(attendance.time_in);
            dom.time_out.value = attendance.time_out ? formatTime(attendance.time_out) : '';
        } catch (error) {
            showMessage(messageDom, 'danger', `โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
        }
    }

    document.getElementById('submitBtn').addEventListener('click', submitData);
});

const submitData = async () => {
    const dom = fields();
    const messageDom = document.getElementById('message');
    const button = document.getElementById('submitBtn');

    const attendanceData = {
        employee_id: dom.employee_id.value.trim(),
        date: dom.date.value,
        time_in: dom.time_in.value,
        time_out: dom.time_out.value,
    };

    const errors = validateData(attendanceData);
    if (errors.length > 0) {
        showMessage(messageDom, 'danger', 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors);
        return;
    }

    button.disabled = true;
    try {
        if (mode === 'CREATE') {
            await api('/attendance', { method: 'POST', body: attendanceData });
            showMessage(messageDom, 'success', 'บันทึกข้อมูลการเข้าออกเรียบร้อย');
            // ล้างฟอร์ม (เก็บรหัสพนักงานไว้ เผื่อกรอกต่อ)
            dom.date.value = '';
            dom.time_in.value = '';
            dom.time_out.value = '';
        } else {
            await api(`/attendance/${encodeURIComponent(selectId)}`, { method: 'PUT', body: attendanceData });
            showMessage(messageDom, 'success', 'แก้ไขข้อมูลการเข้าออกเรียบร้อย');
        }
    } catch (error) {
        showMessage(messageDom, 'danger', `เกิดข้อผิดพลาด: ${error.message}`, error.errors);
    } finally {
        button.disabled = false;
    }
};
