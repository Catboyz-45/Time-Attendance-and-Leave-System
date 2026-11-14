// ตรวจและรวมข้อมูลนำเข้าการลงเวลา (ไม่แตะฐานข้อมูล ใช้ร่วมกับโหมดทดลองบน GitHub Pages ได้)
const {
  isFilled, isValidDate, isValidTime, normalizeTime,
} = require('./validate');

const MAX_ROWS = 5000;
const MAX_SHEET_ROWS = 20000;

// ===================== อ่านไฟล์ Excel (.xlsx) ด้วย exceljs =====================

const pad = (value) => String(value).padStart(2, '0');

// วันที่/เวลาใน Excel: exceljs คืนเป็น Date ที่ตีความแบบ UTC
const excelDateText = (date) => {
  const y = date.getUTCFullYear();
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  // เซลล์ที่มีแต่เวลา Excel จะเก็บเป็นวันที่ 30 ธ.ค. 1899
  if (y === 1899 && date.getUTCMonth() === 11 && date.getUTCDate() === 30) return time;
  const day = `${y}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return time === '00:00' ? day : `${day} ${time}`;
};

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return excelDateText(value);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellText(value.result); // สูตร: ใช้ผลลัพธ์
    if (value.text !== undefined) return String(value.text); // ลิงก์
    return '';
  }
  return String(value).trim();
};

// แปลงชีตของ exceljs เป็นตารางข้อความ (ข้ามแถวว่าง)
const sheetRows = (sheet) => {
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      values[column - 1] = cellText(cell.value);
    });
    const cells = Array.from(values, (value) => value ?? '');
    if (cells.some((value) => value !== '')) rows.push(cells);
  });
  return rows;
};

const minTime = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));
const maxTime = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

// 1) ตรวจแต่ละแถว และรวมแถวของพนักงานคนเดียวกันวันเดียวกัน
const mergeRows = (inputRows, today) => {
  const results = [];
  const merged = new Map();
  inputRows.forEach((row, index) => {
    const line = Number(row.line) || index + 1;
    const code = isFilled(row.employee_code) ? String(row.employee_code).trim() : '';
    const errors = [];
    if (!code) errors.push('ไม่มีรหัสพนักงาน');
    if (!isValidDate(row.date)) errors.push('วันที่ไม่ถูกต้อง');
    else if (row.date > today) errors.push('วันที่เกินวันนี้');
    if (!isValidTime(row.time_in)) errors.push('เวลาเข้างานไม่ถูกต้อง');
    if (isFilled(row.time_out) && !isValidTime(row.time_out)) errors.push('เวลาออกงานไม่ถูกต้อง');

    if (errors.length > 0) {
      results.push({
        lines: [line], employee_code: code, date: row.date || '', status: 'error', messages: errors,
      });
      return;
    }

    const key = `${code.toLowerCase()}|${row.date}`;
    if (!merged.has(key)) {
      merged.set(key, {
        lines: [], employee_code: code, date: row.date, ins: [], outs: [],
      });
    }
    const entry = merged.get(key);
    entry.lines.push(line);
    entry.ins.push(normalizeTime(row.time_in));
    if (isFilled(row.time_out)) entry.outs.push(normalizeTime(row.time_out));
  });

  // เวลาเข้า = เวลาที่เร็วที่สุด, เวลาออก = เวลาที่ช้าที่สุด (กรณีสแกนหลายครั้งต่อวัน)
  // ถ้ามีเวลาเดียว (สแกนครั้งเดียว) ถือเป็นเวลาเข้างาน ยังไม่มีเวลาออก
  const entries = [...merged.values()].map(({ ins, outs, ...entry }) => {
    const timeIn = ins.reduce(minTime, null);
    const candidates = ins.length > 1 ? [...outs, ...ins] : outs;
    const latest = candidates.reduce(maxTime, null);
    return { ...entry, time_in: timeIn, time_out: latest && latest > timeIn ? latest : null };
  });

  return { results, entries };
};

/**
 * 4) สรุปว่าแต่ละรายการจะ เพิ่มใหม่ / อัปเดต / ไม่เปลี่ยน
 * employeesByCode: Map(รหัสตัวเล็ก -> พนักงาน), existing: Map('employee_id|date' -> การลงเวลาเดิม)
 * leaveOn(employeeId, date): ใบลาเต็มวันที่อนุมัติแล้วในวันนั้น (ถ้ามี)
 */
const planImport = ({
  entries, results, employeesByCode, existing, leaveOn, rowCount,
}) => {
  const actions = [];
  for (const entry of entries) {
    const employee = employeesByCode.get(entry.employee_code.toLowerCase());
    if (!employee) {
      results.push({ ...entry, status: 'error', messages: [`ไม่พบรหัสพนักงาน ${entry.employee_code} ในระบบ`] });
      continue;
    }
    const name = `${employee.first_name} ${employee.last_name}`;
    const messages = employee.active ? [] : ['พนักงานคนนี้ปิดสถานะแล้ว'];
    const leave = leaveOn(employee.id, entry.date);
    if (leave) messages.push(`ตรงกับวัน${leave.leave_type}ที่อนุมัติแล้ว กรุณาตรวจสอบ`);
    const current = existing.get(`${employee.id}|${entry.date}`);

    if (!current) {
      actions.push({ type: 'create', employee, entry });
      results.push({ ...entry, employee_name: name, status: 'create', messages });
      continue;
    }

    const timeIn = minTime(current.time_in, entry.time_in);
    const timeOut = maxTime(current.time_out, entry.time_out);
    if (timeIn === current.time_in && timeOut === current.time_out) {
      results.push({ ...entry, employee_name: name, status: 'unchanged', messages: [...messages, 'ข้อมูลตรงกับที่มีอยู่แล้ว'] });
      continue;
    }
    actions.push({
      type: 'update', employee, entry, current, timeIn, timeOut,
    });
    results.push({
      ...entry,
      time_in: timeIn,
      time_out: timeOut,
      employee_name: name,
      status: 'update',
      messages: [...messages, `อัปเดตจากเดิม ${current.time_in.slice(0, 5)}-${current.time_out ? current.time_out.slice(0, 5) : '?'}`],
    });
  }

  results.sort((a, b) => a.lines[0] - b.lines[0]);
  const summary = {
    rows: rowCount,
    create: results.filter((row) => row.status === 'create').length,
    update: results.filter((row) => row.status === 'update').length,
    unchanged: results.filter((row) => row.status === 'unchanged').length,
    error: results.filter((row) => row.status === 'error').length,
  };

  return { actions, summary };
};

module.exports = {
  MAX_ROWS, MAX_SHEET_ROWS, cellText, sheetRows, mergeRows, planImport,
};
