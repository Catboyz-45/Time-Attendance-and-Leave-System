// ตัวเลือกวันที่ เดือน เวลา และดรอปดาวน์ ที่หน้าตาเข้ากับธีมของระบบ (แสดงปีเป็น พ.ศ.)
//
// วิธีทำงาน: "ห่อ" ช่องเดิม (input type=date/month/time, select, input ที่มี datalist) แล้วแสดงช่องใหม่แทน
// ช่องเดิมยังอยู่ในฟอร์มแบบซ่อน เก็บค่ารูปแบบเดิม (YYYY-MM-DD, YYYY-MM, HH:MM)
// โค้ดของแต่ละหน้าจึงอ่าน/ตั้งค่า .value และฟัง event change/input ได้เหมือนเดิมทุกอย่าง
// โหลดไฟล์นี้หลัง common.js (ใช้ icon() และ todayStr())

(() => {
    const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    const BE = 543;

    const pad = (n) => String(n).padStart(2, '0');
    const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
    const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

    const parseIsoDate = (text) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
        if (!match) return null;
        const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
        if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
        return { y, m, d };
    };

    const parseIsoMonth = (text) => {
        const match = /^(\d{4})-(\d{2})$/.exec(text || '');
        return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? { y: Number(match[1]), m: Number(match[2]) } : null;
    };

    const addDays = ({ y, m, d }, days) => {
        const date = new Date(Date.UTC(y, m - 1, d + days));
        return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    };

    const addMonths = ({ y, m, d }, months) => {
        const index = y * 12 + (m - 1) + months;
        const ny = Math.floor(index / 12);
        const nm = (index % 12) + 1;
        return { y: ny, m: nm, d: Math.min(d || 1, daysInMonth(ny, nm)) };
    };

    const today = () => parseIsoDate(todayStr());

    // ปีที่ผู้ใช้พิมพ์: 2 หลัก = พ.ศ. 25xx, มากกว่า 2400 = พ.ศ., นอกนั้นถือเป็น ค.ศ.
    const normalizeYear = (text) => {
        let year = Number(text);
        if (text.length === 2) year += 2500;
        if (year > 2400) year -= BE;
        return year;
    };

    // รับได้หลายรูปแบบ: 17/11/2569, 17-11-69, 17.11.2026, 17112569, 2026-11-17
    const parseDateText = (raw) => {
        const text = raw.trim().replace(/\s+/g, '');
        if (!text) return '';
        if (parseIsoDate(text)) return text;
        let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
        if (!match) match = /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(text);
        if (!match) return null;
        const y = normalizeYear(match[3]);
        const iso = isoDate(y, Number(match[2]), Number(match[1]));
        return parseIsoDate(iso) ? iso : null;
    };

    // รับได้: 8:30, 08.30, 0830, 830, 8
    const parseTimeText = (raw) => {
        const text = raw.trim().replace(/\s+/g, '').replace('น.', '');
        if (!text) return '';
        let match = /^(\d{1,2})[:.](\d{2})$/.exec(text);
        if (!match) match = /^(\d{1,2})(\d{2})$/.exec(text);
        if (!match) match = /^(\d{1,2})()$/.exec(text);
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2] || 0);
        if (hour > 23 || minute > 59) return null;
        return `${pad(hour)}:${pad(minute)}`;
    };

    const formatDateText = (iso) => {
        const date = parseIsoDate(iso);
        return date ? `${pad(date.d)}/${pad(date.m)}/${date.y + BE}` : '';
    };

    const fire = (element) => {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    let uid = 0;
    const nextId = (prefix) => `${prefix}-${++uid}`;

    // ===================== เชื่อมช่องเดิมกับช่องที่แสดง =====================

    // ตั้งค่า .value จากโค้ดแล้วให้ช่องที่แสดงอัปเดตตาม
    const watchValue = (element, onChange) => {
        ['value', 'selectedIndex'].forEach((prop) => {
            const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), prop);
            if (!desc || !desc.set) return;
            Object.defineProperty(element, prop, {
                configurable: true,
                get() { return desc.get.call(this); },
                set(value) { desc.set.call(this, value); onChange(); },
            });
        });
        if (element.form) element.form.addEventListener('reset', () => setTimeout(onChange));
    };

    // ห่อช่องเดิม ซ่อนไว้ และให้ label / focus() ไปที่ช่องใหม่
    const wrapNative = (element, kind, proxy) => {
        const wrap = document.createElement('div');
        wrap.className = `picker picker--${kind}`;
        element.parentNode.insertBefore(wrap, element);
        wrap.appendChild(element);
        element.classList.add('picker-native');
        element.tabIndex = -1;
        element.setAttribute('aria-hidden', 'true');
        element.dataset.enhanced = '1';
        wrap.insertBefore(proxy, element);

        if (element.id) {
            document.querySelectorAll(`label[for="${CSS.escape(element.id)}"]`).forEach((label) => {
                if (!label.id) label.id = nextId('label');
                proxy.setAttribute('aria-labelledby', label.id);
                label.addEventListener('click', (event) => {
                    event.preventDefault();
                    element.focus();
                });
            });
        }
        element.focus = (options) => proxy.focus(options);

        const syncDisabled = () => {
            wrap.querySelectorAll('input:not(.picker-native), button').forEach((control) => {
                control.disabled = element.disabled;
            });
            wrap.classList.toggle('is-disabled', element.disabled);
        };
        new MutationObserver(syncDisabled).observe(element, { attributes: true, attributeFilter: ['disabled'] });
        syncDisabled();
        return wrap;
    };

    // ชื่อช่อง (label) ต้องอยู่ที่ช่องพิมพ์ ไม่ใช่กล่องที่ห่อ
    const moveLabel = (group, text) => {
        const labelledBy = group.getAttribute('aria-labelledby');
        if (!labelledBy) return;
        text.setAttribute('aria-labelledby', labelledBy);
        group.removeAttribute('aria-labelledby');
    };

    const iconButton = (name, label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'picker-icon';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = icon(name, 18);
        return button;
    };

    // ===================== กล่องลอย (ใช้ร่วมกันทุกตัวเลือก มีได้ทีละกล่อง) =====================

    let current = null;

    const positionPopover = () => {
        if (!current) return;
        const { pop, anchor } = current;
        const rect = anchor.getBoundingClientRect();
        const gap = 6;
        const margin = 8;
        if (current.matchWidth) pop.style.minWidth = `${Math.min(rect.width, window.innerWidth - margin * 2)}px`;
        const width = pop.offsetWidth;
        const height = pop.offsetHeight;
        let top = rect.bottom + gap;
        if (top + height > window.innerHeight - margin) {
            const above = rect.top - gap - height;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
        }
        const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
        pop.style.top = `${top}px`;
        pop.style.left = `${left}px`;
    };

    const closePopover = ({ restoreFocus = false } = {}) => {
        if (!current) return;
        const { pop, onClose, focusTarget } = current;
        current = null;
        pop.remove();
        if (onClose) onClose();
        if (restoreFocus && focusTarget) focusTarget.focus();
    };

    const openPopover = ({ anchor, pop, onClose, focusTarget, matchWidth = false }) => {
        closePopover();
        pop.classList.add('picker-pop');
        (anchor.closest('dialog[open]') || document.body).appendChild(pop);
        current = { anchor, pop, onClose, focusTarget, matchWidth };
        positionPopover();
    };

    document.addEventListener('pointerdown', (event) => {
        if (!current) return;
        if (current.pop.contains(event.target) || current.anchor.contains(event.target)) return;
        closePopover();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (current && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePopover({ restoreFocus: true });
        }
    }, true);

    window.addEventListener('resize', positionPopover);
    window.addEventListener('scroll', (event) => {
        if (current && !current.pop.contains(event.target)) positionPopover();
    }, true);

    const navButton = (action, label, dir) => `<button type="button" class="picker-nav" data-action="${action}" aria-label="${label}">${dir === 'prev'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'}</button>`;

    // ===================== ปฏิทิน (ใช้กับวันที่ และโหมดเลือกเดือน) =====================

    // options: { value, min, max, mode: 'days'|'months', monthOnly, onPick(iso), onClear, focusTarget }
    const openCalendar = (anchor, options) => {
        const pop = document.createElement('div');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', options.monthOnly ? 'เลือกเดือน' : 'เลือกวันที่');
        pop.classList.add('picker-calendar');

        const now = today();
        const selected = options.monthOnly ? parseIsoMonth(options.value) : parseIsoDate(options.value);
        let focus = selected ? { y: selected.y, m: selected.m, d: selected.d || 1 } : { ...now };
        let mode = options.monthOnly ? 'months' : 'days';

        const inRange = (iso) => (!options.min || iso >= options.min) && (!options.max || iso <= options.max);

        const renderDays = () => {
            const first = weekdayOf(focus.y, focus.m, 1);
            const start = addDays({ y: focus.y, m: focus.m, d: 1 }, -first);
            const cells = [];
            for (let i = 0; i < 42; i += 1) {
                const day = addDays(start, i);
                const iso = isoDate(day.y, day.m, day.d);
                const classes = ['picker-day'];
                if (day.m !== focus.m) classes.push('is-outside');
                if (now && iso === isoDate(now.y, now.m, now.d)) classes.push('is-today');
                if (options.value === iso) classes.push('is-selected');
                const weekday = i % 7;
                if (weekday === 0 || weekday === 6) classes.push('is-weekend');
                const isFocus = day.y === focus.y && day.m === focus.m && day.d === focus.d;
                const label = `${day.d} ${MONTHS[day.m - 1]} ${day.y + BE}`;
                cells.push(`<button type="button" class="${classes.join(' ')}" data-date="${iso}" tabindex="${isFocus ? 0 : -1}"
                    aria-label="${label}"${options.value === iso ? ' aria-pressed="true"' : ''}${inRange(iso) ? '' : ' disabled'}>${day.d}</button>`);
            }
            // แสดง 5 แถวถ้าพอ จะได้ไม่มีแถวว่างของเดือนถัดไปทั้งแถว
            const rows = first + daysInMonth(focus.y, focus.m) > 35 ? 42 : 35;
            pop.innerHTML = `
                <div class="picker-head">
                    ${navButton('prev-month', 'เดือนก่อน', 'prev')}
                    <button type="button" class="picker-title" data-action="to-months" aria-label="เลือกเดือนและปี">${MONTHS[focus.m - 1]} ${focus.y + BE}</button>
                    ${navButton('next-month', 'เดือนถัดไป', 'next')}
                </div>
                <div class="picker-weekdays" aria-hidden="true">${WEEKDAYS.map((w, i) => `<span class="${i === 0 || i === 6 ? 'is-weekend' : ''}">${w}</span>`).join('')}</div>
                <div class="picker-days">${cells.slice(0, rows).join('')}</div>
                <div class="picker-foot">
                    <button type="button" class="picker-link muted" data-action="clear">ล้าง</button>
                    <button type="button" class="picker-link" data-action="today">วันนี้</button>
                </div>`;
        };

        const renderMonths = () => {
            const value = options.monthOnly ? options.value : (options.value || '').slice(0, 7);
            const cells = MONTHS_SHORT.map((name, index) => {
                const m = index + 1;
                const key = `${focus.y}-${pad(m)}`;
                const classes = ['picker-month'];
                if (key === value) classes.push('is-selected');
                if (now && now.y === focus.y && now.m === m) classes.push('is-today');
                const disabled = options.monthOnly && ((options.min && key < options.min.slice(0, 7)) || (options.max && key > options.max.slice(0, 7)));
                return `<button type="button" class="${classes.join(' ')}" data-month="${m}" tabindex="${m === focus.m ? 0 : -1}"
                    aria-label="${MONTHS[index]} ${focus.y + BE}"${key === value ? ' aria-pressed="true"' : ''}${disabled ? ' disabled' : ''}>${name}</button>`;
            }).join('');
            pop.innerHTML = `
                <div class="picker-head">
                    ${navButton('prev-year', 'ปีก่อน', 'prev')}
                    <span class="picker-title is-static">${focus.y + BE}</span>
                    ${navButton('next-year', 'ปีถัดไป', 'next')}
                </div>
                <div class="picker-months">${cells}</div>
                ${options.monthOnly ? `<div class="picker-foot is-end">
                    <button type="button" class="picker-link" data-action="this-month">เดือนนี้</button>
                </div>` : ''}`;
        };

        const render = (focusCell = false) => {
            if (mode === 'days') renderDays();
            else renderMonths();
            if (focusCell) {
                const cell = pop.querySelector(mode === 'days' ? '.picker-day[tabindex="0"]' : '.picker-month[tabindex="0"]');
                if (cell) cell.focus();
            }
            positionPopover();
        };

        pop.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button || button.disabled) return;
            if (button.dataset.date) {
                options.onPick(button.dataset.date);
                closePopover({ restoreFocus: true });
                return;
            }
            if (button.dataset.month) {
                focus = { y: focus.y, m: Number(button.dataset.month), d: 1 };
                if (options.monthOnly) {
                    options.onPick(`${focus.y}-${pad(focus.m)}`);
                    closePopover({ restoreFocus: true });
                    return;
                }
                mode = 'days';
                render(true);
                return;
            }
            const action = button.dataset.action;
            if (action === 'prev-month') focus = addMonths(focus, -1);
            if (action === 'next-month') focus = addMonths(focus, 1);
            if (action === 'prev-year') focus = addMonths(focus, -12);
            if (action === 'next-year') focus = addMonths(focus, 12);
            if (action === 'to-months') mode = 'months';
            if (action === 'today') {
                options.onPick(isoDate(now.y, now.m, now.d));
                closePopover({ restoreFocus: true });
                return;
            }
            if (action === 'this-month') {
                options.onPick(`${now.y}-${pad(now.m)}`);
                closePopover({ restoreFocus: true });
                return;
            }
            if (action === 'clear') {
                options.onPick('');
                closePopover({ restoreFocus: true });
                return;
            }
            render(false);
        });

        // ใช้แป้นลูกศรเลื่อนวัน, PageUp/PageDown เลื่อนเดือน (Shift = ปี)
        pop.addEventListener('keydown', (event) => {
            const onDay = event.target.classList.contains('picker-day');
            const onMonth = event.target.classList.contains('picker-month');
            if (!onDay && !onMonth) return;
            const step = onDay
                ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
                : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[event.key];
            if (step !== undefined) {
                focus = onDay ? addDays(focus, step) : addMonths(focus, step);
            } else if (event.key === 'PageUp' || event.key === 'PageDown') {
                const dir = event.key === 'PageUp' ? -1 : 1;
                focus = addMonths(focus, dir * (event.shiftKey || onMonth ? 12 : 1));
            } else if (onDay && (event.key === 'Home' || event.key === 'End')) {
                const weekday = weekdayOf(focus.y, focus.m, focus.d);
                focus = addDays(focus, event.key === 'Home' ? -weekday : 6 - weekday);
            } else {
                return;
            }
            event.preventDefault();
            render(true);
        });

        openPopover({ anchor, pop, focusTarget: options.focusTarget });
        render(Boolean(options.focusGrid));
    };

    // ===================== ช่องวันที่ =====================

    const enhanceDate = (input) => {
        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'picker-text';
        text.inputMode = 'numeric';
        text.autocomplete = 'off';
        text.placeholder = 'วว/ดด/ปปปป';
        const button = iconButton('calendar', 'เลือกจากปฏิทิน');
        const group = document.createElement('div');
        group.className = 'picker-field';
        group.append(text, button);
        wrapNative(input, 'date', group);
        input.focus = (options) => text.focus(options);
        moveLabel(group, text);

        const show = () => {
            text.value = formatDateText(input.value);
            text.removeAttribute('aria-invalid');
        };
        const setValue = (iso) => {
            if (input.value === iso) {
                show();
                return;
            }
            input.value = iso;
            fire(input);
        };
        const commit = () => {
            if (text.value === formatDateText(input.value)) return;
            const iso = parseDateText(text.value);
            if (iso === null || (iso && ((input.min && iso < input.min) || (input.max && iso > input.max)))) {
                text.setAttribute('aria-invalid', 'true');
                text.title = 'รูปแบบวันที่ไม่ถูกต้อง ใช้ วว/ดด/ปปปป เช่น 17/11/2569';
                return;
            }
            text.title = '';
            setValue(iso);
        };
        const open = (focusGrid) => openCalendar(group, {
            value: input.value,
            min: input.min,
            max: input.max,
            focusGrid,
            focusTarget: text,
            onPick: setValue,
        });

        watchValue(input, show);
        show();
        text.addEventListener('blur', commit);
        text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commit();
            } else if (event.key === 'ArrowDown' || (event.altKey && event.key === 'ArrowDown')) {
                event.preventDefault();
                commit();
                open(true);
            }
        });
        button.addEventListener('click', () => {
            if (current && current.anchor === group) {
                closePopover();
                return;
            }
            commit();
            open(true);
        });
    };

    // ===================== ช่องเดือน =====================

    const enhanceMonth = (input) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'picker-select';
        button.setAttribute('aria-haspopup', 'dialog');
        button.innerHTML = `<span class="picker-select-label"></span>${icon('calendar', 18)}`;
        wrapNative(input, 'month', button);
        const labelSpan = button.querySelector('.picker-select-label');
        labelSpan.id = nextId('value');
        const labelledBy = button.getAttribute('aria-labelledby');
        if (labelledBy) button.setAttribute('aria-labelledby', `${labelledBy} ${labelSpan.id}`);

        const show = () => {
            const value = parseIsoMonth(input.value);
            labelSpan.textContent = value ? `${MONTHS[value.m - 1]} ${value.y + BE}` : 'เลือกเดือน';
            button.classList.toggle('is-placeholder', !value);
        };
        watchValue(input, show);
        show();

        const open = () => openCalendar(button, {
            value: input.value,
            min: input.min,
            max: input.max,
            monthOnly: true,
            focusGrid: true,
            focusTarget: button,
            onPick: (value) => {
                if (input.value === value) return;
                input.value = value;
                fire(input);
            },
        });
        button.addEventListener('click', () => {
            if (current && current.anchor === button) closePopover();
            else open();
        });
        button.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                open();
            }
        });
    };

    // ===================== ช่องเวลา (24 ชั่วโมง) =====================

    const enhanceTime = (input) => {
        const text = document.createElement('input');
        text.type = 'text';
        text.className = 'picker-text';
        text.inputMode = 'numeric';
        text.autocomplete = 'off';
        text.placeholder = '--:--';
        const button = iconButton('clock', 'เลือกเวลา');
        const group = document.createElement('div');
        group.className = 'picker-field';
        group.append(text, button);
        wrapNative(input, 'time', group);
        input.focus = (options) => text.focus(options);
        moveLabel(group, text);

        const show = () => {
            text.value = (input.value || '').slice(0, 5);
            text.removeAttribute('aria-invalid');
        };
        const setValue = (value) => {
            if ((input.value || '').slice(0, 5) === value) {
                show();
                return;
            }
            input.value = value;
            fire(input);
        };
        const commit = () => {
            if (text.value === (input.value || '').slice(0, 5)) return;
            const value = parseTimeText(text.value);
            if (value === null) {
                text.setAttribute('aria-invalid', 'true');
                text.title = 'รูปแบบเวลาไม่ถูกต้อง ใช้ ชช:นน เช่น 08:30';
                return;
            }
            text.title = '';
            setValue(value);
        };

        const open = () => {
            const pop = document.createElement('div');
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', 'เลือกเวลา');
            pop.classList.add('picker-time');
            const [h, m] = (input.value || '').split(':');
            const minutes = [];
            for (let i = 0; i < 60; i += 5) minutes.push(pad(i));
            if (m && !minutes.includes(m)) minutes.push(m);
            minutes.sort();
            const column = (name, label, values, selectedValue) => `
                <div class="picker-time-col">
                    <div class="picker-time-label">${label}</div>
                    <div class="picker-time-list" role="listbox" aria-label="${label}" data-col="${name}">
                        ${values.map((value) => `<button type="button" role="option" data-${name}="${value}" class="${value === selectedValue ? 'is-selected' : ''}" aria-selected="${value === selectedValue}">${value}</button>`).join('')}
                    </div>
                </div>`;
            const hours = Array.from({ length: 24 }, (_, i) => pad(i));
            pop.innerHTML = `
                <div class="picker-time-cols">${column('hour', 'ชั่วโมง', hours, h)}${column('minute', 'นาที', minutes, m)}</div>
                <div class="picker-foot">
                    <button type="button" class="picker-link muted" data-action="clear">ล้าง</button>
                    <button type="button" class="picker-link" data-action="now">ตอนนี้</button>
                </div>`;

            pop.addEventListener('click', (event) => {
                const target = event.target.closest('button');
                if (!target) return;
                const [curH = '', curM = ''] = (input.value || '').split(':');
                if (target.dataset.hour) {
                    setValue(`${target.dataset.hour}:${curM || '00'}`);
                    pop.querySelectorAll('[data-hour]').forEach((b) => {
                        b.classList.toggle('is-selected', b === target);
                        b.setAttribute('aria-selected', String(b === target));
                    });
                    return;
                }
                if (target.dataset.minute) {
                    setValue(`${curH || '00'}:${target.dataset.minute}`);
                    closePopover({ restoreFocus: true });
                    return;
                }
                if (target.dataset.action === 'now') {
                    const date = new Date();
                    setValue(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
                    closePopover({ restoreFocus: true });
                }
                if (target.dataset.action === 'clear') {
                    setValue('');
                    closePopover({ restoreFocus: true });
                }
            });
            pop.addEventListener('keydown', (event) => {
                if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                const list = event.target.closest('.picker-time-list');
                if (!list) return;
                const buttons = Array.from(list.querySelectorAll('button'));
                const index = buttons.indexOf(event.target);
                const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))];
                event.preventDefault();
                if (next) next.focus();
            });

            openPopover({ anchor: group, pop, focusTarget: text });
            pop.querySelectorAll('.picker-time-list').forEach((list) => {
                const selected = list.querySelector('.is-selected') || list.querySelector(list.dataset.col === 'hour' ? '[data-hour="08"]' : 'button');
                if (selected) list.scrollTop = selected.offsetTop - list.clientHeight / 2 + selected.offsetHeight / 2;
            });
            const first = pop.querySelector('[data-hour].is-selected') || pop.querySelector('[data-hour="08"]');
            if (first) first.focus({ preventScroll: true });
        };

        watchValue(input, show);
        show();
        text.addEventListener('blur', commit);
        text.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commit();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                commit();
                open();
            }
        });
        button.addEventListener('click', () => {
            if (current && current.anchor === group) {
                closePopover();
                return;
            }
            commit();
            open();
        });
    };

    // ===================== รายการตัวเลือก (ใช้กับ select และ datalist) =====================

    // options: { items: [{value, label, disabled}], activeValue, search, onPick(item), focusTarget, anchor }
    const openListbox = ({ anchor, items, activeValue, search, onPick, focusTarget, inputForKeys }) => {
        const pop = document.createElement('div');
        pop.classList.add('picker-listbox');
        const listId = nextId('listbox');
        pop.innerHTML = `${search ? `<div class="picker-search">${icon('search', 16)}<input type="text" autocomplete="off" placeholder="พิมพ์เพื่อค้นหา" aria-label="ค้นหา" aria-controls="${listId}" aria-autocomplete="list" role="combobox" aria-expanded="true"></div>` : ''}
            <ul role="listbox" id="${listId}" tabindex="-1"></ul>`;
        const list = pop.querySelector('ul');
        const searchInput = pop.querySelector('.picker-search input');
        const keyTarget = searchInput || inputForKeys || list;
        let visible = items;
        // ช่องพิมพ์ที่มีคำแนะนำ: ยังไม่เลือกรายการใดจนกว่าจะกดลูกศร (กด Enter แล้วไม่ทับข้อความที่พิมพ์)
        let active = items.findIndex((item) => item.value === activeValue);
        if (active < 0 && !inputForKeys) active = 0;

        const renderList = () => {
            if (visible.length === 0) {
                list.innerHTML = '<li class="picker-empty">ไม่พบรายการ</li>';
                return;
            }
            list.innerHTML = visible.map((item, index) => `<li role="option" id="${listId}-${index}" data-index="${index}"
                class="${index === active ? 'is-active' : ''} ${item.value === activeValue ? 'is-selected' : ''}"
                aria-selected="${item.value === activeValue}"${item.disabled ? ' aria-disabled="true"' : ''}>${escapeHtml(item.label)}</li>`).join('');
            setActive(active, false);
        };

        const setActive = (index, scroll = true) => {
            list.querySelectorAll('.is-active').forEach((li) => li.classList.remove('is-active'));
            if (visible.length === 0 || index < 0) {
                active = -1;
                keyTarget.removeAttribute('aria-activedescendant');
                return;
            }
            active = Math.min(visible.length - 1, index);
            const li = list.querySelector(`[data-index="${active}"]`);
            if (!li) return;
            li.classList.add('is-active');
            keyTarget.setAttribute('aria-activedescendant', li.id);
            if (scroll) li.scrollIntoView({ block: 'nearest' });
        };

        const choose = (index) => {
            const item = visible[index];
            if (!item || item.disabled) return;
            closePopover({ restoreFocus: true });
            onPick(item);
        };

        const filter = (query) => {
            const q = query.trim().toLowerCase();
            visible = q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items;
            active = 0;
            renderList();
            positionPopover();
        };

        list.addEventListener('mousedown', (event) => event.preventDefault()); // ไม่ให้ช่องค้นหาเสีย focus
        list.addEventListener('click', (event) => {
            const li = event.target.closest('li[data-index]');
            if (li) choose(Number(li.dataset.index));
        });
        list.addEventListener('mousemove', (event) => {
            const li = event.target.closest('li[data-index]');
            if (li && Number(li.dataset.index) !== active) setActive(Number(li.dataset.index), false);
        });

        let typed = '';
        let typedTimer = null;
        const onKey = (event) => {
            const pageSize = 8;
            const moves = {
                ArrowDown: active + 1, ArrowUp: Math.max(0, active - 1), Home: 0, End: visible.length - 1, PageDown: active + pageSize, PageUp: active - pageSize,
            };
            if (event.key in moves && !(searchInput && (event.key === 'Home' || event.key === 'End'))) {
                event.preventDefault();
                setActive(moves[event.key]);
            } else if (event.key === 'Enter') {
                if (active < 0) {
                    closePopover();
                    return;
                }
                event.preventDefault();
                choose(active);
            } else if (event.key === 'Tab') {
                closePopover();
            } else if (!searchInput && !inputForKeys && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
                // พิมพ์ตัวอักษรเพื่อกระโดดไปรายการที่ขึ้นต้นด้วยคำนั้น
                typed += event.key.toLowerCase();
                clearTimeout(typedTimer);
                typedTimer = setTimeout(() => { typed = ''; }, 700);
                const found = visible.findIndex((item) => item.label.toLowerCase().startsWith(typed));
                if (found >= 0) setActive(found);
            }
        };
        keyTarget.addEventListener('keydown', onKey);
        if (searchInput) searchInput.addEventListener('input', () => filter(searchInput.value));

        openPopover({
            anchor,
            pop,
            focusTarget,
            matchWidth: true,
            onClose: () => {
                if (inputForKeys) {
                    inputForKeys.removeEventListener('keydown', onKey);
                    inputForKeys.removeAttribute('aria-activedescendant');
                }
            },
        });
        renderList();
        positionPopover();
        setActive(active);
        if (!inputForKeys) (searchInput || list).focus({ preventScroll: true });
        return { filter, hasItems: () => visible.length > 0 };
    };

    // ===================== ดรอปดาวน์ (select) =====================

    const SEARCH_THRESHOLD = 8;

    const enhanceSelect = (select) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'picker-select';
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = `<span class="picker-select-label"></span><svg class="picker-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
        wrapNative(select, 'select', button);
        const labelSpan = button.querySelector('.picker-select-label');
        // ให้โปรแกรมอ่านหน้าจออ่านทั้งชื่อช่องและค่าที่เลือก
        labelSpan.id = nextId('value');
        const labelledBy = button.getAttribute('aria-labelledby');
        if (labelledBy) button.setAttribute('aria-labelledby', `${labelledBy} ${labelSpan.id}`);

        const show = () => {
            const option = select.options[select.selectedIndex];
            labelSpan.textContent = option ? option.textContent : '';
            button.title = labelSpan.textContent;
        };
        watchValue(select, show);
        new MutationObserver(show).observe(select, { childList: true, subtree: true, characterData: true });
        show();

        const open = () => {
            const items = Array.from(select.options)
                .filter((option) => !option.hidden)
                .map((option) => ({ value: option.value, label: option.textContent, disabled: option.disabled }));
            button.setAttribute('aria-expanded', 'true');
            button.classList.add('is-open');
            openListbox({
                anchor: button,
                items,
                activeValue: select.value,
                search: items.length > SEARCH_THRESHOLD,
                focusTarget: button,
                onPick: (item) => {
                    if (select.value === item.value) return;
                    select.value = item.value;
                    fire(select);
                },
            });
            current.onClose = () => {
                button.setAttribute('aria-expanded', 'false');
                button.classList.remove('is-open');
            };
        };

        button.addEventListener('click', () => {
            if (current && current.anchor === button) closePopover();
            else open();
        });
        button.addEventListener('keydown', (event) => {
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                open();
            }
        });
    };

    // ===================== ช่องพิมพ์ที่มีคำแนะนำ (datalist) =====================

    const enhanceDatalist = (input) => {
        const listId = input.getAttribute('list');
        input.removeAttribute('list');
        input.dataset.enhanced = '1';
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');

        const suggestions = () => {
            const datalist = document.getElementById(listId);
            if (!datalist) return [];
            const q = input.value.trim().toLowerCase();
            return Array.from(datalist.options)
                .map((option) => option.value)
                .filter((value) => value && (!q || value.toLowerCase().includes(q)) && value !== input.value.trim())
                .map((value) => ({ value, label: value }));
        };

        const open = () => {
            const items = suggestions();
            if (current && current.anchor === input) closePopover();
            if (items.length === 0) return;
            input.setAttribute('aria-expanded', 'true');
            openListbox({
                anchor: input,
                items,
                activeValue: null,
                inputForKeys: input,
                onPick: (item) => {
                    input.value = item.value;
                    fire(input);
                },
            });
            const prevClose = current.onClose;
            current.onClose = () => {
                if (prevClose) prevClose();
                input.setAttribute('aria-expanded', 'false');
            };
        };

        input.addEventListener('input', (event) => {
            if (event.isTrusted) open();
        });
        input.addEventListener('focus', open);
        input.addEventListener('click', () => {
            if (!current || current.anchor !== input) open();
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' && (!current || current.anchor !== input)) {
                event.preventDefault();
                open();
            }
        });
        input.addEventListener('blur', () => setTimeout(() => {
            if (current && current.anchor === input && !current.pop.contains(document.activeElement)) closePopover();
        }, 150));
    };

    // ===================== เริ่มทำงาน: ห่อทุกช่องในหน้า และช่องที่เพิ่มเข้ามาภายหลัง =====================

    const SELECTOR = 'input[type="date"], input[type="month"], input[type="time"], select:not([multiple]):not([size]), input[list]';

    const enhance = (element) => {
        if (element.dataset.enhanced || element.dataset.native !== undefined) return;
        element.dataset.enhanced = '1';
        if (element.tagName === 'SELECT') enhanceSelect(element);
        else if (element.hasAttribute('list')) enhanceDatalist(element);
        else if (element.type === 'date') enhanceDate(element);
        else if (element.type === 'month') enhanceMonth(element);
        else if (element.type === 'time') enhanceTime(element);
    };

    const enhanceWithin = (root) => {
        if (root.nodeType !== 1) return;
        if (root.matches(SELECTOR)) enhance(root);
        root.querySelectorAll(SELECTOR).forEach(enhance);
    };

    const start = () => {
        enhanceWithin(document.body);
        new MutationObserver((mutations) => {
            mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && !node.classList.contains('picker-pop')) enhanceWithin(node);
            }));
        }).observe(document.body, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
