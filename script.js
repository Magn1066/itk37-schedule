// ❗ Имя файла теперь .xls
const XLS_FILE = 'schedule.xls';

// Глобальные переменные для хранения данных
let scheduleData = [];
let groups = new Set();
let teachers = new Set();
let groupColumns = {}; // { groupName: colIndex }

/**
 * Основная функция для загрузки и парсинга XLS-файла
 */
async function loadXLS() {
    try {
        const response = await fetch(XLS_FILE + '?t=' + Date.now());
        if (!response.ok) throw new Error('Файл расписания не найден.');
        
        // Читаем файл как бинарный массив
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        
        // Берем первый лист из книги Excel
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Конвертируем данные листа в удобный массив
        const lines = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

        // === 1. Извлечение дат ===
        for (const row of lines) {
            const lineStr = row.join(';');
            if (lineStr.includes('РАСПИСАНИЕ ЗАНЯТИЙ')) {
                const match = lineStr.match(/с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})/);
                if (match) {
                    document.getElementById('dateHeader').textContent = `Период: ${match[1]} – ${match[2]}`;
                    const footer = document.querySelector('.footer');
                    if (footer) footer.textContent = `Актуально на ${match[1]} – ${match[2]}`;
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
        
        // Заполняем информацию о группах и их колонках
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
        fillSelect('groupSelect', Array.from(groups).sort(), 'Группа ');
        fillSelect('teacherSelect', Array.from(teachers).sort(), '');

    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        alert(`Произошла ошибка: ${error.message}. Убедитесь, что файл ${XLS_FILE} находится в той же папке.`);
    }
}

/**
 * Основной парсер данных расписания
 */
function parseScheduleData(lines, startRow) {
    const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    let currentDay = '';

    for (let i = startRow; i < lines.length; i++) {
        const row = lines[i];
        const firstCell = String(row[0] || '').toLowerCase().trim();

        // Прекращаем чтение, если дошли до сносок в конце файла
        if (firstCell.includes('сокращения') || firstCell.includes('рем. раб')) {
            break;
        }
        
        // Определяем день недели
        const foundDay = daysOrder.find(day => firstCell.includes(day));
        if (foundDay) {
            currentDay = foundDay.charAt(0).toUpperCase() + foundDay.slice(1);
        }

        const lessonNum = String(row[1] || '').trim();
        if (!lessonNum || !currentDay || isNaN(parseInt(lessonNum))) continue;

        const pair = getPairNumber(lessonNum);
        if (!pair) continue;
        
        // Обрабатываем каждую группу
        for (const groupName of Object.keys(groupColumns)) {
            const colIdx = groupColumns[groupName];
            
            // Собираем текст из нескольких ячеек, чтобы учесть объединенные ячейки в Excel
            const subjectRaw = (String(row[colIdx] || '') + ' ' + String(row[colIdx + 1] || '')).trim();

            if (!subjectRaw || subjectRaw.toLowerCase().includes('классный час')) continue;

            const { subject, teacher, room } = parseSubjectCell(subjectRaw);

            // Проверяем, не добавили ли мы уже этот урок (из-за двойных строк в расписании)
            const isDuplicate = scheduleData.some(
                item => item.day === currentDay && item.group === groupName && item.pair === pair
            );

            if (!isDuplicate) {
                scheduleData.push({
                    day: currentDay,
                    pair: pair,
                    subject: subject || '—',
                    room: room,
                    group: groupName,
                    teacher: teacher || 'Не указан'
                });
                if (teacher) teachers.add(teacher);
            }
        }
    }
}


/**
 * Извлекает предмет, преподавателя и аудиторию из одной ячейки
 */
function parseSubjectCell(cellText) {
    let subject = cellText;
    let teacher = '';
    let room = '—';
    
    // Ищем преподавателя (Фамилия И.О.)
    const teacherMatch = subject.match(/([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.[А-ЯЁ]\.)/);
    if (teacherMatch) {
        teacher = teacherMatch[0];
        subject = subject.replace(teacher, '').trim();
    }
    
    // Ищем аудиторию (каб. XX, ауд. XX, или просто номер в конце)
    const roomMatch = subject.match(/(каб\.|ауд\.|маст\.)?\s*(\d{1,3}[а-я]?)$/i);
    if (roomMatch) {
        room = roomMatch[0];
        subject = subject.replace(room, '').trim();
    }
    
    // Убираем лишние символы, которые могли остаться
    subject = subject.replace(/,$/, '').trim();

    return { subject, teacher, room };
}


function getPairNumber(num) {
    const n = parseInt(num);
    if (isNaN(n)) return null;
    if (n <= 2) return '1-2 пара';
    if (n <= 4) return '3-4 пара';
    if (n <= 6) return '5-6 пара';
    if (n <= 8) return '7-8 пара';
    return null;
}

function fillSelect(id, items, prefix) {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">-- Выберите --</option>';
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = prefix ? prefix + item : item; // Убрал добавление "Группа " если не нужно
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
        resultTitle.innerHTML = `
        Расписание для преподавателя: ${teacher}<br>
        <small style="font-size:0.8em; color: #fff;">Группы: ${teacherGroups}</small>
        `;
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
            
            const sorted = dayLessons.sort((a, b) => parseInt(a.pair) - parseInt(b.pair));

            sorted.forEach(lesson => {
                const lessonEl = document.createElement('div');
                lessonEl.className = 'lesson';
                const teacherInfo = lesson.teacher === 'Не указан' ? '<em>не указан</em>' : lesson.teacher;

                if (currentView === 'group') {
                    lessonEl.innerHTML = `
                        <span class="time">${lesson.pair}:</span> ${lesson.subject}<br>
                        <small><strong>Преподаватель:</strong> ${teacherInfo} | <strong>Аудитория:</strong> ${lesson.room}</small>
                    `;
                } else {
                    lessonEl.innerHTML = `
                        <span class="time">${lesson.pair}:</span> ${lesson.subject}<br>
                        <small><strong>Группа:</strong> ${lesson.group} | <strong>Аудитория:</strong> ${lesson.room}</small>
                    `;
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

// ❗ Запускаем новую функцию при загрузке страницы
window.onload = loadXLS;