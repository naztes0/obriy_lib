import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAsync } from '../lib/hooks.js';
import { formatDate } from '../lib/format.js';
import { Badge, Button, ErrorBox, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import ReaderBlocks from './ReaderBlocks.jsx';

export default function RestrictionsPage() {
  const [pending,setPending]=useState(false);
  const [page,setPage]=useState(1);
  const [readerId,setReaderId]=useState(null);
  const list=useAsync(() => api.get('/api/v1/restrictions',{pending,page,pageSize:25}),[pending,page]);
  return <>
    <PageHeader title="Блокування та запити" />
    <label className="check"><input type="checkbox" checked={pending} onChange={(e) => {setPending(e.target.checked);setPage(1);}} />Лише запити, що очікують рішення</label>
    <ErrorBox error={list.error} onRetry={list.reload} />
    {list.loading ? <Spinner /> : <table><thead><tr><th>Читач</th><th>Квиток</th><th>Мінімальний строк</th><th>Запит</th><th>Дії</th></tr></thead><tbody>
      {(list.data ?? []).map((b) => <tr key={b.id}><td><Link to={`/readers/${b.readerId}`}>{b.fullName ?? `Читач №${b.readerId}`}</Link></td><td>{b.ticketNumber}</td><td>{b.isIndefinite?'Безстроково':formatDate(b.minimumUntil)}</td><td>{b.hasPendingRequest && <Badge kind="warn">Очікує рішення</Badge>}</td><td><Button small onClick={() => setReaderId(b.readerId)}>Розглянути</Button></td></tr>)}
    </tbody></table>}
    {!list.loading && list.data?.length===0 && <p>Діючих блокувань за цими умовами немає.</p>}
    <Pagination meta={list.meta} onPage={setPage} />
    {readerId && <ReaderBlocks key={readerId} readerId={readerId} currentLoans={[]} hideCreate onChanged={list.reload} />}
  </>;
}
