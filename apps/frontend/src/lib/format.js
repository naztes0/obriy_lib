const TZ = 'Europe/Kyiv';

const dateTimeFormat = new Intl.DateTimeFormat('uk-UA', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(value) {
  if (!value) return '—';
  return dateTimeFormat.format(new Date(value));
}

export function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function todayKyiv() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export const LOAN_STATUS = {
  issued: 'Видано',
  lost: 'Втрачено',
  returned: 'Повернуто',
  compensated: 'Відшкодовано',
};

export const CONDITION = {
  good: 'Добрий',
  worn: 'Зношений',
  damaged: 'Пошкоджений',
  unrecorded: 'Не зафіксовано',
};

export const CATEGORY = { student: 'Учень', employee: 'Працівник' };

export const AVAILABILITY_REASON = {
  book_archived: 'книга в архіві',
  copy_archived: 'примірник в архіві',
  lost: 'втрачений',
  temporarily_unavailable: 'тимчасово недоступний',
  damaged: 'пошкоджений',
  condition_unrecorded: 'потрібен огляд стану',
  on_loan: 'видано читачу',
};

export const ROLE = { manager: 'Завідувач бібліотеки', librarian: 'Бібліотекар' };
