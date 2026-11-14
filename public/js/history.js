// หน้าประวัติการทำงานและการลา: แสดงตาราง พร้อมปุ่มแก้ไข/ลบ
// ต้องโหลด common.js ก่อนไฟล์นี้

// ตั้งค่าของแต่ละตาราง: path ของ API, หน้าที่ใช้แก้ไข, หัวตาราง และวิธีแสดงแต่ละแถว
const TABLES = {
    attendance: {
        apiPath: '/attendance',
        editPage: 'attendance.html',
        containerId: 'attendance-table',
        emptyText: 'ยังไม่มีข้อมูลการลงเวลา',
        headers: ['ID', 'รหัสพนักงาน', 'วันที่', 'เวลาเข้างาน', 'เวลาออกงาน'],
        cells: (record) => [
            record.id,
            record.employee_id,
            formatThaiDate(record.date),
            formatTime(record.time_in),
            formatTime(record.time_out),
        ],
    },
    leave: {
        apiPath: '/leave_requests',
        editPage: 'leave.html',
        containerId: 'leave-table',
        emptyText: 'ยังไม่มีข้อมูลการลา',
        headers: ['ID', 'รหัสพนักงาน', 'วันที่เริ่มลา', 'วันที่สิ้นสุดลา', 'ประเภทการลา', 'เหตุผล'],
        cells: (record) => [
            record.id,
            record.employee_id,
            formatThaiDate(record.start_date),
            formatThaiDate(record.end_date),
            record.leave_type,
            record.reason || '-',
        ],
    },
};

// โหลดข้อมูลจาก API แล้วสร้างตาราง (ทุกค่าจากฐานข้อมูลผ่าน escapeHtml ก่อนใส่ลง HTML)
const loadData = async (type) => {
    const config = TABLES[type];
    const container = document.getElementById(config.containerId);

    let records;
    try {
        records = await api(config.apiPath);
    } catch (error) {
        container.innerHTML = `<p class="table-message error">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
        return;
    }

    if (records.length === 0) {
        container.innerHTML = `<p class="table-message">${escapeHtml(config.emptyText)}</p>`;
        return;
    }

    const headerHtml = [...config.headers, 'จัดการ'].map((header) => `<th>${escapeHtml(header)}</th>`).join('');
    const rowsHtml = records.map((record) => {
        const cellsHtml = config.cells(record).map((value) => `<td>${escapeHtml(value)}</td>`).join('');
        const id = encodeURIComponent(record.id);
        return `
            <tr>
                ${cellsHtml}
                <td class="actions">
                    <a class="Edit" href="${config.editPage}?id=${id}">แก้ไข</a>
                    <button type="button" class="delete" data-id="${escapeHtml(record.id)}" data-type="${type}">ลบ</button>
                </td>
            </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead><tr>${headerHtml}</tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
};

// ผูก event ปุ่มลบครั้งเดียวที่ระดับ document (event delegation)
// แบบเดิมผูกซ้ำทุกครั้งที่โหลดตาราง ทำให้กดครั้งเดียวแต่ส่งคำขอลบหลายครั้ง
document.addEventListener('click', async (event) => {
    const button = event.target.closest('button.delete');
    if (!button) return;

    const { id, type } = button.dataset;
    if (!window.confirm(`ต้องการลบรายการ ID ${id} ใช่หรือไม่?`)) return;

    button.disabled = true;
    try {
        await api(`${TABLES[type].apiPath}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await loadData(type);
    } catch (error) {
        window.alert(`ลบข้อมูลไม่สำเร็จ: ${error.message}`);
        button.disabled = false;
    }
});

window.addEventListener('DOMContentLoaded', () => {
    loadData('attendance');
    loadData('leave');
});
