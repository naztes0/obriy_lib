import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import LoanActions from '../components/LoanActions.jsx';
import { Empty, ErrorBox, Field, Notice, PageHeader, Pagination, Spinner, LoanStatusBadge, Badge } from '../components/ui.jsx';
import { formatDate, formatDateTime } from '../lib/format.js';
import { useAsync } from '../lib/hooks.js';

const SUMMARY_LABELS = {
  loans: 'видач',
  readers: 'читачів',
  overdueLoans: 'прострочених видач',
  unresolvedLosses: 'неврегульованих втрат',
  readerResponsibility: 'з відповідальним читачем',
  withoutResponsibleReader: 'без відповідального читача',
};

const TABS = [
  { key: 'current-loans', label: 'Поточні' },
  { key: 'overdue-loans', label: 'Прострочені' },
  { key: 'unresolved-losses', label: 'Неврегульовані втрати' },
];

export default function LoansPage() {
  const [tab, setTab] = useState('current-loans');
  const [page, setPage] = useState(1);
  const [flash, setFlash] = useState('');
  const [range, setRange] = useState({ dateFrom: '', dateTo: '' });

  const { data, meta, error, loading, reload } = useAsync(
    () => api.get(`/api/v1/reports/${tab}`, { page, pageSize: 25, ...range }),
    [tab, page, range],
  );
  const summary = meta?.summary;

  return (
    <>
      <PageHeader title="Видачі та повернення" actions={<Link className="btn btn--primary" to="/loans/batch">Масова видача класу</Link>} />
      <p className="field__hint">Нову видачу оформлюють з картки книги (кнопка «Видати» біля примірника).</p>
      {flash && <Notice kind="ok">{flash}</Notice>}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setPage(1); }}>{t.label}</button>
        ))}
      </div>
      <div className="toolbar">
        <Field label="Видано з">{(id) => <input id={id} type="date" value={range.dateFrom} onChange={(e) => { setPage(1); setRange({ ...range, dateFrom: e.target.value }); }} />}</Field>
        <Field label="Видано до">{(id) => <input id={id} type="date" value={range.dateTo} onChange={(e) => { setPage(1); setRange({ ...range, dateTo: e.target.value }); }} />}</Field>
      </div>
      {summary && <p className="field__hint">Підсумок: {Object.entries(summary).map(([k, v]) => `${SUMMARY_LABELS[k] ?? k}: ${v}`).join(' · ')}</p>}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : data?.length === 0 ? <Empty>Записів немає.</Empty> : (
        <table>
          <thead><tr><th>Книга / примірник</th><th>Читач</th><th>Видано</th><th>Строк</th><th>Статус</th><th>Дії</th></tr></thead>
          <tbody>
            {(data ?? []).map((row) => {
              const loanId = row.id ?? row.loanId;
              const reader = row.reader;
              const status = row.status ?? (tab === 'unresolved-losses' ? 'lost' : undefined);
              return (
                <tr key={`${loanId ?? row.copy?.id}`}>
                  <td>{row.book?.title}<div className="field__hint">інв. № {row.copy?.inventoryNumber}</div></td>
                  <td>
                    {reader ? <Link to={`/readers/${reader.id}`}>{reader.fullName ?? `Читач №${reader.id} — картку видалено`}</Link> : <Badge kind="warn">без відповідального читача</Badge>}
                    {reader?.ticketNumber && <div className="field__hint">{reader.ticketNumber}</div>}
                  </td>
                  <td className="nowrap">{formatDateTime(row.issuedAt ?? row.lossRecordedAt)}</td>
                  <td className="nowrap">
                    {formatDate(row.currentDueDate)}
                    {row.overdueDays > 0 && <div><Badge kind="danger">+{row.overdueDays} дн.</Badge></div>}
                  </td>
                  <td>{status ? <LoanStatusBadge status={status} /> : '—'}</td>
                  <td>{loanId && <LoanActions loan={{ id: loanId, status }} onChanged={(m) => { setFlash(m); reload(); }} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Pagination meta={meta} onPage={setPage} />
    </>
  );
}
