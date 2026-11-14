import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { Badge, Empty, ErrorBox, Field, LoanStatusBadge, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { CATEGORY, CONDITION, formatDate, formatDateTime } from '../lib/format.js';
import { useAsync } from '../lib/hooks.js';

const AVAILABILITY = {
  available: ['ok', 'Доступний'], on_loan: ['info', 'Видано'], lost: ['danger', 'Втрачено'],
  damaged: ['danger', 'Пошкоджений'], unrecorded: ['warn', 'Стан не зафіксовано'],
  temporarily_unavailable: ['warn', 'Тимчасово недоступний'], archived: ['neutral', 'Архів'],
};
const BLOCK_STATUS = { active: ['danger', 'Діє'], resolved: ['ok', 'Знято'], annulled: ['neutral', 'Анульовано'] };
const BLOCK_REASON = { overdue: 'Прострочення понад 7 днів', unresolved_loss: 'Втрата без врегулювання' };
const LOSS_KIND = {
  lost: 'Втрата за видачею', lost_in_fund: 'Втрата у фонді', erroneous_return: 'Помилкове повернення',
};

const SUMMARY_LABELS = {
  totalCopies: 'Усього примірників', available: 'Доступні', onLoan: 'Видано', lost: 'Втрачені', damaged: 'Пошкоджені',
  unrecorded: 'Стан не зафіксовано', temporarilyUnavailable: 'Тимчасово недоступні', archived: 'В архіві',
  loans: 'Видач', readers: 'Читачів', unresolvedLosses: 'Неврегульованих втрат',
  readerResponsibility: 'З відповідальним читачем', withoutResponsibleReader: 'Без встановленого читача',
  blocks: 'Блокувань', active: 'Діючих', resolved: 'Знятих', annulled: 'Анульованих', activeIndefinite: 'Безстрокових діючих',
  damagedCopies: 'Пошкоджених примірників', issues: 'Видач', distinctReaders: 'Різних читачів',
};

function ReaderCell({ reader }) {
  if (!reader) return <Badge kind="warn">без встановленого читача</Badge>;
  if (reader.isPersonalDataDeleted) return <span>Читач №{reader.id} — картку видалено</span>;
  return (
    <>
      <Link to={`/readers/${reader.id}`}>{reader.fullName}</Link>
      <div className="field__hint">{reader.ticketNumber}</div>
    </>
  );
}

const BookCell = ({ row }) => (
  <>
    <Link to={`/books/${row.book.id}`}>{row.book.title}</Link>
    <div className="field__hint">інв. № {row.copy.inventoryNumber}</div>
  </>
);

const GroupCell = ({ row }) => (
  <>
    {row.readerCategory ? CATEGORY[row.readerCategory] : '—'}
    {row.className && <div className="field__hint">{row.className}</div>}
  </>
);

const loanColumns = [
  ['Книга / примірник', (r) => <BookCell row={r} />],
  ['Читач', (r) => <ReaderCell reader={r.reader} />],
  ['Категорія / клас', (r) => <GroupCell row={r} />],
  ['Видано', (r) => formatDateTime(r.issuedAt)],
  ['Строк', (r) => (
    <>{formatDate(r.currentDueDate)}{r.overdueDays > 0 && <div><Badge kind="danger">+{r.overdueDays} дн.</Badge></div>}</>
  )],
  ['Статус', (r) => <LoanStatusBadge status={r.status} />],
];

const REPORTS = {
  fund: {
    label: 'Стан фонду', filters: [],
    columns: [
      ['Книга / примірник', (r) => <BookCell row={r} />],
      ['Стан', (r) => (
        <>{CONDITION[r.copy.condition]}{r.copy.defectDescription && <div className="field__hint">{r.copy.defectDescription}</div>}</>
      )],
      ['Доступність', (r) => {
        const [kind, label] = AVAILABILITY[r.copy.availability] ?? ['neutral', r.copy.availability];
        return <Badge kind={kind}>{label}</Badge>;
      }],
    ],
  },
  'current-loans': { label: 'Поточні видачі', filters: ['period', 'category', 'class'], columns: loanColumns },
  'overdue-loans': { label: 'Прострочені видачі', filters: ['period', 'category', 'class'], columns: loanColumns },
  'unresolved-losses': {
    label: 'Неврегульовані втрати', filters: ['period', 'category', 'class'],
    columns: [
      ['Книга / примірник', (r) => <BookCell row={r} />],
      ['Читач', (r) => <ReaderCell reader={r.reader} />],
      ['Категорія / клас', (r) => <GroupCell row={r} />],
      ['Зафіксовано', (r) => formatDateTime(r.lossRecordedAt)],
      ['Тип', (r) => LOSS_KIND[r.lossKind] ?? r.lossKind ?? '—'],
    ],
  },
  blocks: {
    label: 'Блокування', filters: ['period', 'category', 'class', 'blockStatus'],
    columns: [
      ['Читач', (r) => <ReaderCell reader={r.reader} />],
      ['Категорія / клас', (r) => <GroupCell row={r} />],
      ['Підстава', (r) => `${BLOCK_REASON[r.reasonCode] ?? r.reasonCode} (видача ${r.sourceLoanId})`],
      ['Підтверджено', (r) => formatDateTime(r.confirmedAt)],
      ['Мінімум до', (r) => (r.isIndefinite ? <Badge kind="danger">безстроково</Badge> : formatDate(r.minimumUntil))],
      ['Стан', (r) => { const [k, l] = BLOCK_STATUS[r.status]; return <Badge kind={k}>{l}</Badge>; }],
    ],
  },
  'damaged-copies': {
    label: 'Пошкоджені примірники', filters: ['period'],
    columns: [
      ['Книга / примірник', (r) => <BookCell row={r} />],
      ['Опис дефектів', (r) => r.defectDescription ?? '—'],
      ['Зафіксовано', (r) => formatDateTime(r.damageRecordedAt)],
      ['Архів', (r) => (r.isArchived ? <Badge>Архів</Badge> : '')],
    ],
  },
  'reader-activity': { label: 'Читацька активність', filters: ['period', 'category', 'class'], columns: loanColumns },
};

function SummaryCards({ summary }) {
  const entries = Object.entries(summary ?? {}).filter(([, v]) => typeof v === 'number');
  if (!entries.length) return null;
  return (
    <div className="toolbar">
      {entries.map(([key, value]) => (
        <div className="card" key={key} style={{ marginBottom: 0, minWidth: 150 }}>
          <div className="field__hint">{SUMMARY_LABELS[key] ?? key}</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 700, fontVariantNumeric: 'lining-nums' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ActivityBreakdown({ summary }) {
  if (!summary?.byTitles) return null;
  return (
    <div className="grid2">
      <div>
        <h3>За назвами літератури</h3>
        <table>
          <thead><tr><th>Назва</th><th>Видач</th><th>Різних читачів</th></tr></thead>
          <tbody>
            {summary.byTitles.length === 0 && <tr><td colSpan="3" className="row-muted">Немає даних.</td></tr>}
            {summary.byTitles.map((t) => (
              <tr key={t.book.id}><td><Link to={`/books/${t.book.id}`}>{t.book.title}</Link></td><td>{t.issues}</td><td>{t.distinctReaders}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>За класами</h3>
        <table>
          <thead><tr><th>Клас</th><th>Видач</th></tr></thead>
          <tbody>
            {summary.byClasses.length === 0 && <tr><td colSpan="2" className="row-muted">Немає даних.</td></tr>}
            {summary.byClasses.map((c) => <tr key={c.className ?? 'none'}><td>{c.className ?? '—'}</td><td>{c.issues}</td></tr>)}
          </tbody>
        </table>
        <h3>За категоріями читачів</h3>
        <table>
          <thead><tr><th>Категорія</th><th>Видач</th></tr></thead>
          <tbody>
            {summary.byCategories.map((c) => <tr key={c.category ?? 'none'}><td>{CATEGORY[c.category] ?? '—'}</td><td>{c.issues}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [type, setType] = useState('fund');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', category: '', className: '', blockStatus: 'active' });
  const config = REPORTS[type];
  const classes = useAsync(() => api.get('/api/v1/school-classes', { status: 'all' }), []);

  const { data, meta, error, loading, reload } = useAsync(() => {
    const query = { page, pageSize: 25 };
    if (config.filters.includes('period')) Object.assign(query, { dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (config.filters.includes('category')) query.category = filters.category;
    if (config.filters.includes('class')) query.className = filters.className;
    if (config.filters.includes('blockStatus')) query.blockStatus = filters.blockStatus;
    return api.get(`/api/v1/reports/${type}`, query);
  }, [type, page, filters]);

  const setFilter = (name) => (e) => { setPage(1); setFilters((f) => ({ ...f, [name]: e.target.value })); };
  const fieldErrors = error?.fields ?? {};

  return (
    <>
      <PageHeader title="Звіти" />
      <div className="tabs" role="tablist">
        {Object.entries(REPORTS).map(([key, r]) => (
          <button key={key} role="tab" aria-selected={type === key} onClick={() => { setType(key); setPage(1); }}>{r.label}</button>
        ))}
      </div>

      {config.filters.length > 0 && (
        <div className="toolbar">
          {config.filters.includes('period') && (
            <>
              <Field label="З дати" error={fieldErrors.dateFrom}>{(id) => <input id={id} type="date" value={filters.dateFrom} onChange={setFilter('dateFrom')} />}</Field>
              <Field label="По дату" error={fieldErrors.dateTo}>{(id) => <input id={id} type="date" value={filters.dateTo} onChange={setFilter('dateTo')} />}</Field>
            </>
          )}
          {config.filters.includes('category') && (
            <Field label="Категорія читача">
              {(id) => (
                <select id={id} value={filters.category} onChange={setFilter('category')}>
                  <option value="">Усі</option>
                  <option value="student">Учень</option>
                  <option value="employee">Працівник</option>
                </select>
              )}
            </Field>
          )}
          {config.filters.includes('class') && (
            <Field label="Клас">
              {(id) => (
                <select id={id} value={filters.className} onChange={setFilter('className')}>
                  <option value="">Усі</option>
                  {(classes.data ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              )}
            </Field>
          )}
          {config.filters.includes('blockStatus') && (
            <Field label="Стан блокування">
              {(id) => (
                <select id={id} value={filters.blockStatus} onChange={setFilter('blockStatus')}>
                  <option value="active">Діючі</option>
                  <option value="resolved">Зняті</option>
                  <option value="annulled">Анульовані</option>
                  <option value="all">Усі</option>
                </select>
              )}
            </Field>
          )}
        </div>
      )}
      <p className="field__hint">
        {type === 'reader-activity' || config.filters.includes('period')
          ? 'Період відбирає записи за датою події (Europe/Kyiv), обидві межі включно.'
          : 'Звіт показує поточний стан.'}
      </p>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : (
        <>
          <SummaryCards summary={meta?.summary} />
          {type === 'reader-activity' && <ActivityBreakdown summary={meta?.summary} />}
          <h3>Деталізація</h3>
          {data?.length === 0 ? <Empty>За цими умовами записів немає.</Empty> : (
            <table>
              <thead><tr>{config.columns.map(([title]) => <th key={title}>{title}</th>)}</tr></thead>
              <tbody>
                {(data ?? []).map((row, i) => (
                  <tr key={row.id ?? row.loanId ?? `${row.copy?.id}-${i}`}>
                    {config.columns.map(([title, render]) => <td key={title}>{render(row)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination meta={meta} onPage={setPage} />
        </>
      )}
    </>
  );
}
