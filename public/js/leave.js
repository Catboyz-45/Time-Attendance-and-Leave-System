// หน้าคำร้องขอลางาน: ใช้ได้ทั้งเพิ่มข้อมูลใหม่ และแก้ไข (เมื่อ URL มี ?id=...)
// ต้องโหลด common.js ก่อนไฟล์นี้

let mode = 'CREATE';
let selectId = '';

const fields = () => ({
    employee_id: document.querySelector('input[name=employee_id]'),
    leave_type: document.querySelector('select[name=leave_type]'),
    reason: document.querySelector('textarea[name=reason]'),
    start_date: document.querySelector('input[name=start_date]'),
    end_date: document.querySelector('input[name=end_date]'),
});

// ตรวจสอบข้อมูลฝั่งหน้าเว็บก่อนส่ง (เซิร์ฟเวอร์ตรวจซ้ำอีกครั้ง)
const validateData = (data) => {
    const errors = [];
    if (!data.employee_id) errors.push('กรุณากรอกรหัสพนักงาน');
    else if (!/^\d+$/.test(data.employee_id)) errors.push('รหัสพนักงานต้องเป็นตัวเลขเท่านั้น');
    if (!data.leave_type) errors.push('กรุณาเลือกประเภทการลา');
    if (!data.reason) errors.push('กรุณากรอกเหตุผลการลา');
    if (!data.start_date) errors.push('กรุณากรอกวันที่เริ่มลา');
    if (!data.end_date) errors.push('กรุณากรอกวันที่สิ้นสุดลา');
    if (data.start_date && data.end_date && data.end_date < data.start_date) {
        errors.push('วันที่สิ้นสุดลาต้องไม่ก่อนวันที่เริ่มลา');
    }
    return errors;
};

document.addEventListener('DOMContentLoaded', async () => {
    const id = getIdFromUrl();
    const messageDom = document.getElementById('message');

    if (id) {
        mode = 'EDIT';
        selectId = id;
        document.getElementById('page-title').textContent = 'แก้ไขคำร้องลางาน';
        document.getElementById('submitBtn').textContent = 'บันทึกการแก้ไข';

        try {
            const leave = await api(`/leave_requests/${encodeURIComponent(id)}`);
            const dom = fields();
            dom.employee_id.value = leave.employee_id;
            dom.leave_type.value = leave.leave_type;
            dom.reason.value = leave.reason;
            dom.start_date.value = leave.start_date; // 'YYYY-MM-DD' จากเซิร์ฟเวอร์ ใช้กับ input type="date" ได้ทันที
            dom.end_date.value = leave.end_date;
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

    const leaveData = {
        employee_id: dom.employee_id.value.trim(),
        leave_type: dom.leave_type.value,
        reason: dom.reason.value.trim(),
        start_date: dom.start_date.value,
        end_date: dom.end_date.value,
    };

    const errors = validateData(leaveData);
    if (errors.length > 0) {
        showMessage(messageDom, 'danger', 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน', errors);
        return;
    }

    button.disabled = true;
    try {
        if (mode === 'CREATE') {
            await api('/leave_requests', { method: 'POST', body: leaveData });
            showMessage(messageDom, 'success', 'บันทึกคำขอลาเรียบร้อย');
            dom.reason.value = '';
            dom.start_date.value = '';
            dom.end_date.value = '';
        } else {
            await api(`/leave_requests/${encodeURIComponent(selectId)}`, { method: 'PUT', body: leaveData });
            showMessage(messageDom, 'success', 'แก้ไขคำขอลาเรียบร้อย');
        }
    } catch (error) {
        showMessage(messageDom, 'danger', `เกิดข้อผิดพลาด: ${error.message}`, error.errors);
    } finally {
        button.disabled = false;
    }
};
