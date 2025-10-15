// ❗ Файл должен называться schedule.xls и лежать рядом с index.html
const XLS_FILE = 'schedule.xls';

// Глобальные переменные
let scheduleData = [];
let groups = new Set();
let teachers = new Set();
let groupColumns = {};

/**
 * Основная функция для загрузки и парсинга XLS-файла с сервера
 */
async function loadXLS() {
    try {
        const response = await fetch(XLS_FILE + '?t=' + Date.now());
        if (!response.ok) throw new Error(`Не удалось найти или загрузить файл расписания (${XLS_FILE}). Убедитесь, что вы запустили его через PyCharm (Go Live).`);

        const arrayBuffer = await response.arrayBuffer();

        const workbook = XLSX.read(arrayBuffer);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: "" });

        const lines = worksheet;

        // === 1. Извлечение дат ===
        for (const row of lines) {
            const lineStr = String(row.join(';'));
            if (lineStr.includes('РАСПИСАНИЕ ЗАНЯТИЙ')) {
                const match = lineStr.match(/с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})/);
                if (match) {
                    document.getElementById('dateHeader').textContent = `Период: ${match[1]} – ${match[2]}`;
                }
                break;
            }
        }

        // === 2. Поиск заголовков групп ===
        let headers = null;
        let dataStartRow = -1;
        for (let i = 0; i < lines.length; i++) {
            if (String(lines[i][0]).includes('ДНИ НЕДЕЛИ')) {
                headers = lines[i];
                dataStartRow = i + 1;
                break;
            }
        }

        if (!headers || dataStartRow === -1) {
            throw new Error('Не удалось найти строку с заголовками "ДНИ НЕДЕЛИ".');
        }

        headers.forEach((cell, idx) => {
            const cleanCell = String(cell).trim().replace(/"/g, '');
            if (cleanCell.toLowerCase().startsWith('группа')) {
                const groupName = cleanCell.replace(/Группа\s+№?\s*/i, '').trim();
                if (groupName) {
                    groups.add(groupName);
                    groupColumns[groupName] = idx;
                }
            }
        });

        // === 3. Чтение данных расписания ===
        parseScheduleData(lines, dataStartRow);

        // Заполнение выпадающих списков
        fillSelect('groupSelect', Array.from(groups).sort());
        fillSelect('teacherSelect', Array.from(teachers).sort());

        // Показываем контролы после загрузки
        document.getElementById('groupSection').style.display = 'block';
        document.getElementById('dateHeader').textContent += " (Данные загружены)";
        switchView('group');

    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        alert(`Произошла ошибка: ${error.message}`);
        document.getElementById('dateHeader').textContent = `Ошибка загрузки: ${error.message}`;
    }
}


function parseScheduleData(lines, startRow) {
    const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    let currentDay = '';
    let lastLessonRowWas8 = false;

    for (let i = startRow; i < lines.length; i++) {
        const row = lines[i];
        const firstCell = String(row[0] || '').toLowerCase().trim();

        if (firstCell.includes('сокращения') || firstCell.includes('рем. раб')) {
            break;
        }

        const foundDay = daysOrder.find(day => firstCell.includes(day));
        if (foundDay) {
            currentDay = foundDay.charAt(0).toUpperCase() + foundDay.slice(1);
            lastLessonRowWas8 = false;
        }

        const lessonNum = String(row[1] || '').trim();
        const n = parseInt(lessonNum);

        let pair = null;

        if (currentDay && !isNaN(n) && n >= 1) {
            pair = getLessonNumber(n);
            lastLessonRowWas8 = (n === 8);
        } else if (currentDay && lastLessonRowWas8) {
            let hasSubject = false;
            for (const colIdx of Object.values(groupColumns)) {
                const subjectRaw = (String(row[colIdx] || '') + ' ' + String(row[colIdx + 1] || '')).trim();
                if (subjectRaw && !subjectRaw.toLowerCase().includes('классный час')) {
                    hasSubject = true;
                    break;
                }
            }

            if (hasSubject) {
                pair = '9-10 урок';
            }
            lastLessonRowWas8 = false;
        }

        if (!pair) continue;

        for (const groupName of Object.keys(groupColumns)) {
            const colIdx = groupColumns[groupName];
            const subjectRaw = (String(row[colIdx] || '') + ' ' + String(row[colIdx + 1] || '')).trim();

            if (!subjectRaw || subjectRaw.toLowerCase().includes('классный час')) continue;

            const lessons = parseSubjectCell(subjectRaw);

            lessons.forEach(lesson => {
                const { subject, teacher, room } = lesson;
                const isDuplicate = subjectRaw.indexOf('/') === -1 && scheduleData.some(item =>
                    item.day === currentDay && item.group === groupName && item.pair === pair
                );

                if (!isDuplicate) {
                    scheduleData.push({
                        day: currentDay, pair: pair, subject: subject || '—', room: room, group: groupName, teacher: teacher || 'Не указан'
                    });
                    if (teacher && teacher !== 'Не указан') teachers.add(teacher);
                }
            });
        }
    }
}

/**
 * Заменено "пара" на "урок"
 */
function getLessonNumber(num) {
    const n = parseInt(num);
    if (isNaN(n)) return null;
    if (n <= 2) return '1-2 урок';
    if (n <= 4) return '3-4 урок';
    if (n <= 6) return '5-6 урок';
    if (n <= 8) return '7-8 урок';
    return null;
}


/**
 * Новая логика parsePart для надежного извлечения Аудитории.
 */
function parseSubjectCell(cellText) {
    const cleanText = cellText.replace(/\s+/g, ' ').trim();
    const rawParts = cleanText.split('/');
    const lessons = [];

    const parsePart = (text) => {
        let subject = text.replace(/\s+/g, ' ').trim();
        let teacher = '';
        let room = '—';
        let match = null;

        // 1. ПОИСК АУДИТОРИИ (в первую очередь, чтобы очистить Subject)

        // 1.1. Поиск по префиксу (каб./ауд./маст.) ИЛИ просто цифра/буква
        const roomPrefixRegex = /(.*)\s*((каб\.|ауд\.|маст\.)\s*(\d{1,3}[а-я]?))$/i;

        // 1.2. Поиск числа >= 3 цифр (например, 207) без префикса
        const roomNumOnlyRegex = /(.*)\s*(\d{3,}[а-я]?)$/i;

        let roomMatch = subject.match(roomPrefixRegex);

        if (roomMatch) {
            // Найден явный префикс
            room = roomMatch[2].trim();
            subject = roomMatch[1].trim();
        } else {
            roomMatch = subject.match(roomNumOnlyRegex);
             if (roomMatch) {
                // Найдено число из 3+ цифр (вероятно, номер аудитории)
                room = roomMatch[2].trim();
                subject = roomMatch[1].trim();
             }
        }

        // 2. ПОИСК ПРЕПОДАВАТЕЛЯ
        const regexTwoInitials = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.?\s*[А-ЯЁ]\.?)/;
        const regexOneInitial = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.?)/;

        let teacherMatch = subject.match(regexTwoInitials);

        if (teacherMatch) {
            match = teacherMatch;
        } else {
            teacherMatch = subject.match(regexOneInitial);
            if (teacherMatch) {
                match = teacherMatch;
            }
        }

        if (match) {
            subject = subject.replace(match[0], '').trim();

            let rawInitials = match[2].trim();
            let surname = match[1];

            rawInitials = rawInitials.replace(/\s+/g, '');
            rawInitials = rawInitials.replace(/([А-ЯЁ])(?!\.)/g, '$1.');

            if (rawInitials.length > 3) {
                 rawInitials = rawInitials.replace(/([А-ЯЁ]\.)([А-ЯЁ]\.)/, '$1 $2');
            }

            teacher = `${surname} ${rawInitials}`;
        }

        // 3. Очистка предмета
        subject = subject.replace(/,$/, '').trim();

        return { subject: subject || '—', teacher: teacher || 'Не указан', room };
    }

    // 4. Обрабатываем каждую часть
    rawParts.forEach(part => {
        const cleanedPart = part.trim();
        if (cleanedPart) {
            lessons.push(parsePart(cleanedPart));
        }
    });

    // 5. Пост-обработка: дублирование предмета
    if (lessons.length > 1) {
        const primarySubject = lessons[0].subject;
        lessons.forEach(lesson => {
            if (lesson.subject === '—' && primarySubject !== '—') {
                lesson.subject = primarySubject;
            }
        });
    }

    if (lessons.length === 0) {
        return [{ subject: '—', teacher: 'Не указан', room: '—' }];
    }

    return lessons;
}

function fillSelect(id, items) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">-- Выберите --</option>';
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    });
}

let currentView = 'group';
function switchView(view) {
    currentView = view;
    if (groups.size > 0) {
        document.getElementById('groupSection').style.display = view === 'group' ? 'block' : 'none';
        document.getElementById('teacherSection').style.display = view === 'teacher' ? 'block' : 'none';
    }
    document.getElementById('schedule').style.display = 'none';
    document.getElementById('tabGroup').classList.toggle('active', view === 'group');
    document.getElementById('tabTeacher').classList.toggle('active', view === 'teacher');
}

function loadSchedule() {
    const group = document.getElementById('groupSelect').value;
    const teacher = document.getElementById('teacherSelect').value;

    if ((currentView === 'group' && !group) || (currentView === 'teacher' && !teacher)) {
        document.getElementById('schedule').style.display = 'none';
        return;
    }

    const filtered = currentView === 'group' ?
        scheduleData.filter(l => l.group === group) :
        scheduleData.filter(l => l.teacher === teacher);

    const resultTitle = document.getElementById('resultTitle');
    if (currentView === 'group') {
        resultTitle.textContent = `Расписание для группы: ${group}`;
    } else {
        const teacherGroups = [...new Set(filtered.map(l => l.group))].sort().join(', ');
        resultTitle.innerHTML = `Расписание для преподавателя: ${teacher}<br><small style="font-size:0.8em; color: #fff;">Группы: ${teacherGroups}</small>`;
    }

    const content = document.getElementById('scheduleContent');
    content.innerHTML = '';

    const daysOrder = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    let hasLessons = false;

    daysOrder.forEach(dayKey => {
        const dayLessons = filtered.filter(l => l.day === dayKey);
        if (dayLessons.length > 0) {
            hasLessons = true;
            const dayEl = document.createElement('div');
            dayEl.className = 'day';
            const title = document.createElement('h3');
            title.textContent = dayKey;
            dayEl.appendChild(title);

            const sorted = dayLessons.sort((a, b) => {
                const numA = parseInt(a.pair.split('-')[0]);
                const numB = parseInt(b.pair.split('-')[0]);
                return numA - numB;
            });

            sorted.forEach(lesson => {
                const lessonEl = document.createElement('div');
                lessonEl.className = 'lesson';
                const teacherInfo = lesson.teacher === 'Не указан' ? '<em>не указан</em>' : lesson.teacher;

                if (currentView === 'group') {
                    lessonEl.innerHTML = `<span class="time">${lesson.pair}:</span> ${lesson.subject}<br><small><strong>Преподаватель:</strong> ${teacherInfo} | <strong>Аудитория:</strong> ${lesson.room}</small>`;
                } else {
                    lessonEl.innerHTML = `<span class="time">${lesson.pair}:</span> ${lesson.subject}<br><small><strong>Группа:</strong> ${lesson.group} | <strong>Аудитория:</strong> ${lesson.room}</small>`;
                }
                dayEl.appendChild(lessonEl);
            });
            content.appendChild(dayEl);
        }
    });

    if (!hasLessons) {
        content.innerHTML = '<p class="empty">Для выбранного варианта занятий нет.</p>';
    }
    document.getElementById('schedule').style.display = 'block';
}

// Запускаем загрузку файла при открытии страницы
window.onload = loadXLS;