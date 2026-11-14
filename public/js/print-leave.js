// หน้าพิมพ์ใบลา (A4): ข้อมูลกรอกไว้แล้ว มีช่องให้ผู้ขอลาและหัวหน้าเซ็น

const box = (checked) => `<span class="checkbox-box">${checked ? '✓' : ''}</span>`;
const blank = (value, width = 'long') => (value
    ? `<span class="fill">${escapeHtml(value)}</span>`
    : `<span class="fill blank ${width}"></span>`);

const renderSheet = (leave, balance, settings) => {
    const decided = leave.status !== 'pending';
    const leaveNo = `L-${String(leave.id).padStart(6, '0')}`;

    document.getElementById('sheet').innerHTML = `
        <header class="sheet-head">
            <div>
                ${settings.company_name ? `<div class="company">${escapeHtml(settings.company_name)}</div>` : ''}
                <h1>แบบฟอร์มใบลา</h1>
            </div>
            <div class="sheet-meta">
                <div>เลขที่ ${escapeHtml(leaveNo)}</div>
                <div>วันที่ยื่น ${escapeHtml(formatThaiDate(String(leave.created_at).slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }))}</div>
            </div>
        </header>

        <section class="sheet-section">
            <div class="row">
                <span>ชื่อ-สกุล ${blank(employeeName(leave))}</span>
                <span>รหัสพนักงาน ${blank(leave.employee_code, 'short')}</span>
            </div>
            <div class="row">
                <span>แผนก ${blank(leave.department)}</span>
                <span>ตำแหน่ง ${blank(leave.position)}</span>
            </div>
        </section>

        <section class="sheet-section">
            <div class="row types">
                <span>ประเภทการลา</span>
                ${LEAVE_TYPES.map((type) => `<span>${box(type === leave.leave_type)} ${escapeHtml(type)}</span>`).join('')}
            </div>
            <div class="row">
                <span>ตั้งแต่วันที่ ${blank(formatThaiDate(leave.start_date, { day: 'numeric', month: 'long', year: 'numeric' }))}</span>
                <span>ถึงวันที่ ${blank(formatThaiDate(leave.end_date, { day: 'numeric', month: 'long', year: 'numeric' }))}</span>
            </div>
            <div class="row">
                <span>รวม ${blank(formatDays(leave.days), 'short')} วันทำงาน ${leave.half_day ? '(ลาครึ่งวัน)' : ''}</span>
            </div>
            <div class="row">
                <span class="grow">เหตุผล ${blank(leave.reason)}</span>
            </div>
        </section>

        <section class="sheet-section">
            <div class="section-title">สถิติการลาปี ${balance.year + 543} (ไม่รวมครั้งนี้)</div>
            <table class="sheet-table">
                <thead><tr><th>ประเภท</th><th>สิทธิ์ (วัน)</th><th>ลาไปแล้ว</th><th>ครั้งนี้</th><th>คงเหลือหลังลา</th></tr></thead>
                <tbody>${balance.rows.map((row) => `
                    <tr>
                        <td>${escapeHtml(row.type)}</td>
                        <td>${row.entitled === null ? 'ไม่จำกัด' : formatDays(row.entitled)}${row.carried ? ` <small>(สะสม ${formatDays(row.carried)})</small>` : ''}</td>
                        <td>${formatDays(row.used)}</td>
                        <td>${row.thisLeave ? formatDays(row.thisLeave) : '-'}</td>
                        <td>${row.after === null ? '-' : formatDays(row.after)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </section>

        <section class="signatures">
            <div class="signature">
                <div class="sign-line"></div>
                <div>( ${escapeHtml(employeeName(leave))} )</div>
                <div>ผู้ขอลา</div>
                <div class="sign-date">วันที่ ........../........../..........</div>
            </div>
            <div class="signature">
                <div class="decision">
                    <span>${box(leave.status === 'approved')} อนุมัติ</span>
                    <span>${box(leave.status === 'rejected')} ไม่อนุมัติ</span>
                </div>
                <div class="sign-line"></div>
                <div>( ${decided && leave.approver_name ? escapeHtml(leave.approver_name) : '.......................................................'} )</div>
                <div>ผู้บังคับบัญชา / ผู้อนุมัติ</div>
                <div class="sign-date">วันที่ ........../........../..........</div>
            </div>
        </section>

        <section class="sheet-section hr-box">
            <div class="section-title">สำหรับฝ่ายบุคคล</div>
            <div>ความเห็น ${blank(leave.status_note)}</div>
            <div class="row">
                <span>บันทึกเข้าระบบโดย ${blank(leave.decided_by_name || '')}</span>
                <span>วันที่ ${blank(leave.decided_at ? formatDateTime(leave.decided_at) : '', 'short')}</span>
            </div>
        </section>`;
};

onAppReady(async () => {
    const id = getParam('id');
    if (!id) {
        showPageMessage('danger', 'ไม่พบใบลาที่ต้องการพิมพ์');
        return;
    }
    const [leave, settings] = await Promise.all([
        api(`/leave_requests/${encodeURIComponent(id)}`),
        api('/settings'),
    ]);
    renderSheet(leave, await leaveBalanceFor(leave), settings);
    document.title = `ใบลา ${leave.employee_code} ${leave.start_date}`;
    document.getElementById('print-btn').addEventListener('click', () => window.print());
});
