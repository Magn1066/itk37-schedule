const XLS_FILE = 'schedule.xls';
const DAYS_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

const state = {
    currentView: 'group',
    lessons: [],
    groups: [],
    teachers: [],
    periodLabel: '',
    selectedGroup: '',
    selectedTeacher: '',
    search: ''
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
    bindElements();
    bindEvents();
    renderLoading();
    loadScheduleSource();
});

function bindElements() {
    [
        'dateHeader',
        'sourceStatus',
        'lessonCount',
        'tabGroup',
        'tabTeacher',
        'entitySearch',
        'searchLabel',
        'groupSection',
        'teacherSection',
        'groupSelect',
        'teacherSelect',
        'quickPicks',
        'schedule'
    ].forEach(id => {
        elements[id] = document.getElementById(id);
    });
}

function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    elements.entitySearch.addEventListener('input', event => {
        state.search = event.target.value.trim();
        renderQuickPicks();
    });

    elements.groupSelect.addEventListener('change', event => {
        state.selectedGroup = event.target.value;
        renderSchedule();
        renderQuickPicks();
    });

    elements.teacherSelect.addEventListener('change', event => {
        state.selectedTeacher = event.target.value;
        renderSchedule();
        renderQuickPicks();
    });
}

async function loadScheduleSource() {
    try {
        const source = await excelScheduleProvider.load();
        state.lessons = source.lessons;
        state.groups = source.groups;
        state.teachers = source.teachers;
        state.periodLabel = source.periodLabel || 'Период не указан в Excel';

        fillSelect(elements.groupSelect, state.groups, 'Выберите группу');
        fillSelect(elements.teacherSelect, state.teachers, 'Выберите преподавателя');

        state.selectedGroup = state.groups[0] || '';
        elements.groupSelect.value = state.selectedGroup;

        updateHeader();
        renderQuickPicks();
        renderSchedule();
    } catch (error) {
        console.error('Ошибка при загрузке расписания:', error);
        renderError(error.message);
    }
}

const excelScheduleProvider = {
    async load() {
        const response = await fetch(`${XLS_FILE}?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Не удалось загрузить ${XLS_FILE}. Для локальной проверки откройте сайт через небольшой веб-сервер, а на GitHub Pages файл должен лежать рядом с index.html.`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { header: 1, defval: '' });
        const parser = parseLegacyWorkbook(worksheet);

        return {
            source: XLS_FILE,
            periodLabel: parser.periodLabel,
            lessons: parser.lessons,
            groups: Array.from(parser.groups).sort(localeSort),
            teachers: Array.from(parser.teachers).sort(localeSort)
        };
    }
};

function parseLegacyWorkbook(rows) {
    const groups = new Set();
    const teachers = new Set();
    const groupColumns = {};
    const lessons = [];
    const periodLabel = extractPeriod(rows);

    let headers = null;
    let dataStartRow = -1;

    for (let i = 0; i < rows.length; i += 1) {
        if (String(rows[i][0]).includes('ДНИ НЕДЕЛИ')) {
            headers = rows[i];
            dataStartRow = i + 1;
            break;
        }
    }

    if (!headers || dataStartRow === -1) {
        throw new Error('Не удалось найти строку с заголовками "ДНИ НЕДЕЛИ" в текущем Excel-файле.');
    }

    headers.forEach((cell, index) => {
        const cleanCell = String(cell).trim().replace(/"/g, '');
        if (cleanCell.toLowerCase().startsWith('группа')) {
            const groupName = cleanCell.replace(/Группа\s+№?\s*/i, '').trim();
            if (groupName) {
                groups.add(groupName);
                groupColumns[groupName] = index;
            }
        }
    });

    parseScheduleRows(rows, dataStartRow, groupColumns, lessons, teachers);

    return { groups, teachers, lessons, periodLabel };
}

function extractPeriod(rows) {
    for (const row of rows) {
        const line = String(row.join(';'));
        if (line.includes('РАСПИСАНИЕ ЗАНЯТИЙ')) {
            const match = line.match(/с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})/);
            if (match) {
                return `Период: ${match[1]} - ${match[2]}`;
            }
        }
    }
    return '';
}

function parseScheduleRows(rows, startRow, groupColumns, lessons, teachers) {
    const dayNames = DAYS_ORDER.map(day => day.toLowerCase());
    let currentDay = '';
    let nextContinuationLesson = null;
    let blankRowsAfterContinuation = 0;

    for (let i = startRow; i < rows.length; i += 1) {
        const row = rows[i];
        const firstCell = String(row[0] || '').toLowerCase().trim();

        if (isLegendRow(row)) {
            break;
        }

        const foundDay = dayNames.find(day => firstCell.includes(day));
        if (foundDay) {
            currentDay = foundDay.charAt(0).toUpperCase() + foundDay.slice(1);
            nextContinuationLesson = null;
            blankRowsAfterContinuation = 0;
        }

        const lessonNumber = String(row[1] || '').trim();
        const numericLesson = parseInt(lessonNumber, 10);
        let pair = null;

        if (currentDay && !Number.isNaN(numericLesson) && numericLesson >= 1) {
            pair = getLessonNumber(numericLesson);
            nextContinuationLesson = numericLesson === 8 ? 9 : null;
            blankRowsAfterContinuation = 0;
        } else if (currentDay && nextContinuationLesson && rowHasSubject(row, groupColumns) && blankRowsAfterContinuation <= 1) {
            pair = getLessonNumber(nextContinuationLesson);
            nextContinuationLesson += 2;
            blankRowsAfterContinuation = 0;
        } else if (nextContinuationLesson && isBlankScheduleRow(row, groupColumns)) {
            blankRowsAfterContinuation += 1;
        } else if (nextContinuationLesson) {
            nextContinuationLesson = null;
            blankRowsAfterContinuation = 0;
        }

        if (!pair) {
            continue;
        }

        Object.entries(groupColumns).forEach(([groupName, columnIndex]) => {
            const disciplineRaw = String(row[columnIndex] || '').trim();
            const roomRaw = String(row[columnIndex + 1] || '').trim();
            if (!disciplineRaw || disciplineRaw.toLowerCase().includes('классный час')) {
                return;
            }

            parseSubjectCell(disciplineRaw, roomRaw).forEach(lesson => {
                const isDuplicate = !hasLessonSplitter(disciplineRaw, roomRaw) && lessons.some(item =>
                    item.day === currentDay && item.group === groupName && item.pair === pair
                );

                if (isDuplicate) {
                    return;
                }

                const normalizedLesson = {
                    day: currentDay,
                    pair,
                    pairOrder: getPairOrder(pair),
                    subject: lesson.subject || '-',
                    room: lesson.room || '-',
                    group: groupName,
                    teacher: lesson.teacher || 'Не указан'
                };

                lessons.push(normalizedLesson);
                if (normalizedLesson.teacher !== 'Не указан') {
                    teachers.add(normalizedLesson.teacher);
                }
            });
        });
    }
}

function rowHasSubject(row, groupColumns) {
    return Object.values(groupColumns).some(columnIndex => {
        const disciplineRaw = String(row[columnIndex] || '').trim();
        return disciplineRaw && !disciplineRaw.toLowerCase().includes('классный час');
    });
}

function isBlankScheduleRow(row, groupColumns) {
    const hasLessonNumber = String(row[1] || '').trim();
    if (hasLessonNumber) {
        return false;
    }

    return Object.values(groupColumns).every(columnIndex => {
        const disciplineRaw = String(row[columnIndex] || '').trim();
        const roomRaw = String(row[columnIndex + 1] || '').trim();
        return !disciplineRaw && !roomRaw;
    });
}

function isLegendRow(row) {
    const line = normalizeText(row.join(' ')).toLowerCase();
    if (!line) {
        return false;
    }

    return line.includes('сокращения') || line.includes('рем. раб -') || line.includes('тпв - техническое обслуживание');
}

function getLessonNumber(num) {
    const n = parseInt(num, 10);
    if (Number.isNaN(n)) return null;
    if (n <= 2) return '1-2 урок';
    if (n <= 4) return '3-4 урок';
    if (n <= 6) return '5-6 урок';
    if (n <= 8) return '7-8 урок';
    if (n <= 10) return '9-10 урок';
    if (n <= 12) return '11-12 урок';
    return `${n}-${n + 1} урок`;
}

function getPairOrder(pair) {
    return parseInt(String(pair).split('-')[0], 10) || 999;
}

function parseSubjectCell(disciplineText, roomText = '') {
    const discipline = normalizeText(disciplineText);
    const room = normalizeText(roomText);

    if (!discipline) {
        return [{ subject: '-', teacher: 'Не указан', room: room || '-' }];
    }

    if (!hasLessonSplitter(discipline, room)) {
        return [parseSubjectPart(discipline, room)];
    }

    return parseSplitSubjectCell(discipline, room);
}

function parseSplitSubjectCell(discipline, room) {
    const subjectParts = splitClean(discipline, '/');
    const roomParts = splitRooms(room);

    if (subjectParts.length === 3 && roomParts.length === 2 && isTeacherOnly(subjectParts[2])) {
        const middleLesson = parseSubjectPart(subjectParts[1], '');
        const firstTeacherSource = middleLesson.teacher;
        const secondTeacher = parseSubjectPart(subjectParts[2], '').teacher;
        const secondSubject = completeShortLanguageSubject(subjectParts[0], middleLesson.subject);

        return [
            parseSubjectPart(`${subjectParts[0]} ${firstTeacherSource}`, roomParts[0]),
            parseSubjectPart(`${secondSubject} ${secondTeacher}`, roomParts[1])
        ];
    }

    if (subjectParts.length === roomParts.length && subjectParts.length > 1) {
        return subjectParts.map((part, index) => parseSubjectPart(part, roomParts[index]));
    }

    return [parseSubjectPart(discipline, room)];
}

function parseSubjectPart(text, roomOverride = '') {
    let subject = normalizeText(text);
    let teacher = '';
    let room = normalizeText(roomOverride) || '-';
    let match = null;
    const roomPrefixRegex = /(.*)\s*((каб\.|ауд\.|маст\.)\s*(\d{1,3}[а-я]?))$/i;
    const roomNumOnlyRegex = /(.*)\s*(\d{3,}[а-я]?)$/i;

    if (!roomOverride) {
        let roomMatch = subject.match(roomPrefixRegex);

        if (roomMatch) {
            room = roomMatch[2].trim();
            subject = roomMatch[1].trim();
        } else {
            roomMatch = subject.match(roomNumOnlyRegex);
            if (roomMatch) {
                room = roomMatch[2].trim();
                subject = roomMatch[1].trim();
            }
        }
    }

    const regexTwoInitials = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.?\s*[А-ЯЁ]\.?)/;
    const regexOneInitial = /([А-ЯЁ][а-яё]+)\s+([А-ЯЁ]\.?)/;
    const teacherMatch = subject.match(regexTwoInitials) || subject.match(regexOneInitial);

    if (teacherMatch) {
        match = teacherMatch;
    }

    if (match) {
        subject = subject.replace(match[0], '').trim();
        const surname = match[1];
        let rawInitials = match[2].trim().replace(/\s+/g, '');
        rawInitials = rawInitials.replace(/([А-ЯЁ])(?!\.)/g, '$1.');

        if (rawInitials.length > 3) {
            rawInitials = rawInitials.replace(/([А-ЯЁ]\.)([А-ЯЁ]\.)/, '$1 $2');
        }

        teacher = `${surname} ${rawInitials}`;
    }

    subject = subject.replace(/,$/, '').trim();

    return {
        subject: subject || '-',
        teacher: teacher || 'Не указан',
        room
    };
}

function hasLessonSplitter(discipline, room) {
    return discipline.includes('/') && !isGymRoom(room);
}

function splitRooms(room) {
    if (!room || isGymRoom(room)) {
        return room ? [room] : [];
    }
    return splitClean(room, '/');
}

function splitClean(value, separator) {
    return normalizeText(value).split(separator).map(part => part.trim()).filter(Boolean);
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isGymRoom(value) {
    return /^с\s*\/\s*зал$/i.test(normalizeText(value));
}

function isTeacherOnly(value) {
    return /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?$/i.test(normalizeText(value));
}

function completeShortLanguageSubject(firstSubject, secondSubject) {
    const first = normalizeText(firstSubject).toLowerCase();
    const second = normalizeText(secondSubject);
    if (first.includes('яз') && /^(англ|нем|рус)$/i.test(second)) {
        return `${second} яз`;
    }
    return second;
}

function updateHeader() {
    elements.dateHeader.textContent = state.periodLabel;
    elements.sourceStatus.textContent = XLS_FILE;
    elements.lessonCount.textContent = formatCount(state.lessons.length, ['занятие', 'занятия', 'занятий']);
}

function fillSelect(select, items, placeholder) {
    select.innerHTML = '';
    select.appendChild(createOption('', placeholder));
    items.forEach(item => select.appendChild(createOption(item, item)));
}

function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
}

function switchView(view) {
    state.currentView = view;
    state.search = '';
    elements.entitySearch.value = '';

    elements.tabGroup.classList.toggle('active', view === 'group');
    elements.tabTeacher.classList.toggle('active', view === 'teacher');
    elements.tabGroup.setAttribute('aria-selected', String(view === 'group'));
    elements.tabTeacher.setAttribute('aria-selected', String(view === 'teacher'));

    elements.groupSection.hidden = view !== 'group';
    elements.teacherSection.hidden = view !== 'teacher';
    elements.searchLabel.textContent = view === 'group' ? 'Найти группу' : 'Найти преподавателя';
    elements.entitySearch.placeholder = view === 'group' ? 'Например: 3/4 МА-26' : 'Фамилия или инициалы';

    renderQuickPicks();
    renderSchedule();
}

function getCurrentItems() {
    return state.currentView === 'group' ? state.groups : state.teachers;
}

function getSelectedValue() {
    return state.currentView === 'group' ? state.selectedGroup : state.selectedTeacher;
}

function setSelectedValue(value) {
    if (state.currentView === 'group') {
        state.selectedGroup = value;
        elements.groupSelect.value = value;
    } else {
        state.selectedTeacher = value;
        elements.teacherSelect.value = value;
    }
}

function renderQuickPicks() {
    const items = getCurrentItems();
    const selected = getSelectedValue();
    const search = state.search.toLowerCase();
    const filtered = items
        .filter(item => item.toLowerCase().includes(search))
        .slice(0, 10);

    elements.quickPicks.innerHTML = '';

    if (!filtered.length) {
        const empty = document.createElement('span');
        empty.className = 'result-meta';
        empty.textContent = 'Ничего не найдено';
        elements.quickPicks.appendChild(empty);
        return;
    }

    filtered.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `quick-pick${item === selected ? ' active' : ''}`;
        button.textContent = item;
        button.addEventListener('click', () => {
            setSelectedValue(item);
            renderQuickPicks();
            renderSchedule();
        });
        elements.quickPicks.appendChild(button);
    });
}

function renderSchedule() {
    const selected = getSelectedValue();

    if (!state.lessons.length) {
        renderLoading();
        return;
    }

    if (!selected) {
        renderEmpty('Выберите группу или преподавателя', 'Расписание появится здесь по дням недели.');
        return;
    }

    const filtered = state.currentView === 'group'
        ? state.lessons.filter(lesson => lesson.group === selected)
        : state.lessons.filter(lesson => lesson.teacher === selected);

    const entityLabel = state.currentView === 'group' ? 'Группа' : 'Преподаватель';
    const metaLabel = state.currentView === 'group'
        ? uniqueSorted(filtered.map(lesson => lesson.teacher).filter(name => name !== 'Не указан')).join(', ')
        : uniqueSorted(filtered.map(lesson => lesson.group)).join(', ');

    elements.schedule.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'result-header';
    header.appendChild(createResultTitle(`${entityLabel}: ${selected}`, metaLabel || 'Занятий нет'));
    header.appendChild(createSummaryBadge(getVisibleLessonCount(filtered)));
    elements.schedule.appendChild(header);

    if (!filtered.length) {
        renderEmpty('Занятий не найдено', 'Для выбранного варианта в текущем Excel-файле нет расписания.');
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'days-grid';

    DAYS_ORDER.forEach(day => {
        const dayLessons = filtered
            .filter(lesson => lesson.day === day)
            .sort((a, b) => a.pairOrder - b.pairOrder || localeSort(a.subject, b.subject));
        grid.appendChild(createDayCard(day, getVisibleLessons(dayLessons)));
    });

    elements.schedule.appendChild(grid);
}

function createResultTitle(title, meta) {
    const wrap = document.createElement('div');
    const h2 = document.createElement('h2');
    const p = document.createElement('p');
    p.className = 'result-meta';
    h2.textContent = title;
    p.textContent = state.currentView === 'group' ? `Преподаватели: ${meta}` : `Группы: ${meta}`;
    wrap.append(h2, p);
    return wrap;
}

function createSummaryBadge(count) {
    const badge = document.createElement('div');
    badge.className = 'summary-badge';
    const forms = state.currentView === 'group'
        ? ['пара', 'пары', 'пар']
        : ['занятие', 'занятия', 'занятий'];
    badge.textContent = formatCount(count, forms);
    return badge;
}

function createDayCard(day, lessons) {
    const card = document.createElement('article');
    card.className = 'day-card';

    const header = document.createElement('div');
    header.className = 'day-card__header';
    const title = document.createElement('h3');
    title.textContent = day;
    const count = document.createElement('span');
    count.className = 'day-count';
    count.textContent = lessons.length ? formatCount(lessons.length, ['пара', 'пары', 'пар']) : 'нет занятий';
    header.append(title, count);
    card.appendChild(header);

    if (!lessons.length) {
        const empty = document.createElement('div');
        empty.className = 'day-empty';
        empty.textContent = 'Окно в расписании';
        card.appendChild(empty);
        return card;
    }

    const list = document.createElement('div');
    list.className = 'lesson-list';
    lessons.forEach(slot => list.appendChild(createLessonCard(slot)));
    card.appendChild(list);
    return card;
}

function createLessonCard(slot) {
    const card = document.createElement('div');
    card.className = 'lesson-card';

    const time = document.createElement('div');
    time.className = 'lesson-time';
    time.textContent = slot.pair;

    const body = document.createElement('div');
    const parts = slot.parts || [slot];

    if (parts.length > 1) {
        const splitLabel = document.createElement('div');
        splitLabel.className = 'split-label';
        splitLabel.textContent = 'Подгруппы';
        body.appendChild(splitLabel);
    }

    parts.forEach((lesson, index) => {
        const part = document.createElement('div');
        part.className = `lesson-part${parts.length > 1 ? ' split' : ''}`;

        const subject = document.createElement('p');
        subject.className = 'lesson-subject';
        subject.textContent = parts.length > 1 ? `${index + 1}. ${lesson.subject}` : lesson.subject;

        const details = document.createElement('div');
        details.className = 'lesson-details';
        if (state.currentView === 'group') {
            details.appendChild(createDetail('Преподаватель', lesson.teacher));
        } else {
            details.appendChild(createDetail('Группа', lesson.group));
        }
        details.appendChild(createDetail('Кабинет', lesson.room, 'room'));

        part.append(subject, details);
        body.appendChild(part);
    });

    card.append(time, body);
    return card;
}

function getVisibleLessons(lessons) {
    if (state.currentView !== 'group') {
        return lessons;
    }

    const slots = new Map();
    lessons.forEach(lesson => {
        const key = `${lesson.day}|${lesson.pair}`;
        if (!slots.has(key)) {
            slots.set(key, {
                day: lesson.day,
                pair: lesson.pair,
                pairOrder: lesson.pairOrder,
                parts: []
            });
        }
        slots.get(key).parts.push(lesson);
    });

    return Array.from(slots.values())
        .sort((a, b) => a.pairOrder - b.pairOrder)
        .map(slot => slot.parts.length === 1 ? slot.parts[0] : slot);
}

function getVisibleLessonCount(lessons) {
    return getVisibleLessons(lessons).length;
}

function createDetail(label, value, extraClass = '') {
    const item = document.createElement('span');
    item.className = `detail-pill ${extraClass}`.trim();
    item.textContent = `${label}: ${value || '-'}`;
    return item;
}

function renderLoading() {
    elements.schedule.innerHTML = `
        <div class="empty-state">
            <p class="empty-state__title">Загружаю расписание</p>
            <p>Читаю файл schedule.xls рядом со страницей.</p>
        </div>
    `;
}

function renderEmpty(title, description) {
    elements.schedule.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const h = document.createElement('p');
    h.className = 'empty-state__title';
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = description;
    empty.append(h, p);
    elements.schedule.appendChild(empty);
}

function renderError(message) {
    elements.dateHeader.textContent = 'Ошибка загрузки расписания';
    elements.sourceStatus.textContent = XLS_FILE;
    elements.lessonCount.textContent = 'проверьте файл';
    elements.schedule.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'error-state';
    const title = document.createElement('p');
    title.className = 'error-state__title';
    title.textContent = 'Не получилось прочитать Excel';
    const details = document.createElement('p');
    details.textContent = message;
    error.append(title, details);
    elements.schedule.appendChild(error);
}

function formatCount(count, forms) {
    const abs = Math.abs(count) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return `${count} ${forms[2]}`;
    if (last > 1 && last < 5) return `${count} ${forms[1]}`;
    if (last === 1) return `${count} ${forms[0]}`;
    return `${count} ${forms[2]}`;
}

function uniqueSorted(items) {
    return Array.from(new Set(items.filter(Boolean))).sort(localeSort);
}

function localeSort(a, b) {
    return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
}
