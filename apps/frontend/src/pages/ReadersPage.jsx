import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { Badge, Button, Empty, ErrorBox, Field, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
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
      <PageHeader title="Читачі" actions={<Button variant="primary" onClick={() => setCreating(true)}>+ Новий читач</Button>} />
      <div className="toolbar">
        <Field label="Пошук">
          {(id) => <input id={id} value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="ПІБ або номер квитка" />}
        </Field>
        <Field label="Архів">
          {(id) => (
            <select id={id} value={archived} onChange={(e) => { setPage(1); setArchived(e.target.value); }}>
              <option value="active">Активні</option>
              <option value="archived">Архівні</option>
              <option value="all">Усі</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : data?.length === 0 ? <Empty>Читачів не знайдено.</Empty> : (
        <table>
          <thead><tr><th>ПІБ</th><th>Квиток</th><th>Категорія</th><th>Клас</th><th>Строк квитка</th><th>Стан</th></tr></thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className={r.isArchived ? 'row-muted' : ''}>
                <td><Link to={`/readers/${r.id}`}>{r.fullName}</Link></td>
                <td>{r.ticketNumber}</td>
                <td>{CATEGORY[r.category]}</td>
                <td>{r.schoolClass?.name ?? '—'}</td>
                <td>{formatDate(r.ticketExpiresOn)}</td>
                <td>
                  {r.isBlocked && <Badge kind="danger">Заблоковано</Badge>}{' '}
                  {r.isArchived && <Badge>Архів</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination meta={meta} onPage={setPage} />
      {creating && <ReaderFormModal onClose={() => setCreating(false)} onSaved={(r) => navigate(`/readers/${r.id}`)} />}
    </>
  );
}
