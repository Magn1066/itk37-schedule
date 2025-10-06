const CSV_FILE = 'schedule.csv';

let scheduleData = [];
let groups = new Set();
let teachers = new Set();

window.groupMap = {};
let currentView = 'group';

async function loadCSV() {
  try {
    const response = await fetch(CSV_FILE + '?t=' + Date.now());
    if (!response.ok) throw new Error('Файл не найден');

    const text = await response.text();

    // Чистим и разбиваем строки
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

    // Извлечение групп
    headers.forEach((cell, idx) => {
      if ((cell.includes('Группа №') || cell.includes('Группа ')) && idx >= 2) {
        const match = cell.match(/Группа\s+№?\s*([^\s";]+(?:\s+[^\s"]+)*)/i);
        if (match) {
          const groupName = match[1].trim().replace(/"/g, '');
          groups.add(groupName);

          window.groupMap[idx] = {
            group: groupName,
            timeIdx: idx - 1
          };
        }
      }
    });

    // === 3. Чтение данных с сохранением последнего урока и дня ===
    const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница'];
    let currentDay = '';
    let lastLessonNum = '';
    let isAfterDay = false;
    let lessonCounter = 0;

    // Будем хранить пары для каждой группы
    const tempPairs = {}; // { day_group_pair: { subject, room, teachers } }

    for (let i = dataStartRow; i < lines.length; i++) {
      const row = lines[i];

      // Определение дня недели
      const firstCell = (row[0] || '').toLowerCase().trim();
      if (daysOrder.some(day => firstCell.includes(day))) {
        currentDay = firstCell.split(' ')[0];
        isAfterDay = true;
        lessonCounter = 0;
        continue;
      }

      // Определение номера урока
      const lessonNumRaw = row[1] ? row[1].trim() : '';
      let currentLessonNum = lessonNumRaw;

      if (isAfterDay) {
        lessonCounter = 1;
        isAfterDay = false;
      } else {
        lessonCounter++;
      }

      // Используем либо номер из ячейки, либо сгенерированный
      currentLessonNum = lessonNumRaw || lessonCounter.toString();

      // Обновляем lastLessonNum всегда
      lastLessonNum = currentLessonNum;

      // Определяем пару
      const pair = getPairNumber(lastLessonNum);
      if (!pair) continue;

      Object.keys(window.groupMap).forEach(colIdxStr => {
        const colIdx = parseInt(colIdxStr);
        const info = window.groupMap[colIdx];
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

          // Ключ: день_группа_пара
          const key = `${currentDay}_${info.group}_${pair}`;

          // Если пара уже есть — не перезаписываем
          if (!tempPairs[key]) {
            tempPairs[key] = {
              day: currentDay,
              pair: pair,
              subject: mainSubject || '—',
              room: room,
              group: info.group,
              allTeachers: new Set()
            };
          }

          // Добавляем преподавателей
          foundTeachers.forEach(t => {
            tempPairs[key].allTeachers.add(t);
            teachers.add(t);
          });
        }
      });
    }

    // Преобразуем в массив
    scheduleData = Object.values(tempPairs).map(item => ({
      ...item,
      allTeachers: Array.from(item.allTeachers)
    }));

    // Заполнение выпадающих списков
    fillSelect('groupSelect', groups, 'Группа ');
    fillSelect('teacherSelect', teachers, '');

    // Скрываем секцию преподавателей
    document.getElementById('teacherSection').style.display = 'none';

  } catch (error) {
    console.error('Ошибка:', error);
    alert('Не удалось загрузить расписание. Проверьте файл schedule.csv.');
  }
}

// Вспомогательная функция: определяет пару по номеру урока
function getPairNumber(num) {
  const n = parseInt(num);
  if (n === 1 || n === 2) return '1.2';
  if (n === 3 || n === 4) return '3.4';
  if (n === 5 || n === 6) return '5.6';
  if (n === 7 || n === 8) return '7.8';
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

  if (currentView === 'group' && !group) return alert('Выберите группу!');
  if (currentView === 'teacher' && !teacher) return alert('Выберите преподавателя!');

  const filtered = currentView === 'group'
    ? scheduleData.filter(l => l.group === group)
    : scheduleData.filter(l => l.allTeachers && l.allTeachers.includes(teacher));

  const resultTitle = document.getElementById('resultTitle');
  if (currentView === 'group') {
    resultTitle.textContent = `Группа ${group}`;
  } else {
    const teacherGroups = [...new Set(filtered.map(l => l.group))];
    resultTitle.innerHTML = `
      Преподаватель: ${teacher}<br>
      <small style="font-size:0.9em">Группы: ${teacherGroups.join(', ')}</small>
    `;
  }

  const content = document.getElementById('scheduleContent');
  content.innerHTML = '';

  const daysMap = {
    'понедельник': 'Понедельник',
    'вторник': 'Вторник',
    'среда': 'Среда',
    'четверг': 'Четверг',
    'пятница': 'Пятница'
  };

  const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница'];
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

      // Сортировка по парам
      const sorted = dayLessons.sort((a, b) => {
        return parseFloat(a.pair) - parseFloat(b.pair);
      });

      sorted.forEach(lesson => {
        const lessonEl = document.createElement('div');
        lessonEl.className = 'lesson';

        if (currentView === 'group') {
          lessonEl.innerHTML = `
            <span class="time"><strong>${lesson.pair}.</strong> ${lesson.subject}</span><br>
            <em>Преподаватель: ${lesson.allTeachers.join(', ')}</em><br>
            <em>Аудитория: ${lesson.room}</em>
          `;
        } else {
          lessonEl.innerHTML = `
            <span class="time"><strong>${lesson.pair}.</strong> ${lesson.subject}</span><br>
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
