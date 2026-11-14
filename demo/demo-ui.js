// แถบ "โหมดทดลอง" ที่มุมล่างของทุกหน้า (เฉพาะเวอร์ชัน GitHub Pages)
(() => {
    const REPO_URL = 'https://github.com/Catboyz-45/Time-Attendance-and-Leave-System';

    const bar = document.createElement('div');
    bar.className = 'demo-bar no-print';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'โหมดทดลอง');
    bar.innerHTML = `
        <span class="demo-tag">โหมดทดลอง</span>
        <span class="demo-text">ข้อมูลเป็นตัวอย่าง เก็บในเบราว์เซอร์นี้เท่านั้น ลองเพิ่ม แก้ หรือลบได้เลย</span>
        <button type="button" class="demo-link" id="demo-reset">รีเซ็ตข้อมูล</button>
        <a class="demo-link" href="${REPO_URL}" target="_blank" rel="noopener">ดูโค้ดบน GitHub</a>`;

    const mount = () => {
        document.body.appendChild(bar);
        document.body.classList.add('has-demo-bar');
        document.getElementById('demo-reset').addEventListener('click', () => {
            // eslint-disable-next-line no-alert
            if (!window.confirm('ล้างทุกอย่างที่ลองทำไว้ แล้วกลับไปใช้ข้อมูลตัวอย่างชุดเริ่มต้น?')) return;
            window.DemoServer.reset();
            window.location.href = 'index.html';
        });

        // หน้าเข้าสู่ระบบ: บอกชื่อผู้ใช้/รหัสผ่านสำหรับทดลอง พร้อมปุ่มกรอกให้
        const form = document.getElementById('login-form');
        if (form) {
            const { username, password } = window.DemoServer.credentials;
            const hint = document.createElement('div');
            hint.className = 'demo-login-hint';
            hint.innerHTML = `ทดลองใช้ด้วยชื่อผู้ใช้ <code>${username}</code> รหัสผ่าน <code>${password}</code>
                <button type="button" class="btn secondary sm" id="demo-fill">กรอกให้</button>`;
            form.parentNode.insertBefore(hint, form);
            document.getElementById('demo-fill').addEventListener('click', () => {
                form.elements.username.value = username;
                form.elements.password.value = password;
                form.requestSubmit();
            });
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
