// หน้าภาพรวมวันนี้

const addDaysStr = (dateStr, days) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
};

const renderList = (containerId, items, emptyText, renderItem) => {
    const container = document.getElementById(containerId);
    if (items.length === 0) {
        setTableMessage(container, emptyText);
        return;
    }
    container.innerHTML = `<ul class="list">${items.map(renderItem).join('')}</ul>`;
};

const renderStats = (data) => {
    const today = data.today;
    const historyLink = (params) => `history.html${buildQuery({ tab: 'attendance', ...params })}`;
    const stats = [
        { label: 'พนักงานทั้งหมด', value: data.active_employees, href: 'employees.html' },
        { label: 'ลงเวลาแล้ววันนี้', value: `${data.checked_in}`, href: historyLink({ from: today, to: today }) },
        {
            label: 'มาสายวันนี้', value: data.late.length, href: historyLink({ from: today, to: today, late: 1 }), tone: data.late.length ? 'warn' : '',
        },
        {
            label: 'ยังไม่ลงเวลา', value: data.is_working_day ? data.not_checked_in.total : '-', tone: data.not_checked_in.total ? 'bad' : '',
        },
        { label: 'ลาวันนี้', value: data.on_leave.length, href: `history.html${buildQuery({ tab: 'leave', from: today, to: today, status: 'approved' })}` },
        {
            label: 'คำขอลารออนุมัติ', value: data.pending_leaves.total, href: 'history.html?tab=leave&status=pending', tone: data.pending_leaves.total ? 'warn' : '',
        },
        {
            label: 'ลืมลงเวลาออก (30 วัน)',
            value: data.missing_out_previous,
            href: historyLink({ missing_out: 1, from: addDaysStr(today, -30), to: addDaysStr(today, -1) }),
            tone: data.missing_out_previous ? 'warn' : '',
        },
    ];

    document.getElementById('stats').innerHTML = stats.map((stat) => {
        const tag = stat.href ? 'a' : 'div';
        const href = stat.href ? ` href="${escapeHtml(stat.href)}"` : '';
        return `<${tag} class="stat ${stat.tone || ''}"${href}>
            <div class="label">${escapeHtml(stat.label)}</div>
            <div class="value">${escapeHtml(stat.value)}</div>
        </${tag}>`;
    }).join('');
};

const renderPending = (pending) => {
    renderList('pending-list', pending.items, 'ไม่มีคำขอลาที่รออนุมัติ', (leave) => `
        <li>
            <div>
                <div>${escapeHtml(employeeLabel(leave))}</div>
                <div class="sub">${escapeHtml(leave.leave_type)}${leave.half_day ? ' (ครึ่งวัน)' : ''} · ${escapeHtml(formatDateRange(leave.start_date, leave.end_date))}</div>
                <div class="sub">${escapeHtml(leave.reason)}</div>
            </div>
            <div class="actions">
                <button type="button" class="btn success sm" data-approve="${leave.id}" data-status="approved">อนุมัติ</button>
                <button type="button" class="btn secondary sm" data-approve="${leave.id}" data-status="rejected">ไม่อนุมัติ</button>
            </div>
        </li>`);
};

const load = async () => {
    const data = await api('/dashboard');

    document.getElementById('today-label').textContent = formatThaiDate(data.today, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const notice = document.getElementById('day-notice');
    if (!data.is_working_day) {
        notice.textContent = data.holiday_name ? `วันนี้เป็นวันหยุด: ${data.holiday_name}` : 'วันนี้ไม่ใช่วันทำงาน';
        notice.classList.remove('hidden');
    } else {
        notice.classList.add('hidden');
    }
    document.getElementById('late-after').textContent = `สายเมื่อเข้างานหลัง ${formatTime(data.late_after)}`;

    renderStats(data);
    renderPending(data.pending_leaves);

    renderList('leave-list', data.on_leave, 'วันนี้ไม่มีพนักงานลา', (leave) => `
        <li>
            <div>
                <div>${escapeHtml(employeeLabel(leave))}</div>
                <div class="sub">${escapeHtml(leave.department || '')}</div>
            </div>
            <span class="badge">${escapeHtml(leave.leave_type)}${leave.half_day ? ' ครึ่งวัน' : ''}</span>
        </li>`);

    renderList('late-list', data.late, 'วันนี้ไม่มีคนมาสาย', (row) => `
        <li>
            <div>
                <div>${escapeHtml(employeeLabel(row))}</div>
                <div class="sub">${escapeHtml(row.department || '')}</div>
            </div>
            <span class="badge late">เข้างาน ${escapeHtml(formatTime(row.time_in))}</span>
        </li>`);

    const missing = data.not_checked_in;
    if (!data.is_working_day) {
        setTableMessage(document.getElementById('missing-list'), 'วันนี้ไม่ใช่วันทำงาน');
    } else {
        renderList('missing-list', missing.items, 'ทุกคนลงเวลาหรือลาแล้ว', (row) => `
            <li>
                <div>
                    <div>${escapeHtml(employeeLabel(row))}</div>
                    <div class="sub">${escapeHtml(row.department || '')}</div>
                </div>
                <a class="btn secondary sm" href="attendance.html${buildQuery({ employee_id: row.employee_id })}">ลงเวลา</a>
            </li>`);
        if (missing.total > missing.items.length) {
            document.getElementById('missing-list').insertAdjacentHTML(
                'beforeend',
                `<p class="small muted">และอีก ${missing.total - missing.items.length} คน</p>`,
            );
        }
    }
};

onAppReady(async () => {
    await load();

    // ปุ่มอนุมัติ/ไม่อนุมัติ
    document.getElementById('pending-list').addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-approve]');
        if (!button) return;
        const approve = button.dataset.status === 'approved';
        const note = window.prompt(approve ? 'หมายเหตุการอนุมัติ (ไม่บังคับ)' : 'เหตุผลที่ไม่อนุมัติ (ไม่บังคับ)', '');
        if (note === null) return;

        await withBusy(button, async () => {
            try {
                const result = await api(`/leave_requests/${button.dataset.approve}/status`, {
                    method: 'PATCH',
                    body: { status: button.dataset.status, status_note: note },
                });
                if (result.warnings && result.warnings.length > 0) {
                    showPageMessage('warning', 'บันทึกแล้ว แต่มีข้อควรระวัง', result.warnings);
                } else {
                    showPageMessage('success', result.message);
                }
                await load();
            } catch (error) {
                showError(error);
            }
        });
    });
});
