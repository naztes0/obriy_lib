import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ActionModal from '../components/ActionModal.jsx';
import LoanActions from '../components/LoanActions.jsx';
import { Badge, Button, ErrorBox, LoanStatusBadge, Notice, PageHeader, Spinner } from '../components/ui.jsx';
import { CATEGORY, formatDate, formatDateTime } from '../lib/format.js';
import { useAsync } from '../lib/hooks.js';
import ReaderBlocks from './ReaderBlocks.jsx';
import ReaderFormModal from './ReaderFormModal.jsx';

function LoanTable({ loans, onChanged, withActions }) {
  if (!loans.length) return <p className="row-muted">Записів немає.</p>;
  return (
    <table>
      <thead><tr><th>Книга / примірник</th><th>Видано</th><th>Строк</th><th>Завершено</th><th>Статус</th>{withActions && <th>Дії</th>}</tr></thead>
      <tbody>
        {loans.map((l) => (
          <tr key={l.id}>
            <td>{l.book.title}<div className="field__hint">інв. № {l.copy.inventoryNumber}</div></td>
            <td className="nowrap">{formatDateTime(l.issuedAt)}</td>
            <td className="nowrap">
              {formatDate(l.currentDueDate)}
              {l.extension && <div className="field__hint">було {formatDate(l.extension.oldDueDate)} (продовжено)</div>}
            </td>
            <td className="nowrap">{formatDateTime(l.returnedAt ?? l.compensatedAt)}</td>
            <td><LoanStatusBadge status={l.status} /></td>
            {withActions && <td><LoanActions loan={l} onChanged={onChanged} /></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReaderDetailPage() {
  const { readerId } = useParams();
  const { isManager } = useAuth();
  const { data: reader, error, loading, reload } = useAsync(() => api.get(`/api/v1/readers/${readerId}`), [readerId]);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const close = () => setModal(null);
  const done = (message) => (() => { close(); setFlash(message); reload(); });

  if (loading && !reader) return <Spinner />;
  if (error && !reader) return <ErrorBox error={error} onRetry={reload} />;
  if (!reader) return null;

  return (
    <>
      <div className="crumbs"><Link to="/readers">← Читачі</Link></div>
      <PageHeader
        title={reader.fullName}
        actions={
          <>
            {reader.ticketType === 'electronic' && (
              <a className="btn" href={`/api/v1/readers/${reader.id}/ticket.pdf`} target="_blank" rel="noreferrer">Квиток (PDF)</a>
            )}
            <Button onClick={() => setModal('edit')} disabled={reader.isArchived}>Редагувати</Button>
            {reader.isArchived ? (
              isManager && <Button onClick={() => setModal('restore')}>Відновити</Button>
            ) : (
              <Button variant="danger" onClick={() => setModal('archive')}>В архів</Button>
            )}
          </>
        }
      />
      {flash && <Notice kind="ok">{flash}</Notice>}
      <ErrorBox error={error} onRetry={reload} />
      {reader.isBlocked && <Notice kind="error">Читач заблокований: нові видачі та продовження заборонені. Повернення доступне.</Notice>}
      {reader.isArchived && <Notice kind="warn">Картка в архіві{reader.archiveReason ? `: ${reader.archiveReason}` : ''}. Нові видачі заборонені, повернення доступне.</Notice>}

      <div className="card">
        <dl className="kv">
          <dt>Квиток</dt><dd>{reader.ticketNumber} <Badge>{reader.ticketType === 'electronic' ? 'електронний' : 'наявний'}</Badge></dd>
          <dt>Категорія</dt><dd>{CATEGORY[reader.category]}{reader.schoolClass ? `, ${reader.schoolClass.name}` : ''}</dd>
          <dt>Квиток чинний до</dt><dd>{formatDate(reader.ticketExpiresOn)}</dd>
          <dt>Телефон</dt><dd>{reader.phone}</dd>
          <dt>Адреса</dt><dd>{reader.address ?? '—'}</dd>
        </dl>
      </div>

      <h2>Поточні видачі</h2>
      <LoanTable loans={reader.currentLoans} withActions onChanged={(m) => { setFlash(m); reload(); }} />

      <h2 style={{ marginTop: 24 }}>Історія видач</h2>
      <LoanTable loans={reader.loanHistory} />
      {reader.loanHistoryTotal > reader.loanHistory.length && (
        <p className="field__hint">Показано {reader.loanHistory.length} з {reader.loanHistoryTotal} останніх видач.</p>
      )}

      <div style={{ marginTop: 24 }}>
        <ReaderBlocks readerId={reader.id} currentLoans={reader.currentLoans} onChanged={reload} />
      </div>

      {modal === 'edit' && <ReaderFormModal reader={reader} onClose={close} onSaved={done('Зміни збережено.')} />}
      {modal === 'archive' && (
        <ActionModal title="Архівувати картку" danger submitLabel="Архівувати" label="Причина архівації"
          description="Нові видачі та продовження будуть заборонені; повернення та відшкодування залишаться доступними."
          run={(key, reason) => api.post(`/api/v1/readers/${reader.id}/archive`, { version: reader.version, reason }, key)}
          onClose={close} onDone={done('Картку архівовано.')} />
      )}
      {modal === 'restore' && (
        <ActionModal title="Відновити картку" required={false} label="Коментар" submitLabel="Відновити"
          description="Можливо за чинного квитка. Чинне блокування не знімається."
          run={(key) => api.post(`/api/v1/readers/${reader.id}/restore`, { version: reader.version }, key)}
          onClose={close} onDone={done('Картку відновлено.')} />
      )}
    </>
  );
}
