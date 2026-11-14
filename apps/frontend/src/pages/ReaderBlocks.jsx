import { useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ActionModal from '../components/ActionModal.jsx';
import { Badge, Button, ErrorBox, Field, Modal, Spinner } from '../components/ui.jsx';
import { formatDate, formatDateTime } from '../lib/format.js';
import { useAsync, useSubmit } from '../lib/hooks.js';
import { useCallback } from 'react';

const REASON = { overdue: 'Прострочення понад 7 днів', unresolved_loss: 'Втрата без врегулювання понад 14 днів' };
const STATUS = { active: ['danger', 'Діє'], resolved: ['ok', 'Знято'], annulled: ['neutral', 'Анульовано'] };

function CreateBlockModal({ readerId, loans, onClose, onDone }) {
  const [loanId, setLoanId] = useState(loans[0]?.id ?? '');
  const [reasonCode, setReasonCode] = useState('overdue');
  const action = useCallback(
    (key) => api.post(`/api/v1/readers/${readerId}/blocks`, { sourceLoanId: loanId, reasonCode }, key),
    [readerId, loanId, reasonCode],
  );
  const { submit, busy, error } = useSubmit(action);
  return (
    <Modal title="Заблокувати читача" onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(); }}>
        <p>Підстава — прострочення понад 7 днів або втрата, не врегульована 14 днів. Сервер перевірить умови.</p>
        <ErrorBox error={error} />
        <Field label="Видача-підстава" required error={error?.fields?.sourceLoanId}>
          {(id) => (
            <select id={id} value={loanId} onChange={(e) => setLoanId(e.target.value)}>
              {loans.length === 0 && <option value="">Немає поточних видач</option>}
              {loans.map((l) => <option key={l.id} value={l.id}>{l.book.title} · інв. {l.copy.inventoryNumber} · до {formatDate(l.currentDueDate)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Причина" required error={error?.fields?.reasonCode}>
          {(id) => (
            <select id={id} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {Object.entries(REASON).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </Field>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="danger" busy={busy} disabled={!loanId}>Заблокувати</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ReaderBlocks({ readerId, currentLoans, onChanged }) {
  const { isManager } = useAuth();
  const { data: blocks, error, loading, reload } = useAsync(() => api.get(`/api/v1/readers/${readerId}/blocks`), [readerId]);
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);
  const done = () => { close(); reload(); onChanged?.(); };

  return (
    <div className="card">
      <div className="page-head">
        <h2>Блокування</h2>
        <Button small variant="danger" onClick={() => setModal({ type: 'create' })}>Заблокувати</Button>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !blocks && <Spinner />}
      {blocks?.length === 0 && <p className="row-muted">Блокувань не було.</p>}
      {(blocks ?? []).map((b) => {
        const [kind, label] = STATUS[b.status];
        const pending = b.unblockRequests.find((r) => !r.decision);
        return (
          <div key={b.id} className="card">
            <Badge kind={kind}>{label}</Badge> {b.isIndefinite && <Badge kind="danger">Безстрокове</Badge>}
            <dl className="kv">
              <dt>Підстава</dt><dd>{REASON[b.reasonCode]} (видача {b.sourceLoan.id})</dd>
              <dt>Підтвердив</dt><dd>{b.confirmedBy?.displayName ?? b.confirmedBy?.name ?? '—'}, {formatDateTime(b.confirmedAt)}</dd>
              <dt>Мінімум до</dt><dd>{b.isIndefinite ? 'без строку' : formatDate(b.minimumUntil)}</dd>
              {b.resolvedAt && <><dt>Знято</dt><dd>{formatDateTime(b.resolvedAt)}{b.resolutionComment ? ` — ${b.resolutionComment}` : ''}</dd></>}
              {b.annulledAt && <><dt>Анульовано</dt><dd>{formatDateTime(b.annulledAt)} — {b.annulReason}</dd></>}
            </dl>
            {b.unblockRequests.map((r) => (
              <p key={r.id} className="field__hint">
                Запит від {formatDateTime(r.requestedAt)}: {r.requestComment ?? 'без коментаря'} →{' '}
                {r.decision ? (r.decision === 'approved' ? 'схвалено' : 'відхилено') : 'очікує рішення'}
              </p>
            ))}
            {b.status === 'active' && (
              <div className="actions">
                {!isManager && !pending && !b.isIndefinite && <Button small onClick={() => setModal({ type: 'request', block: b })}>Запит на розблокування</Button>}
                {isManager && !b.isIndefinite && <Button small onClick={() => setModal({ type: 'unblock', block: b })}>Розблокувати</Button>}
                {isManager && pending && <Button small onClick={() => setModal({ type: 'decide', block: b, request: pending })}>Рішення за запитом</Button>}
                {isManager && <Button small variant="danger" onClick={() => setModal({ type: 'annul', block: b })}>Анулювати як помилкове</Button>}
              </div>
            )}
          </div>
        );
      })}

      {modal?.type === 'create' && <CreateBlockModal readerId={readerId} loans={currentLoans} onClose={close} onDone={done} />}
      {modal?.type === 'request' && (
        <ActionModal title="Запит на розблокування" label="Коментар" required={false} fieldName="comment" submitLabel="Надіслати запит"
          run={(key, comment) => api.post(`/api/v1/reader-blocks/${modal.block.id}/unblock-requests`, { comment: comment || null }, key)}
          onClose={close} onDone={done} />
      )}
      {modal?.type === 'unblock' && (
        <ActionModal title="Розблокувати читача" label="Рішення / коментар" required={false} fieldName="comment" submitLabel="Розблокувати"
          description="Можливо лише після мінімального строку й усунення всіх підстав."
          run={(key, comment) => api.post(`/api/v1/reader-blocks/${modal.block.id}/unblock`, { version: modal.block.version, comment: comment || null }, key)}
          onClose={close} onDone={done} />
      )}
      {modal?.type === 'decide' && <DecideModal request={modal.request} onClose={close} onDone={done} />}
      {modal?.type === 'annul' && (
        <ActionModal title="Анулювати блокування" danger submitLabel="Анулювати"
          description="Помилкове блокування не враховується як порушення. Дію буде збережено в аудиті."
          run={(key, reason) => api.post(`/api/v1/reader-blocks/${modal.block.id}/annul`, { version: modal.block.version, reason }, key)}
          onClose={close} onDone={done} />
      )}
    </div>
  );
}

function DecideModal({ request, onClose, onDone }) {
  const [decision, setDecision] = useState('approved');
  const [comment, setComment] = useState('');
  const action = useCallback(
    (key) => api.post(`/api/v1/reader-unblock-requests/${request.id}/decision`, { version: request.version, decision, comment: comment || null }, key),
    [request, decision, comment],
  );
  const { submit, busy, error } = useSubmit(action);
  return (
    <Modal title="Рішення за запитом" onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(); }}>
        <p>Запит бібліотекаря: {request.requestComment ?? 'без коментаря'}</p>
        <ErrorBox error={error} />
        <Field label="Рішення">
          {(id) => (
            <select id={id} value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="approved">Схвалити (розблокувати)</option>
              <option value="rejected">Відхилити</option>
            </select>
          )}
        </Field>
        <Field label="Коментар" error={error?.fields?.comment}>
          {(id) => <textarea id={id} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />}
        </Field>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy}>Зберегти рішення</Button>
        </div>
      </form>
    </Modal>
  );
}
