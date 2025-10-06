const CSV_FILE = 'schedule.csv';

let scheduleData = [];
let groups = new Set();
let teachers = new Set();

let groupColumns = {}; // { colIndex: { group, timeIdx } }
let currentDay = '';
let currentLessonNum = '1';

async function loadCSV() {
    try {
        const response = await fetch(CSV_FILE + '?t=' + Date.now());
        if (!response.ok) throw new Error('Файл не найден');

        const text = await response.text();
        const lines = text
            .split('\n')
            .map(line => line.trim().replace(/\r$/, '').split(';'))
            .filter(row => row.length > 1);

        // === 1. Извлечение дат ===
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].join('');
            if (line.includes('РАСПИСАНИЕ ЗАНЯТИЙ') && line.includes('по')) {
                const match = line.match(/с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})/);
                if (match) {
                    document.getElementById('dateHeader').textContent = `${match[1]} – ${match[2]}`;
                }
                break;
            }
        }

        // === 2. Поиск заголовков групп ===
        let headers = null;
        let dataStartRow = -1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i][0]?.includes('ДНИ НЕДЕЛИ')) {
                headers = lines[i];
                dataStartRow = i + 1;
                break;
            }
        }

        if (!headers || !dataStartRow) {
            throw new Error('Не найдены заголовки');
        }

        headers.forEach((cell, idx) => {
            if ((cell.includes('Группа №') || cell.includes('Группа ')) && idx >= 2) {
                const match = cell.match(/Группа\s+№?\s*([^\s";]+(?:\s+[^\s"]+)*)/i);
                if (match) {
                    const groupName = match[1].trim().replace(/"/g, '');
                    groups.add(groupName);

                    groupColumns[idx] = {
                        group: groupName,
                        timeIdx: idx - 1
                    };
                }
            }
        });

        // === 3. Чтение данных ===
        const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

        for (let i = dataStartRow; i < lines.length; i++) {
            const row = lines[i];
            const firstCell = (row[0] || '').toLowerCase().trim();

            // Определение дня недели
            if (daysOrder.some(day => firstCell.includes(day))) {
                currentDay = firstCell.split(' ')[0];
                // ❗ ИСПРАВЛЕНИЕ: Убран 'continue', чтобы обработать данные 1-го урока на этой же строке
            }

            // Получаем номер урока
            const lessonNumRaw = row[1] ? row[1].trim() : '';
            if (lessonNumRaw) {
                currentLessonNum = lessonNumRaw;
            }

            // Определяем пару: 1→1.2, 3→3.4 и т.д.
            const pair = getPairNumber(currentLessonNum);
            if (!pair || !currentDay) continue;

            // Обрабатываем каждую группу
            Object.keys(groupColumns).forEach(colIdxStr => {
                const colIdx = parseInt(colIdxStr);
                const info = groupColumns[colIdx];
                const subjectCell = (row[colIdx] || '').trim();

                if (subjectCell && !subjectCell.includes('Классный час')) {
                    // Поиск преподавателей
                    const teacherMatches = [...subjectCell.matchAll(/([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.[А-ЯЁ]\.)/g)];
                    const foundTeachers = [];

                    let mainSubject = subjectCell;
                    teacherMatches.forEach(match => {
                        const fullName = `${match[1]} ${match[2]}`;
                        foundTeachers.push(fullName);
                        mainSubject = mainSubject.replace(new RegExp(`\\s*${fullName}\\s*`, 'g'), '').trim();
                    });

                    const room = row[colIdx + 1] ? row[colIdx + 1].trim() : '—';

                    // Проверяем, есть ли уже такая пара (чтобы не дублировать урок 1 и 2)
                    const existing = scheduleData.find(item => item.day === currentDay && item.group === info.group && item.pair === pair);
                    if (!existing) {
                        scheduleData.push({
                            day: currentDay,
                            pair: pair,
                            subject: mainSubject || '—',
                            room: room,
                            group: info.group,
                            allTeachers: foundTeachers
                        });

                        foundTeachers.forEach(t => teachers.add(t));
                    }
                }
            });
        }

        // Заполнение выпадающих списков
        fillSelect('groupSelect', groups, 'Группа ');
        fillSelect('teacherSelect', teachers, '');

        document.getElementById('teacherSection').style.display = 'none';

    } catch (error) {
        console.error('Ошибка:', error);
        alert('Не удалось загрузить расписание. Проверьте, что файл schedule.csv находится в той же папке.');
    }
}

function getPairNumber(num) {
    const n = parseInt(num);
    if (isNaN(n)) return null;
    if (n <= 2) return '1.2';
    if (n <= 4) return '3.4';
    if (n <= 6) return '5.6';
    if (n <= 8) return '7.8';
    return null;
}

function fillSelect(id, items, prefix) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">-- Выберите --</option>';
    Array.from(items)
        .sort()
        .forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = prefix + item;
            select.appendChild(option);
        });
}

let currentView = 'group';

function switchView(view) {
    currentView = view;
    document.getElementById('groupSection').style.display = view === 'group' ? 'block' : 'none';
    document.getElementById('teacherSection').style.display = view === 'teacher' ? 'block' : 'none';
    document.getElementById('schedule').style.display = 'none';

    document.getElementById('tabGroup').classList.toggle('active', view === 'group');
    document.getElementById('tabTeacher').classList.toggle('active', view === 'teacher');
}

function loadSchedule() {
    const group = document.getElementById('groupSelect').value;
    const teacher = document.getElementById('teacherSelect').value;

    if (currentView === 'group' && !group) {
         document.getElementById('schedule').style.display = 'none';
         return;
    }
    if (currentView === 'teacher' && !teacher) {
        document.getElementById('schedule').style.display = 'none';
        return;
    }


    const filtered = currentView === 'group' ?
        scheduleData.filter(l => l.group === group) :
        scheduleData.filter(l => l.allTeachers && l.allTeachers.includes(teacher));

    const resultTitle = document.getElementById('resultTitle');
    if (currentView === 'group') {
        resultTitle.textContent = `Группа ${group}`;
    } else {
        const teacherGroups = [...new Set(filtered.map(l => l.group))].sort().join(', ');
        resultTitle.innerHTML = `
        Преподаватель: ${teacher}<br>
        <small style="font-size:0.8em; color: #555;">Группы: ${teacherGroups}</small>
        `;
    }

    const content = document.getElementById('scheduleContent');
    content.innerHTML = '';

    const daysMap = {
        'понедельник': 'Понедельник',
        'вторник': 'Вторник',
        'среда': 'Среда',
        'четверг': 'Четверг',
        'пятница': 'Пятница',
        'суббота': 'Суббота'
    };

    const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    let hasLessons = false;

    daysOrder.forEach(dayKey => {
        const dayLessons = filtered.filter(l => l.day === dayKey);
        if (dayLessons.length > 0) {
            hasLessons = true;
            const dayEl = document.createElement('div');
            dayEl.className = 'day';

            const title = document.createElement('h3');
            title.textContent = daysMap[dayKey];
            dayEl.appendChild(title);

            const sorted = dayLessons.sort((a, b) => parseFloat(a.pair) - parseFloat(b.pair));

            sorted.forEach(lesson => {
                const lessonEl = document.createElement('div');
                lessonEl.className = 'lesson';

                if (currentView === 'group') {
                    lessonEl.innerHTML = `
                        <span><strong>${lesson.pair}.</strong> ${lesson.subject}</span><br>
                        <em>Преподаватель: ${lesson.allTeachers.join(', ') || 'не указан'}</em><br>
                        <em>Аудитория: ${lesson.room}</em>
                    `;
                } else {
                    lessonEl.innerHTML = `
                        <span><strong>${lesson.pair}.</strong> ${lesson.subject}</span><br>
                        <strong>Группа:</strong> ${lesson.group}<br>
                        <em>Аудитория: ${lesson.room}</em>
                    `;
                }
                dayEl.appendChild(lessonEl);
            });

            content.appendChild(dayEl);
        }
    });

    if (!hasLessons) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Занятий нет.';
        content.appendChild(empty);
    }

    document.getElementById('schedule').style.display = 'block';
}

window.onload = loadCSV;