// หน้าเข้าสู่ระบบ

// กลับไปหน้าที่ตั้งใจจะเปิด (เฉพาะหน้าในระบบเดียวกัน กันการพาไปเว็บอื่น)
const nextPage = () => {
    const next = getParam('next') || '';
    return /^[a-z-]+\.html(\?[^/\\]*)?$/i.test(next) && !next.startsWith('login.html') ? next : 'index.html';
};

document.addEventListener('DOMContentLoaded', async () => {
    // ถ้า login อยู่แล้วให้ไปหน้าหลักเลย
    try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (response.ok) {
            window.location.href = nextPage();
            return;
        }
    } catch {
        // ยังเชื่อมต่อไม่ได้ ให้แสดงฟอร์มตามปกติ
    }

    const form = document.getElementById('login-form');
    const messageDom = document.getElementById('page-message');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { username, password } = formValues(form);
        if (!username || !password) {
            showMessage(messageDom, 'danger', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
            return;
        }

        await withBusy(document.getElementById('login-btn'), async () => {
            try {
                const user = await api('/auth/login', { method: 'POST', body: { username, password } });
                window.location.href = user.must_change_password ? 'settings.html#password' : nextPage();
            } catch (error) {
                showMessage(messageDom, 'danger', error.message);
                form.elements.password.value = '';
                form.elements.password.focus();
            }
        });
    });
});
