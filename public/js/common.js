// ฟังก์ชันที่ใช้ร่วมกันทุกหน้า (โหลดไฟล์นี้ก่อนสคริปต์ของแต่ละหน้า)

// ถ้าเปิดหน้าเว็บผ่านเซิร์ฟเวอร์ (http://localhost:3000) ใช้ path แบบ relative
// ถ้าเปิดไฟล์ HTML ตรงๆ หรือผ่าน Live Server ให้เรียก API ที่ localhost:3000
const API_BASE = window.location.port === '3000' ? '/api' : 'http://localhost:3000/api';

// เรียก API ด้วย fetch แล้วคืนค่า JSON ถ้าเซิร์ฟเวอร์ตอบ error จะ throw พร้อมข้อความจากเซิร์ฟเวอร์
const api = async (path, { method = 'GET', body } = {}) => {
    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (error) {
        throw { message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่าเปิดเซิร์ฟเวอร์แล้ว', errors: [] };
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw { message: data.message || `เกิดข้อผิดพลาด (${response.status})`, errors: data.errors || [] };
    }
    return data;
};

// แปลงอักขระพิเศษก่อนใส่ลง HTML เพื่อป้องกัน XSS
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// แปลงวันที่ 'YYYY-MM-DD' เป็นรูปแบบไทย เช่น 2/4/2568
// (สร้าง Date จากปี/เดือน/วันโดยตรง เพื่อไม่ให้ timezone ทำให้วันที่เลื่อน)
const formatThaiDate = (dateString) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString || '');
    if (!match) return '-';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.toLocaleDateString('th-TH');
};

// ตัดวินาทีออกจากเวลา เช่น '08:30:00' -> '08:30'
const formatTime = (timeString) => (timeString ? timeString.slice(0, 5) : '-');

// ดึงค่า id จาก URL เช่น attendance.html?id=3 (ใช้ในโหมดแก้ไข)
const getIdFromUrl = () => new URLSearchParams(window.location.search).get('id');

// แสดงข้อความแจ้งเตือนในกล่อง message
const showMessage = (messageDom, type, message, errors = []) => {
    messageDom.textContent = '';
    const title = document.createElement('div');
    title.textContent = message;
    messageDom.appendChild(title);

    if (errors.length > 0) {
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
