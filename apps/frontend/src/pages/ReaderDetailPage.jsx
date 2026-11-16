import ReaderHistory from '../components/ReaderHistory.jsx';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, FileDown, Pencil, RotateCcw, TicketCheck } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ActionModal from '../components/ActionModal.jsx';
import LoanActions from '../components/LoanActions.jsx';
import { Badge, Button, ErrorBox, LoanStatusBadge, Notice, PageHeader, Spinner } from '../components/ui.jsx';
import { CATEGORY, formatDate, formatDateTime } from '../lib/format.js';
import { useAsync } from '../lib/hooks.js';
import ReaderBlocks from './ReaderBlocks.jsx';
import ReaderFormModal from './ReaderFormModal.jsx';
import TicketCorrectionModal from '../components/TicketCorrectionModal.jsx';

function LoanTable({ loans, onChanged, withActions }) {
  if (!loans.length) return <p className="row-muted">Записів немає.</p>;
  return (
    <table>
      <thead><tr><th>Книга / примірник</th><th>Видано</th><th>Строк</th><th>Завершено</th><th>Статус</th>{withActions && <th>Дії</th>}</tr></thead>
      <tbody>
        {loans.map((l) => (
          <tr key={l.id}>
            <td><Link to={`/loans/${l.id}`}>{l.book.title} · №{l.id}</Link><div className="field__hint">інв. № {l.copy.inventoryNumber}</div></td>
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
        eyebrow="Читачі / Картка читача"
        subtitle={`${CATEGORY[reader.category]}${reader.schoolClass ? ` · ${reader.schoolClass.name}` : ''} · квиток ${reader.ticketNumber}`}
        actions={
          <>
            {reader.ticketType === 'electronic' && (
              <a className="btn" href={`/api/v1/readers/${reader.id}/ticket.pdf`} target="_blank" rel="noreferrer"><FileDown size={16} />Квиток PDF</a>
            )}
            <Button onClick={() => setModal('edit')} disabled={reader.isArchived}><Pencil size={16} />Редагувати</Button>
            {isManager && <Button onClick={() => setModal('ticket')}><TicketCheck size={16} />Виправити номер</Button>}
            {reader.isArchived ? (
              isManager && <Button onClick={() => setModal('restore')}><RotateCcw size={16} />Відновити</Button>
            ) : (
              <Button variant="danger" onClick={() => setModal('archive')}><Archive size={16} />В архів</Button>
            )}
          </>
        }
      />
      {flash && <Notice kind="ok">{flash}</Notice>}
      <ErrorBox error={error} onRetry={reload} />
      {reader.isBlocked && <Notice kind="error">Читач заблокований: нові видачі та продовження заборонені. Повернення доступне.</Notice>}
      {reader.isArchived && <Notice kind="warn">Картка в архіві{reader.archiveReason ? `: ${reader.archiveReason}` : ''}. Нові видачі заборонені, повернення доступне.</Notice>}

      <div className="profile-overview">
        <div className="profile-overview__avatar">{reader.fullName.split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>
        <div className="profile-fact"><span>Телефон</span><strong>{reader.phone}</strong></div>
        <div className="profile-fact"><span>Квиток чинний до</span><strong>{formatDate(reader.ticketExpiresOn)}</strong></div>
        <div className="profile-fact"><span>Поточні видачі</span><strong>{reader.currentLoans.length} {reader.currentLoans.length === 1 ? 'книга' : 'книги'}</strong></div>
        <div className="profile-fact"><span>Адреса</span><strong>{reader.address ?? 'Не вказано'}</strong></div>
      </div>

      <div className="detail-sections">
        <section className="section-panel">
          <div className="section-panel__head"><div><span>Видачі</span><h2>Книги на руках</h2></div><Badge kind={reader.currentLoans.length ? 'info' : 'neutral'}>{reader.currentLoans.length}</Badge></div>
          <LoanTable loans={reader.currentLoans} withActions onChanged={(m) => { setFlash(m); reload(); }} />
        </section>

        <section className="section-panel">
          <div className="section-panel__head"><div><span>Хронологія</span><h2>Історія видач</h2></div></div>
          <ReaderHistory readerId={reader.id} />
        </section>

        <div className="blocks-panel">
          <ReaderBlocks readerId={reader.id} currentLoans={reader.currentLoans} onChanged={reload} />
        </div>
      </div>

      {modal === 'edit' && <ReaderFormModal reader={reader} onClose={close} onSaved={done('Зміни збережено.')} />}
      {modal === 'ticket' && <TicketCorrectionModal reader={reader} onClose={close} onDone={done('Номер квитка виправлено.')} />}
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
