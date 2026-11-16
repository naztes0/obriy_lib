import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAsync } from '../lib/hooks.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import { ErrorBox, Field, Pagination, Spinner, LoanStatusBadge } from './ui.jsx';
import { EVENT_KIND, eventValue } from '../lib/history.js';

export default function ReaderHistory({ readerId }) {
  const [page,setPage] = useState(1);
  const [range,setRange] = useState({dateFrom:'',dateTo:''});
  const {data,meta,error,loading,reload} = useAsync(() => api.get(`/api/v1/readers/${readerId}/history`,{page,pageSize:25,...range}),[readerId,page,range]);
  return <>
    <div className="toolbar">{[['dateFrom','Видано з'],['dateTo','Видано до']].map(([name,label]) => <Field key={name} label={label}>{(id) => <input id={id} type="date" value={range[name]} onChange={(e) => {setPage(1);setRange({...range,[name]:e.target.value});}} />}</Field>)}</div>
    <ErrorBox error={error} onRetry={reload} />
    {loading ? <Spinner /> : (data ?? []).map((loan) => <div className="card" key={loan.id}>
      <Link to={`/loans/${loan.id}`}>Видача №{loan.id}: {loan.title}</Link> · інв. №{loan.inventoryNumber} · <LoanStatusBadge status={loan.status} />
      <p>Видано {formatDateTime(loan.issuedAt)} · {loan.issuedBy ?? 'Не зазначено'} · повернути до {formatDate(loan.currentDueDate)}</p>
      <details><summary>Події та виконавці</summary>{loan.events.map((e,i) => <p key={i}>{formatDateTime(e.occurredAt)} · {EVENT_KIND[e.kind] ?? 'Облікова зміна'} · {e.actor ?? 'Не зазначено'}<br />{e.reason} {eventValue(e.oldValue)} → {eventValue(e.newValue)}</p>)}</details>
    </div>)}
    {!loading && data?.length === 0 && <p>За цим періодом видач немає.</p>}
    <Pagination meta={meta} onPage={setPage} />
  </>;
}
