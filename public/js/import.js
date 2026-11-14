// หน้านำเข้าการลงเวลาจากไฟล์ CSV
// 1) อ่านไฟล์และแยกคอลัมน์ 2) ให้ผู้ใช้เลือกคอลัมน์ 3) ส่งให้เซิร์ฟเวอร์ตรวจ (dry run) 4) ยืนยันนำเข้า

const MAX_IMPORT_ROWS = 5000;
const STATUS_LABELS = {
    create: 'เพิ่มใหม่', update: 'อัปเดต', unchanged: 'ไม่เปลี่ยน', error: 'ผิดพลาด',
};

const state = {
    fileName: '', table: [], rows: [], results: [],
};

// ===================== อ่านไฟล์ =====================

// อ่านไฟล์เป็นข้อความ: ลอง UTF-8 ก่อน ถ้าอ่านภาษาไทยไม่ได้ให้ลอง TIS-620 (windows-874) ที่ Excel ไทยใช้
const readFileText = async (file) => {
    const buffer = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buffer);
    if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
    try {
        return new TextDecoder('windows-874').decode(buffer);
    } catch {
        return utf8;
    }
};

// เดาตัวคั่นจากบรรทัดแรก (, ; หรือ tab)
const detectDelimiter = (text) => {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const counts = [',', ';', '\t'].map((delimiter) => [delimiter, firstLine.split(delimiter).length]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 1 ? counts[0][0] : ',';
};

// แยก CSV รองรับค่าที่อยู่ในเครื่องหมายคำพูดและมี , หรือขึ้นบรรทัดใหม่อยู่ข้างใน
const parseCsv = (text, delimiter) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (char === '"') quoted = false;
            else cell += char;
        } else if (char === '"') {
            quoted = true;
        } else if (char === delimiter) {
            row.push(cell); cell = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i += 1;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else {
            cell += char;
        }
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((value) => value.trim())).filter((r) => r.some((value) => value !== ''));
};

// ===================== แปลงวันที่/เวลา =====================

const pad = (value) => String(value).padStart(2, '0');

// แปลงเวลา เช่น '8:05', '08.05', '08:05:30', '5:30 PM' -> '08:05'
const parseTime = (text) => {
    const match = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(am|pm|AM|PM)?/.exec(text || '');
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = (match[4] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return `${pad(hour)}:${pad(minute)}`;
};

// ปี พ.ศ. (เกิน 2400) แปลงเป็น ค.ศ. และปี 2 หลักถือเป็น 20xx
const normalizeYear = (year) => {
    let value = Number(year);
    if (value < 100) value += 2000;
    if (value > 2400) value -= 543;
    return value;
};

const validDate = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

// แปลงวันที่ (อาจมีเวลาต่อท้าย) -> { date: 'YYYY-MM-DD', time: 'HH:MM' | null }
const parseDateCell = (text, dateFormat) => {
    const value = (text || '').trim();
    let year;
    let month;
    let day;
    let rest = '';

    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/.exec(value);
    if (match) {
        [, year, month, day, rest] = match;
    } else {
        match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/.exec(value);
        if (!match) return null;
        const [, first, second, y, tail] = match;
        [day, month] = dateFormat === 'mdy' ? [second, first] : [first, second];
        year = y;
        rest = tail;
    }

    const yearNumber = normalizeYear(year);
    if (!validDate(yearNumber, Number(month), Number(day))) return null;
    return {
        date: `${yearNumber}-${pad(month)}-${pad(day)}`,
        time: parseTime(rest.replace(/^[T\s]+/, '')),
    };
};

// ===================== เลือกคอลัมน์ =====================

const COLUMN_SELECTS = {
    code: 'col-code', date: 'col-date', in: 'col-in', out: 'col-out',
};

// เดาคอลัมน์จากชื่อหัวตาราง
const guessColumns = (headers) => {
    const find = (patterns, exclude = []) => headers.findIndex((header, index) => !exclude.includes(index)
        && patterns.some((pattern) => pattern.test(header)));
    const code = find([/รหัส/, /code/i, /ac-?no/i, /emp/i, /^id$/i, /^no\.?$/i, /user ?id/i]);
    const out = find([/ออก/, /out/i], [code]);
    const timeIn = find([/เข้า/, /\bin\b/i, /check.?in/i], [code, out]);
    const date = find([/วันที่/, /date/i, /วันเวลา/, /datetime/i, /^time$/i, /เวลา/], [code, out, timeIn]);
    return {
        code, date, in: timeIn, out,
    };
};

const fillColumnSelects = (headers, guess) => {
    Object.entries(COLUMN_SELECTS).forEach(([key, selectId]) => {
        const select = document.getElementById(selectId);
        const optional = key === 'in' || key === 'out';
        fillOptions(select, headers.map((header, index) => [index, header || `คอลัมน์ ${index + 1}`]), optional ? '— ไม่ใช้ —' : '— เลือก —');
        select.value = guess[key] >= 0 ? String(guess[key]) : '';
    });
};

const renderRawPreview = (headers, body) => {
    const container = document.getElementById('raw-preview');
    container.innerHTML = `
        <div class="table-wrap">
            <table class="data">
                <thead><tr>${headers.map((header, index) => `<th>${escapeHtml(header || `คอลัมน์ ${index + 1}`)}</th>`).join('')}</tr></thead>
                <tbody>${body.slice(0, 5).map((row) => `<tr>${headers.map((_, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
        </div>`;
};

const tableParts = () => {
    const hasHeader = document.getElementById('has-header').checked;
    const width = Math.max(...state.table.map((row) => row.length));
    const headers = hasHeader
        ? Array.from({ length: width }, (_, index) => state.table[0][index] || '')
        : Array.from({ length: width }, (_, index) => `คอลัมน์ ${index + 1}`);
    const body = hasHeader ? state.table.slice(1) : state.table;
    return { hasHeader, headers, body };
};

const showMapping = () => {
    const { headers, body } = tableParts();
    fillColumnSelects(headers, guessColumns(headers));
    renderRawPreview(headers, body);
    document.getElementById('file-info').textContent = `${state.fileName} · ${body.length} แถว`;
    document.getElementById('mapping-card').classList.remove('hidden');
    document.getElementById('result-card').classList.add('hidden');
};

// แปลงแต่ละแถวของไฟล์เป็นข้อมูลที่ส่งให้เซิร์ฟเวอร์ (แถวที่อ่านไม่ได้ส่งไปให้เซิร์ฟเวอร์รายงานเป็นข้อผิดพลาด)
const buildRows = () => {
    const { hasHeader, body } = tableParts();
    const columns = Object.fromEntries(Object.entries(COLUMN_SELECTS).map(([key, id]) => {
        const value = document.getElementById(id).value;
        return [key, value === '' ? -1 : Number(value)];
    }));
    const errors = [];
    if (columns.code < 0) errors.push('กรุณาเลือกคอลัมน์รหัสพนักงาน');
    if (columns.date < 0) errors.push('กรุณาเลือกคอลัมน์วันที่');
    if (errors.length > 0) return { errors };

    const dateFormat = document.getElementById('date-format').value;
    const rows = body.map((row, index) => {
        const parsed = parseDateCell(row[columns.date], dateFormat);
        const timeIn = columns.in >= 0 ? parseTime(row[columns.in]) : parsed && parsed.time;
        const timeOut = columns.out >= 0 ? parseTime(row[columns.out]) : null;
        return {
            line: index + (hasHeader ? 2 : 1),
            employee_code: row[columns.code] || '',
            date: parsed ? parsed.date : (row[columns.date] || ''),
            time_in: timeIn || (row[columns.in] ?? ''),
            time_out: timeOut || '',
        };
    });
    return { errors: [], rows };
};

// ===================== ผลการตรวจ =====================

const renderResults = () => {
    const filter = document.getElementById('result-filter').value;
    const results = state.results.filter((row) => !filter || row.status === filter);
    const container = document.getElementById('results');
    if (results.length === 0) {
        setTableMessage(container, 'ไม่มีรายการ');
        return;
    }
    const shown = results.slice(0, 500);
    container.innerHTML = `
        <div class="table-wrap">
            <table class="data">
                <thead><tr><th>แถวในไฟล์</th><th>สถานะ</th><th>รหัส</th><th>ชื่อ</th><th>วันที่</th><th>เข้า</th><th>ออก</th><th>หมายเหตุ</th></tr></thead>
                <tbody>${shown.map((row) => `
                    <tr>
                        <td class="nowrap">${escapeHtml(row.lines.join(', '))}</td>
                        <td><span class="badge ${escapeHtml(row.status)}">${escapeHtml(STATUS_LABELS[row.status])}</span></td>
                        <td class="nowrap">${escapeHtml(row.employee_code)}</td>
                        <td>${escapeHtml(row.employee_name || '-')}</td>
                        <td class="nowrap">${/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? escapeHtml(formatThaiDate(row.date)) : escapeHtml(row.date)}</td>
                        <td>${escapeHtml(row.time_in ? formatTime(row.time_in) : '-')}</td>
                        <td>${escapeHtml(row.time_out ? formatTime(row.time_out) : '-')}</td>
                        <td class="small">${escapeHtml((row.messages || []).join(' · '))}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
        ${results.length > shown.length ? `<p class="small muted">แสดง 500 รายการแรกจาก ${results.length}</p>` : ''}`;
};

const showSummary = (summary, committed) => {
    const parts = [
        `เพิ่มใหม่ ${summary.create}`, `อัปเดต ${summary.update}`, `ไม่เปลี่ยน ${summary.unchanged}`, `ผิดพลาด ${summary.error}`,
    ];
    const dom = document.getElementById('summary');
    if (committed) {
        showMessage(dom, 'success', `นำเข้าเรียบร้อย: ${parts.join(' · ')}`);
    } else {
        const type = summary.error > 0 ? 'warning' : 'success';
        const tail = summary.error > 0 ? ' — แถวที่ผิดพลาดจะถูกข้าม กรุณาแก้ไฟล์แล้วนำเข้าใหม่ถ้าต้องการ' : '';
        showMessage(dom, type, `ไฟล์มี ${summary.rows} แถว จะได้ ${parts.join(' · ')}${tail}`);
    }
    const importButton = document.getElementById('import-btn');
    const count = summary.create + summary.update;
    importButton.textContent = `นำเข้า ${count} รายการ`;
    importButton.classList.toggle('hidden', committed || count === 0);
};

const submit = async (dryRun) => {
    const built = buildRows();
    if (built.errors.length > 0) {
        showPageMessage('danger', 'ยังเลือกคอลัมน์ไม่ครบ', built.errors);
        return;
    }
    if (built.rows.length === 0) {
        showPageMessage('danger', 'ไม่พบข้อมูลในไฟล์');
        return;
    }
    if (built.rows.length > MAX_IMPORT_ROWS) {
        showPageMessage('danger', `ไฟล์มี ${built.rows.length} แถว นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT_ROWS} แถว กรุณาแบ่งไฟล์`);
        return;
    }
    hideMessage(document.getElementById('page-message'));

    const result = await api('/import/attendance', {
        method: 'POST', body: { rows: built.rows, dry_run: dryRun, file_name: state.fileName },
    });
    state.results = result.results;
    document.getElementById('result-card').classList.remove('hidden');
    showSummary(result.summary, !dryRun);
    renderResults();
    document.getElementById('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

onAppReady(async () => {
    const fileInput = document.getElementById('file');

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
            const text = await readFileText(file);
            state.fileName = file.name;
            state.table = parseCsv(text, detectDelimiter(text));
            if (state.table.length === 0) {
                showPageMessage('danger', 'ไฟล์ว่างหรืออ่านไม่ได้');
                return;
            }
            // ถ้าแถวแรกมีวันที่อยู่ น่าจะไม่ใช่หัวตาราง
            document.getElementById('has-header').checked = !state.table[0].some((cell) => parseDateCell(cell, 'dmy'));
            hideMessage(document.getElementById('page-message'));
            showMapping();
        } catch (error) {
            showPageMessage('danger', `อ่านไฟล์ไม่สำเร็จ: ${error.message}`);
        }
    });

    document.getElementById('has-header').addEventListener('change', () => {
        if (state.table.length > 0) showMapping();
    });
    document.querySelectorAll('[data-col], #date-format').forEach((element) => {
        element.addEventListener('change', () => document.getElementById('result-card').classList.add('hidden'));
    });
    document.getElementById('result-filter').addEventListener('change', renderResults);

    document.getElementById('check-btn').addEventListener('click', (event) => withBusy(event.currentTarget, async () => {
        try {
            await submit(true);
        } catch (error) {
            showError(error);
        }
    }));

    document.getElementById('import-btn').addEventListener('click', (event) => {
        if (!window.confirm('ยืนยันนำเข้าข้อมูล? รายการที่มีอยู่แล้วจะถูกอัปเดตเวลาเข้า/ออกตามไฟล์')) return;
        withBusy(event.currentTarget, async () => {
            try {
                await submit(false);
            } catch (error) {
                showError(error);
            }
        });
    });

    document.getElementById('template-btn').addEventListener('click', () => {
        const today = todayStr();
        downloadCsv('attendance-template.csv', [
            ['รหัสพนักงาน', 'วันที่', 'เวลาเข้า', 'เวลาออก'],
            ['E001', today, '08:25', '17:35'],
            ['E002', today, '08:40', ''],
        ]);
    });
});
