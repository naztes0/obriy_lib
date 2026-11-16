import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client.js';
import LoanActions from '../components/LoanActions.jsx';
import { ErrorBox, LoanStatusBadge, PageHeader, Spinner } from '../components/ui.jsx';
import { useAsync } from '../lib/hooks.js';
import { CONDITION, formatDate, formatDateTime } from '../lib/format.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, Notice } from '../components/ui.jsx';
import ActionModal from '../components/ActionModal.jsx';
import CorrectParticipantsModal from '../components/CorrectParticipantsModal.jsx';
import { EVENT_KIND } from '../lib/history.js';

export default function LoanDetailPage() {
  const { loanId } = useParams();
  const { isManager } = useAuth();
  const [modal, setModal] = useState(null);
  const [voided, setVoided] = useState(false);
  const { data: loan, loading, error, reload } = useAsync(() => api.get(`/api/v1/loans/${loanId}`), [loanId]);
  const audit=useAsync(()=>api.get(`/api/v1/loans/${loanId}/audit`),[loanId,loan?.version,voided]);
  const auditView=<section><h2>Аудит виправлень</h2><ErrorBox error={audit.error} onRetry={audit.reload}/>{(audit.data??[]).map(e=><div className="card" key={e.id}>
    <strong>{EVENT_KIND[e.operation]}</strong> · {formatDateTime(e.occurredAt)} · {e.actor}<p>{e.reason}</p>
    <p>Було: читач №{e.oldValue.reader_id}, примірник №{e.oldValue.copy_id}. {e.newValue.voided?'Видачу вилучено.':`Стало: читач №${e.newValue.reader_id}, примірник №${e.newValue.copy_id}.`}</p>
  </div>)}</section>;
  if (voided || (!loan && audit.data?.length>0)) return <><Notice kind="ok">Помилкову видачу вилучено з обліку. Аудит збережено.</Notice><Link to="/loans">До видач</Link>{auditView}</>;
  if (loading && !loan) return <Spinner />;
  if (!loan) return <ErrorBox error={error} onRetry={reload} />;
  return <>
    <div className="crumbs"><Link to="/loans">← Видачі</Link></div>
    <PageHeader title={`Видача №${loan.id}`} />
    <ErrorBox error={error} onRetry={reload} />
    <div className="card"><dl className="kv">
      <dt>Статус</dt><dd><LoanStatusBadge status={loan.status} /></dd>
      <dt>Читач</dt><dd><Link to={`/readers/${loan.reader.id}`}>{loan.reader.fullName ?? `Читач №${loan.reader.id} — картку видалено`}</Link> · {loan.reader.ticketNumber}</dd>
      <dt>Видання</dt><dd><Link to={`/books/${loan.book.id}`}>{loan.book.title}</Link></dd>
      <dt>Примірник</dt><dd>{loan.copy.inventoryNumber}</dd>
      <dt>Видано</dt><dd>{formatDateTime(loan.issuedAt)}</dd>
      <dt>Виконавець</dt><dd>{loan.issuedBy?.displayName ?? 'Не зазначено'}</dd>
      <dt>Повернути до</dt><dd>{formatDate(loan.currentDueDate)}</dd>
      <dt>Первинний строк</dt><dd>{formatDate(loan.initialDueDate)}</dd>
      <dt>Клас при видачі</dt><dd>{loan.classNameAtIssue ?? 'Не зазначено'}</dd>
      <dt>Стан при видачі</dt><dd>{CONDITION[loan.issueCondition]} {loan.issueDefectDescription}</dd>
      {loan.extension && <><dt>Продовження</dt><dd>{formatDate(loan.extension.oldDueDate)} → {formatDate(loan.extension.newDueDate)} · {loan.extension.reason}</dd></>}
      {loan.returnedAt && <><dt>Повернуто</dt><dd>{formatDateTime(loan.returnedAt)} · {CONDITION[loan.returnCondition]} {loan.returnDefectDescription}</dd></>}
      {loan.compensatedAt && <><dt>Відшкодовано</dt><dd>{formatDateTime(loan.compensatedAt)}</dd></>}
    </dl></div>
    <LoanActions loan={loan} onChanged={reload} />
    {auditView}
    {isManager && loan.status === 'issued' && <div className="actions">
      <Button onClick={() => setModal('participants')}>Виправити учасників</Button>
      <Button variant="danger" onClick={() => setModal('void')}>Вилучити помилкову видачу</Button>
    </div>}
    {modal === 'participants' && <CorrectParticipantsModal loan={loan} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    {modal === 'void' && <ActionModal title="Вилучити помилкову видачу" description="Підтверджуйте лише якщо фактичної передачі книги не було. Видача зникне з боргів і підсумків; причина та попередні дані залишаться в аудиті. За наявності пов’язаних подій сервер відхилить дію." label="Причина" danger submitLabel="Передачі не було — вилучити"
      run={(key,reason) => api.post(`/api/v1/loans/${loan.id}/void`, { version: loan.version, reason, confirm: true, confirmNoTransfer: true }, key)} onClose={() => setModal(null)} onDone={() => setVoided(true)} />}
  </>;
}
