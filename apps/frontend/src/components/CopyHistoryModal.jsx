import { Link } from 'react-router-dom';
import { EVENT_KIND, eventValue } from '../lib/history.js';
import { useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { CONDITION, formatDateTime } from '../lib/format.js';
import { ManagerLoanTools } from './LoanActions.jsx';
import { Empty, ErrorBox, Field, Modal, Pagination, Spinner } from './ui.jsx';

export default function CopyHistoryModal({ copy, onClose, onChanged }) {
  const { isManager } = useAuth();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({dateFrom:"",dateTo:""});
  const { data, meta, error, loading, reload } = useAsync(
    () => api.get(`/api/v1/copies/${copy.id}/history`, { page, pageSize: 25, ...range }),
    [copy.id, page, range],
  );

  return (
    <Modal title={`Історія · інв. № ${copy.inventoryNumber}`} onClose={onClose} wide>
      <div className="toolbar">{[['dateFrom','Видано / події з'],['dateTo','По дату']].map(([name,label]) => <Field key={name} label={label}>{(id) => <input id={id} type="date" value={range[name]} onChange={(e) => {setPage(1);setRange({...range,[name]:e.target.value});}} />}</Field>)}</div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data?.length === 0 && <Empty>Подій немає.</Empty>}
      {data?.length > 0 && (
        <table>
          <thead><tr><th>Дата й час</th><th>Подія</th><th>Було → Стало</th><th>Коментар</th><th>Виконавець</th></tr></thead>
          <tbody>
            {data.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.occurredAt)}</td>
                <td>
                  {EVENT_KIND[e.kind] ?? 'Облікова зміна'}
                  {e.loanId && <Link to={`/loans/${e.loanId}`}>Видача №{e.loanId}</Link>}
                  {isManager && e.loanId && (
                    <ManagerLoanTools loanId={e.loanId} onChanged={() => { reload(); onChanged?.(); }} />
                  )}
                </td>
                <td>
                  {e.oldValue ? <div className="field__hint">було: {eventValue(e.oldValue)}</div> : null}
                  <div>{eventValue(e.newValue)}</div>
                </td>
                <td>{e.reason ?? '—'}</td>
                <td>{e.actor?.displayName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination meta={meta} onPage={setPage} />
    </Modal>
  );
}
