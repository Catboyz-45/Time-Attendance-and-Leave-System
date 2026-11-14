// หน้ารายงาน: สรุปรายเดือน และวันลาคงเหลือรายปี (export เป็น CSV เปิดใน Excel ได้)

let reportTab = 'monthly';
let lastReport = null;

const filtersForm = () => document.getElementById('filters');

const renderMonthly = (data) => {
    const container = document.getElementById('table');
    const holidays = data.holidays.length > 0
        ? ` · วันหยุด: ${data.holidays.map((holiday) => `${formatThaiDate(holiday.date, { day: 'numeric', month: 'short' })} ${holiday.name}`).join(', ')}`
        : '';
    document.getElementById('report-note').textContent = `${formatThaiMonth(data.month)} มีวันทำงาน ${data.working_days} วัน`
        + ` · มาสาย = เข้างานหลัง ${formatTime(data.late_after)} · นับเฉพาะการลาที่อนุมัติแล้ว`
        + ` · วันขาดงานนับถึงวันนี้${holidays}`;

    if (data.rows.length === 0) {
        setTableMessage(container, 'ไม่มีข้อมูลพนักงานในเดือนนี้');
        return;
    }

    container.innerHTML = `
        <div class="table-wrap">
            <table class="data">
                <thead><tr>
                    <th>รหัส</th><th>ชื่อ-สกุล</th><th>แผนก</th>
                    <th class="num">วันทำงาน</th><th class="num">มาทำงาน</th><th class="num">สาย</th>
                    <th class="num">ขาดงาน</th><th class="num">ไม่ลงเวลาออก</th>
                    ${data.leave_types.map((type) => `<th class="num">${escapeHtml(type)}</th>`).join('')}
                    <th class="num">รวมลา</th>
                </tr></thead>
                <tbody>${data.rows.map((row) => `
                    <tr class="${row.active ? '' : 'inactive'}">
                        <td class="nowrap">${escapeHtml(row.employee_code)}</td>
                        <td>${escapeHtml(employeeName(row))}${row.active ? '' : ' <span class="badge">ปิดสถานะ</span>'}</td>
                        <td>${escapeHtml(row.department || '-')}</td>
                        <td class="num">${row.working_days}</td>
                        <td class="num">${row.present_days}</td>
                        <td class="num">${row.late_days ? `<a href="history.html${buildQuery({
        tab: 'attendance', employee_id: row.employee_id, from: data.from, to: data.to, late: 1,
    })}">${row.late_days}</a>` : 0}</td>
                        <td class="num ${row.absent_days ? 'negative' : ''}">${formatDays(row.absent_days)}</td>
                        <td class="num">${row.missing_out_days}</td>
                        ${data.leave_types.map((type) => `<td class="num">${formatDays(row.leave_days[type] || 0)}</td>`).join('')}
                        <td class="num">${formatDays(row.total_leave_days)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
};

const renderBalance = (data) => {
    const container = document.getElementById('table');
    const quotas = data.leave_types
        .map((type) => `${type} ${data.quotas[type] === undefined ? 'ไม่จำกัด' : `${data.quotas[type]} วัน`}`)
        .join(' · ');
    document.getElementById('report-note').textContent = `ปี ${data.year + 543} · โควตา: ${quotas} · ใช้ไป = อนุมัติแล้ว, ตัวเลขในวงเล็บ = รออนุมัติ`;

    if (data.rows.length === 0) {
        setTableMessage(container, 'ไม่มีพนักงาน');
        return;
    }

    const cell = (balance) => {
        const pending = balance.pending ? ` <span class="muted small">(+${formatDays(balance.pending)})</span>` : '';
        if (balance.quota === null) return `${formatDays(balance.used)}${pending}`;
        return `${formatDays(balance.used)}/${formatDays(balance.quota)}${pending}<br>
            <span class="small ${balance.remaining < 0 ? 'negative' : 'muted'}">เหลือ ${formatDays(balance.remaining)}</span>`;
    };

    container.innerHTML = `
        <div class="table-wrap">
            <table class="data">
                <thead><tr>
                    <th>รหัส</th><th>ชื่อ-สกุล</th><th>แผนก</th>
                    ${data.leave_types.map((type) => `<th class="num">${escapeHtml(type)}</th>`).join('')}
                </tr></thead>
                <tbody>${data.rows.map((row) => `
                    <tr>
                        <td class="nowrap">${escapeHtml(row.employee_code)}</td>
                        <td>${escapeHtml(employeeName(row))}</td>
                        <td>${escapeHtml(row.department || '-')}</td>
                        ${data.leave_types.map((type) => `<td class="num">${cell(row.balances[type])}</td>`).join('')}
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
};

const loadReport = async () => {
    const values = formValues(filtersForm());
    const container = document.getElementById('table');
    setTableMessage(container, 'กำลังโหลด...');
    try {
        if (reportTab === 'monthly') {
            lastReport = await api('/reports/monthly', { query: { month: values.month, department: values.department } });
            renderMonthly(lastReport);
        } else {
            lastReport = await api('/reports/leave-balance', { query: { year: values.year, department: values.department } });
            renderBalance(lastReport);
        }
    } catch (error) {
        lastReport = null;
        setTableMessage(container, `โหลดรายงานไม่สำเร็จ: ${error.message}`, true);
    }
};

const exportReport = () => {
    if (!lastReport) return;
    if (reportTab === 'monthly') {
        const data = lastReport;
        downloadCsv(`monthly-report_${data.month}.csv`, [
            ['รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'แผนก', 'วันทำงาน', 'มาทำงาน', 'มาสาย', 'ขาดงาน', 'ไม่ลงเวลาออก',
                ...data.leave_types, 'รวมวันลา', 'สถานะพนักงาน'],
            ...data.rows.map((row) => [
                row.employee_code, row.first_name, row.last_name, row.department || '', row.working_days, row.present_days,
                row.late_days, row.absent_days, row.missing_out_days,
                ...data.leave_types.map((type) => row.leave_days[type] || 0), row.total_leave_days,
                row.active ? 'ทำงานอยู่' : 'ปิดสถานะ',
            ]),
        ]);
        return;
    }

    const data = lastReport;
    const headers = ['รหัสพนักงาน', 'ชื่อ', 'นามสกุล', 'แผนก'];
    data.leave_types.forEach((type) => {
        headers.push(`${type} โควตา`, `${type} ใช้ไป`, `${type} รออนุมัติ`, `${type} คงเหลือ`);
    });
    downloadCsv(`leave-balance_${data.year}.csv`, [
        headers,
        ...data.rows.map((row) => [
            row.employee_code, row.first_name, row.last_name, row.department || '',
            ...data.leave_types.flatMap((type) => {
                const balance = row.balances[type];
                return [balance.quota ?? 'ไม่จำกัด', balance.used, balance.pending, balance.remaining ?? ''];
            }),
        ]),
    ]);
};

onAppReady(async () => {
    const form = filtersForm();
    form.elements.month.value = getParam('month') || currentMonth();
    const thisYear = Number(todayStr().slice(0, 4));
    fillOptions(form.elements.year, [thisYear + 1, thisYear, thisYear - 1, thisYear - 2, thisYear - 3]
        .map((year) => [year, `${year + 543} (${year})`]));
    form.elements.year.value = String(thisYear);
    await fillDepartmentSelect(form.elements.department);

    await loadReport();

    form.addEventListener('change', loadReport);
    form.addEventListener('submit', (event) => event.preventDefault());
    document.getElementById('export-btn').addEventListener('click', exportReport);

    document.querySelectorAll('.tabs button').forEach((button) => {
        button.addEventListener('click', () => {
            reportTab = button.dataset.tab;
            document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === button));
            document.querySelectorAll('[data-for]').forEach((element) => {
                element.classList.toggle('hidden', element.dataset.for !== reportTab);
            });
            loadReport();
        });
    });
});
