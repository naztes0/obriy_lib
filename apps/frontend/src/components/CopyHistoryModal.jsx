import { useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { CONDITION, formatDateTime } from '../lib/format.js';
import { ManagerLoanTools } from './LoanActions.jsx';
import { Empty, ErrorBox, Modal, Pagination, Spinner } from './ui.jsx';

const KIND = {
  created: 'Примірник створено',
  condition_changed: 'Зміна фізичного стану',
  temporary_unavailability_changed: 'Тимчасова недоступність',
  issued: 'Видача',
  returned: 'Повернення',
  lost: 'Втрата за видачею',
  lost_in_fund: 'Втрата у фонді',
  found: 'Знайдено',
  compensated: 'Відшкодування',
  erroneous_return: 'Помилкове повернення',
  extended: 'Продовження строку',
  archived: 'Архівація',
  restored: 'Відновлення',
  inventory_number_corrected: 'Виправлення інвентарного номера',
  book_changed: 'Зміна видання',
};

const KEY = {
  inventoryNumber: 'інв. №',
  condition: 'стан',
  defectDescription: 'дефекти',
  isTemporarilyUnavailable: 'тимчасово недоступний',
  isLost: 'втрачений',
  isArchived: 'в архіві',
  bookId: 'видання №',
};

function formatValue(key, value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  if (key === 'condition') return CONDITION[value] ?? value;
  return String(value);
}

function renderValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value).map(([k, v]) => `${KEY[k] ?? k}: ${formatValue(k, v)}`).join('; ');
}

export default function CopyHistoryModal({ copy, onClose, onChanged }) {
  const { isManager } = useAuth();
  const [page, setPage] = useState(1);
  const { data, meta, error, loading, reload } = useAsync(
    () => api.get(`/api/v1/copies/${copy.id}/history`, { page, pageSize: 25 }),
    [copy.id, page],
  );

  return (
    <Modal title={`Історія · інв. № ${copy.inventoryNumber}`} onClose={onClose} wide>
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
                  {KIND[e.kind] ?? e.kind}
                  {e.loanId && <div className="field__hint">видача №{e.loanId}</div>}
                  {isManager && e.loanId && (
                    <ManagerLoanTools loanId={e.loanId} onChanged={() => { reload(); onChanged?.(); }} />
                  )}
                </td>
                <td>
                  {e.oldValue ? <div className="field__hint">було: {renderValue(e.oldValue)}</div> : null}
                  <div>{renderValue(e.newValue)}</div>
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
