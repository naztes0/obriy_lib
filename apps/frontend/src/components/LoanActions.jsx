import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useAsync, useSubmit } from '../lib/hooks.js';
import { CONDITION, LOAN_STATUS, formatDate } from '../lib/format.js';
import { Button, ErrorBox, Field, Modal, Spinner } from './ui.jsx';

function WithLoan({ loanId, title, onClose, children }) {
  const { data: loan, error, loading, reload } = useAsync(() => api.get(`/api/v1/loans/${loanId}`), [loanId]);
  return (
    <Modal title={title} onClose={onClose}>
      {loading && !loan && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {loan && children(loan)}
    </Modal>
  );
}

function Footer({ onClose, busy, disabled, label, danger }) {
  return (
    <div className="modal__foot">
      <Button onClick={onClose}>Скасувати</Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy} disabled={disabled}>{label}</Button>
    </div>
  );
}

function LoanSummary({ loan }) {
  return (
    <p>
      <strong>{loan.book.title}</strong>, інв. № {loan.copy.inventoryNumber}<br />
      Читач: {loan.reader.fullName ?? `Читач №${loan.reader.id} — картку видалено`} · строк до {formatDate(loan.currentDueDate)}
    </p>
  );
}

function ReturnForm({ loan, onClose, onDone }) {
  const [condition, setCondition] = useState(['good', 'worn', 'damaged'].includes(loan.issueCondition) ? loan.issueCondition : 'good');
  const [defect, setDefect] = useState('');
  const needsDefect = condition !== 'good';
  const action = useCallback(
    (key) =>
      api.post(`/api/v1/loans/${loan.id}/return`, { version: loan.version, condition, defectDescription: needsDefect ? defect : null }, key),
    [loan, condition, defect, needsDefect],
  );
  const { submit, busy, error } = useSubmit(action);
  const fields = error?.fields ?? {};
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone('Повернення зафіксовано.'); }}>
      <LoanSummary loan={loan} />
      <p className="field__hint">Стан при видачі: {CONDITION[loan.issueCondition]}{loan.issueDefectDescription ? ` (${loan.issueDefectDescription})` : ''}</p>
      <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
      <Field label="Стан при поверненні" required error={fields.condition}>
        {(id) => (
          <select id={id} value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="good">Добрий</option>
            <option value="worn">Зношений</option>
            <option value="damaged">Пошкоджений</option>
          </select>
        )}
      </Field>
      {needsDefect && (
        <Field label="Опис дефектів" required error={fields.defectDescription}>
          {(id) => <textarea id={id} rows={3} value={defect} onChange={(e) => setDefect(e.target.value)} />}
        </Field>
      )}
      <Footer onClose={onClose} busy={busy} disabled={needsDefect && !defect.trim()} label="Прийняти повернення" />
    </form>
  );
}

function ExtendForm({ loan, onClose, onDone }) {
  const [newDueDate, setNewDueDate] = useState('');
  const [reason, setReason] = useState('');
  const action = useCallback(
    (key) => api.post(`/api/v1/loans/${loan.id}/extend`, { version: loan.version, newDueDate, reason }, key),
    [loan, newDueDate, reason],
  );
  const { submit, busy, error } = useSubmit(action);
  const fields = error?.fields ?? {};
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone('Строк продовжено.'); }}>
      <LoanSummary loan={loan} />
      <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
      <Field label="Нова дата повернення" required error={fields.newDueDate}
        hint="Один раз, не більше ніж на 30 днів від поточного строку; до завершення поточного строку.">
        {(id) => <input id={id} type="date" min={loan.currentDueDate} value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} />}
      </Field>
      <Field label="Причина" required error={fields.reason}>
        {(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Footer onClose={onClose} busy={busy} disabled={!newDueDate || !reason.trim()} label="Продовжити" />
    </form>
  );
}

function StatusForm({ loan, onClose, onDone, endpoint, label, danger, doneText, intro }) {
  const [comment, setComment] = useState('');
  const action = useCallback(
    (key) => api.post(`/api/v1/loans/${loan.id}/${endpoint}`, { version: loan.version, comment: comment.trim() || null }, key),
    [loan, endpoint, comment],
  );
  const { submit, busy, error } = useSubmit(action);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(doneText); }}>
      <LoanSummary loan={loan} />
      <p>{intro}</p>
      <ErrorBox error={error} />
      <Field label="Коментар (необов’язково)" error={error?.fields?.comment}>
        {(id) => <textarea id={id} rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      <Footer onClose={onClose} busy={busy} label={label} danger={danger} />
    </form>
  );
}

function CorrectForm({ loan, onClose, onDone }) {
  const [status, setStatus] = useState(loan.status);
  const [comment, setComment] = useState('');
  const [condition, setCondition] = useState('good');
  const [defect, setDefect] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const returned = status === 'returned';
  const needsDefect = returned && condition !== 'good';
  const action = useCallback(
    (key) =>
      api.post(
        `/api/v1/loans/${loan.id}/correct-status`,
        {
          version: loan.version,
          status,
          comment,
          confirmCorrection: confirmed,
          ...(returned ? { condition, defectDescription: needsDefect ? defect : null } : {}),
        },
        key,
      ),
    [loan, status, comment, confirmed, returned, condition, defect, needsDefect],
  );
  const { submit, busy, error } = useSubmit(action);
  const fields = error?.fields ?? {};
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone('Статус виправлено.'); }}>
      <LoanSummary loan={loan} />
      <p className="field__hint">Поточний статус: {LOAN_STATUS[loan.status]}. Усі попередні зміни залишаються в історії.</p>
      <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
      <Field label="Правильний статус" required error={fields.status}>
        {(id) => (
          <select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(LOAN_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </Field>
      {returned && (
        <Field label="Стан при поверненні" required error={fields.condition}>
          {(id) => (
            <select id={id} value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="good">Добрий</option>
              <option value="worn">Зношений</option>
              <option value="damaged">Пошкоджений</option>
            </select>
          )}
        </Field>
      )}
      {needsDefect && (
        <Field label="Опис дефектів" required error={fields.defectDescription}>
          {(id) => <textarea id={id} rows={2} value={defect} onChange={(e) => setDefect(e.target.value)} />}
        </Field>
      )}
      <Field label="Пояснення виправлення" required error={fields.comment}>
        {(id) => <textarea id={id} rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Підтверджую виправлення помилкової операції
      </label>
      {fields.confirmCorrection && <div className="field__error">{fields.confirmCorrection}</div>}
      <Footer onClose={onClose} busy={busy} label="Виправити статус" disabled={!comment.trim() || !confirmed || status === loan.status} />
    </form>
  );
}

function ErroneousReturnForm({ loan, onClose, onDone }) {
  const [comment, setComment] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const action = useCallback(
    (key) =>
      api.post(`/api/v1/loans/${loan.id}/erroneous-return`, { version: loan.version, comment, confirmCorrection: confirmed }, key),
    [loan, comment, confirmed],
  );
  const { submit, busy, error } = useSubmit(action);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone('Помилкове повернення зафіксовано: примірник позначено втраченим.'); }}>
      <LoanSummary loan={loan} />
      <p>
        Дія для випадку, коли після видалення особистих даних читача виявили, що повернення було помилковим.
        Стара видача не переписується; примірник стане втраченим і потрапить у звіт без встановленого читача. Борг не поновлюється.
      </p>
      <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
      <Field label="Пояснення" required error={error?.fields?.comment}>
        {(id) => <textarea id={id} rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Підтверджую фіксацію помилкового повернення
      </label>
      <Footer onClose={onClose} busy={busy} danger label="Зафіксувати" disabled={!comment.trim() || !confirmed} />
    </form>
  );
}

export function ManagerLoanTools({ loanId, onChanged }) {
  const [action, setAction] = useState(null);
  const close = () => setAction(null);
  const done = (message) => { close(); onChanged(message); };
  return (
    <>
      <div className="actions" style={{ marginTop: 4 }}>
        <Button small onClick={() => setAction('correct')}>Виправити статус</Button>
        <Button small variant="danger" onClick={() => setAction('erroneous')}>Помилкове повернення</Button>
      </div>
      {action === 'correct' && <WithLoan loanId={loanId} title="Виправлення статусу видачі" onClose={close}>{(l) => <CorrectForm loan={l} onClose={close} onDone={done} />}</WithLoan>}
      {action === 'erroneous' && <WithLoan loanId={loanId} title="Помилкове повернення" onClose={close}>{(l) => <ErroneousReturnForm loan={l} onClose={close} onDone={done} />}</WithLoan>}
    </>
  );
}

export default function LoanActions({ loan, onChanged }) {
  const { isManager } = useAuth();
  const [action, setAction] = useState(null);
  const close = () => setAction(null);
  const done = (message) => { close(); onChanged(message); };
  const open = loan.status === 'issued';
  const lost = loan.status === 'lost';

  return (
    <>
      <div className="actions">
        {(open || lost) && <Button small variant="primary" onClick={() => setAction('return')}>Повернення</Button>}
        {open && <Button small onClick={() => setAction('extend')}>Продовжити</Button>}
        {open && <Button small variant="danger" onClick={() => setAction('loss')}>Втрачено</Button>}
        {lost && isManager && <Button small onClick={() => setAction('compensate')}>Відшкодовано</Button>}
        {isManager && <Button small onClick={() => setAction('correct')}>Виправити статус</Button>}
      </div>
      {action === 'return' && <WithLoan loanId={loan.id} title="Повернення примірника" onClose={close}>{(l) => <ReturnForm loan={l} onClose={close} onDone={done} />}</WithLoan>}
      {action === 'extend' && <WithLoan loanId={loan.id} title="Продовження строку" onClose={close}>{(l) => <ExtendForm loan={l} onClose={close} onDone={done} />}</WithLoan>}
      {action === 'loss' && (
        <WithLoan loanId={loan.id} title="Зафіксувати втрату" onClose={close}>
          {(l) => <StatusForm loan={l} onClose={close} onDone={done} endpoint="loss" label="Зафіксувати втрату" danger doneText="Втрату зафіксовано."
            intro="Видача залишається незавершеною, поки примірник не повернуто або втрату не відшкодовано." />}
        </WithLoan>
      )}
      {action === 'correct' && <WithLoan loanId={loan.id} title="Виправлення статусу видачі" onClose={close}>{(l) => <CorrectForm loan={l} onClose={close} onDone={done} />}</WithLoan>}
      {action === 'compensate' && (
        <WithLoan loanId={loan.id} title="Підтвердити відшкодування" onClose={close}>
          {(l) => <StatusForm loan={l} onClose={close} onDone={done} endpoint="compensate" label="Підтвердити відшкодування" doneText="Відшкодування зафіксовано."
            intro="Фіктивне повернення не створюється; примірник залишається недоступним." />}
        </WithLoan>
      )}
    </>
  );
}
