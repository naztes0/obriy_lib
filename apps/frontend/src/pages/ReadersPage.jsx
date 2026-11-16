import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MoreHorizontal, Search, SlidersHorizontal, UserPlus } from 'lucide-react';
import api from '../api/client.js';
import { Badge, Button, Empty, ErrorBox, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { CATEGORY, formatDate } from '../lib/format.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import ReaderFormModal from './ReaderFormModal.jsx';

export default function ReadersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState('active');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedQ = useDebounced(q);

  const { data, meta, error, loading, reload } = useAsync(
    () => api.get('/api/v1/readers', { q: debouncedQ, archived, page, pageSize: 25 }),
    [debouncedQ, archived, page],
  );

  return (
    <>
      <PageHeader title="Читачі" subtitle="Картки, строки дії та поточний стан читачів." eyebrow="Бібліотека"
        actions={<Button variant="primary" onClick={() => setCreating(true)}><UserPlus size={17} />Новий читач</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <section className="data-panel">
        <div className="data-panel__tabs" role="tablist" aria-label="Стан карток">
          {[['active','Активні'],['archived','Архівні'],['all','Усі']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={archived === value} onClick={() => { setPage(1); setArchived(value); }}>{label}{archived === value && meta ? <span>{meta.totalItems}</span> : null}</button>
          ))}
        </div>
        <div className="data-panel__tools">
          <label className="search-control"><Search size={17} /><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="ПІБ або номер квитка" aria-label="Пошук читача" /></label>
          <button type="button" className="btn"><SlidersHorizontal size={16} />Фільтри</button>
        </div>
        {loading && !data ? <Spinner /> : data?.length === 0 ? <Empty>Читачів не знайдено.</Empty> : (
          <div className="table-responsive">
            <table className="data-table">
              <thead><tr><th>Читач</th><th>Квиток</th><th>Категорія</th><th>Клас</th><th>Строк квитка</th><th>Стан</th><th aria-label="Дії" /></tr></thead>
              <tbody>
                {(data ?? []).map((r) => {
                  const initials = r.fullName.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
                  return (
                    <tr key={r.id} className={r.isArchived ? 'row-muted' : ''}>
                      <td><div className="person-cell"><span>{initials}</span><div><Link to={`/readers/${r.id}`}>{r.fullName}</Link><small>Картка №{r.id}</small></div></div></td>
                      <td className="text-mono">{r.ticketNumber}</td>
                      <td>{CATEGORY[r.category]}</td>
                      <td>{r.schoolClass?.name ?? '—'}</td>
                      <td>{formatDate(r.ticketExpiresOn)}</td>
                      <td>{r.isBlocked ? <Badge kind="danger">Заблоковано</Badge> : r.isArchived ? <Badge>Архів</Badge> : <Badge kind="ok">Активний</Badge>}</td>
                      <td><Link className="icon-btn table-action" to={`/readers/${r.id}`} aria-label={`Відкрити ${r.fullName}`}><MoreHorizontal size={18} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="data-panel__footer"><Pagination meta={meta} onPage={setPage} /></div>
      </section>
      {creating && <ReaderFormModal onClose={() => setCreating(false)} onSaved={(r) => navigate(`/readers/${r.id}`)} />}
    </>
  );
}
