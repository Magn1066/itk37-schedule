// Имя файла с расписанием
const CSV_FILE = 'schedule.csv';

let scheduleData = [];
let groups = new Set();

async function loadCSV() {
  try {
    const response = await fetch(CSV_FILE);
    if (!response.ok) throw new Error('Файл не найден');

    const text = await response.text();
    const lines = text.split('\n').map(line =>
      line.trim().replace(/\r$/, '').split(';')
    );

    // Поиск строки с "ДНИ НЕДЕЛИ"
    let headers = null;
    let dataStartRow = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i][0] && lines[i][0].includes('ДНИ НЕДЕЛИ')) {
        headers = lines[i];
        dataStartRow = i + 1;
        break;
      }
    }

    if (!headers || !dataStartRow) {
      throw new Error('Не найдены заголовки групп');
    }

    // Извлечение названий групп
    headers.forEach((cell, idx) => {
      if (cell.includes('Группа №') || cell.includes('Группа ')) {
        const match = cell.match(/Группа\s+№?\s*([^\s";]+(?:\s+[^\s"]+)*)/i);
        if (match) {
          const groupName = match[1].trim();
          groups.add(groupName);

          window.groupMap = window.groupMap || {};
          window.groupMap[idx] = {
            group: groupName,
            timeIdx: idx - 1 >= 0 ? idx - 1 : null
          };
        }
      }
    });

    // Чтение данных
    const daysOrder = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница'];
    let currentDay = '';

    for (let i = dataStartRow; i < lines.length; i++) {
      const row = lines[i];
      if (row.length < 2) continue;

      const firstCell = (row[0] || '').toLowerCase().trim();
      if (daysOrder.some(day => firstCell.includes(day))) {
        currentDay = firstCell.split(' ')[0];
        continue;
      }

      Object.keys(window.groupMap).forEach(colIdxStr => {
        const colIdx = parseInt(colIdxStr);
        const info = window.groupMap[colIdx];
        const subject = (row[colIdx] || '').trim();
        const time = info.timeIdx !== null ? (row[info.timeIdx] || '').trim() : '—';

        if (subject && subject !== '' && subject !== '"' && !subject.includes('Куратор')) {
          scheduleData.push({
            day: currentDay,
            time: time,
            subject: subject,
            group: info.group
          });
        }
      });
    }

    // Заполнение выпадающего списка
    const select = document.getElementById('groupSelect');
    select.innerHTML = '<option value="">-- Выберите группу --</option>';
    Array.from(groups)
      .sort()
      .forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = `Группа ${group}`;
        select.appendChild(option);
      });

  } catch (error) {
    console.error('Ошибка:', error);
    document.getElementById('groupSelect').innerHTML = '<option value="">Ошибка: файл не загружен</option>';
    alert('Не удалось загрузить расписание. Проверьте, что файл schedule.csv находится в той же папке.');
  }
}

function loadSchedule() {
  const group = document.getElementById('groupSelect').value;
  if (!group) return alert('Выберите группу!');

  document.getElementById('groupTitle').textContent = group;
  const content = document.getElementById('scheduleContent');
  content.innerHTML = '';

  const lessons = scheduleData.filter(l => l.group === group);

  const daysMap = {
    'понедельник': 'Понедельник',
    'вторник': 'Вторник',
    'среда': 'Среда',
    'четверг': 'Четверг',
    'пятница': 'Пятница'
  };

  let hasLessons = false;
  ['понедельник', 'вторник', 'среда', 'четверг', 'пятница'].forEach(dayKey => {
    const dayLessons = lessons.filter(l => l.day === dayKey);
    if (dayLessons.length > 0) {
      hasLessons = true;
      const dayEl = document.createElement('div');
      dayEl.className = 'day';

      const title = document.createElement('h3');
      title.textContent = daysMap[dayKey];
      dayEl.appendChild(title);

      dayLessons.forEach(lesson => {
        const lessonEl = document.createElement('div');
        lessonEl.className = 'lesson';
        lessonEl.innerHTML = `
          <span class="time">${lesson.time}</span><br>
          <strong>${lesson.subject}</strong>
        `;
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

// Загружаем при старте
window.onload = loadCSV;