import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';
import { CONDITION, formatDate, todayKyiv } from '../lib/format.js';
import ReaderPicker from './ReaderPicker.jsx';
import ReaderFormModal from '../pages/ReaderFormModal.jsx';
import ConditionModal from './ConditionModal.jsx';
import { Button, ErrorBox, Field, Modal, Notice } from './ui.jsx';

export default function IssueLoanModal({ copy: initialCopy, bookId, bookTitle, isTextbook, onClose, onDone }) {
  const [copy, setCopy] = useState(initialCopy);
  const [reader, setReader] = useState(null);
  const [dueDate, setDueDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState(false);
  const [nested, setNested] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const action = useCallback((key) => api.post('/api/v1/loans', {
    readerId: reader.id, copyId: copy.id, readerVersion: reader.version, copyVersion: copy.version, dueDate: isTextbook ? dueDate || null : null,
  }, key), [reader, copy.id, dueDate, isTextbook]);
  const { submit, busy, error, clearError } = useSubmit(action);
  const today = todayKyiv();
  const defaultDate = new Date(`${today}T00:00:00Z`);
  defaultDate.setUTCDate(defaultDate.getUTCDate() + 30);
  const requestedDue = (isTextbook && dueDate) || defaultDate.toISOString().slice(0, 10);
  const actualDue = reader?.category === 'student' && reader.ticketExpiresOn < requestedDue ? reader.ticketExpiresOn : requestedDue;
  const readerUnavailable = reader && (reader.isArchived || reader.isBlocked ||
    (reader.category === 'student' && reader.ticketExpiresOn < today) ||
    (reader.employmentEndedOn && reader.employmentEndedOn <= today));
  const ready = reader && !readerUnavailable && copy.isAvailable && confirmed && ['good', 'worn'].includes(copy.condition) && actualDue >= today;

  async function refresh() {
    setRefreshError(null); setReview(false); setConfirmed(false);
    try {
      const [book, person] = await Promise.all([
        api.get(`/api/v1/books/${bookId}`), reader ? api.get(`/api/v1/readers/${reader.id}`) : Promise.resolve(null),
      ]);
      const updated = book.data.copies.find((c) => c.id === copy.id);
      setCopy(updated ?? { ...copy, isAvailable: false });
      if (person) setReader(person.data);
      clearError();
    } catch (e) { setRefreshError(e); }
  }
  if (nested === 'reader') return <ReaderFormModal onClose={() => setNested(null)} onSaved={(r) => { setReader(r); setNested(null); }} />;
  if (nested === 'condition') return <ConditionModal copy={copy} onClose={() => setNested(null)} onDone={() => { setNested(null); refresh(); }} />;
  return (
    <Modal title={review ? 'Перевірити та підтвердити видачу' : 'Оформлення видачі'} onClose={onClose} busy={busy} wide>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!ready) return;
        if (!review) { setReview(true); return; }
        const result = await submit();
        if (result) onDone(result.data);
      }}>
        <p><strong>{bookTitle}</strong>, інв. № <strong>{copy.inventoryNumber}</strong></p>
        <ErrorBox error={error ?? refreshError} onRetry={error?.isUnconfirmed ? undefined : refresh} />
        {error?.isUnconfirmed && <Notice kind="warn">Перевірте незавершену операцію в повідомленні над сторінкою. Не оформлюйте нову передачу до встановлення результату.</Notice>}
        <fieldset disabled={busy || error?.isUnconfirmed} style={{ border: 0, padding: 0, margin: 0 }}>
          {!review && <>
            <Field label="Читач" required error={error?.fields?.readerId}>{() => <ReaderPicker value={reader} onChange={setReader} />}</Field>
            <Button small onClick={() => setNested('reader')}>Зареєструвати нового читача</Button>
          </>}
          {reader && <div className="card">
            <strong>{reader.fullName}</strong> · квиток {reader.ticketNumber}<br />
            Клас: {reader.schoolClass?.name ?? 'Не зазначено'} · квиток до {formatDate(reader.ticketExpiresOn)}<br />
            <Link to={`/readers/${reader.id}`} target="_blank" rel="noreferrer">Відкрити картку читача</Link>
          </div>}
          {readerUnavailable && <Notice kind="error">Нову видачу заборонено: перевірте архів, блокування, строк квитка або завершення роботи читача.</Notice>}
          {!copy.isAvailable && <Notice kind="warn">Примірник недоступний. Оновіть його стан або оберіть інший у картці видання.</Notice>}
          {isTextbook && !review && <Field label="Повернути підручник до" error={error?.fields?.dueDate} hint="Без дати — 30 календарних днів. Для навчальної видачі оберіть кінець навчального року.">
            {(id) => <input id={id} type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>}
          {!review && <>
            <p>Фізичний стан: {CONDITION[copy.condition]} {copy.defectDescription}</p>
            <Button small onClick={() => setNested('condition')}>Зафіксувати фактичний стан</Button>
            <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Примірник оглянуто, стан і дефекти підтверджую</label>
          </>}
          {reader && <Notice kind="info">Дата видачі: {formatDate(today)}. Фактично повернути до: <strong>{formatDate(actualDue)}</strong>.
            {actualDue !== requestedDue && ' Строк скорочено до завершення квитка.'}
          </Notice>}
          {review && <p>Стан: {CONDITION[copy.condition]} {copy.defectDescription}. Підтверджуйте лише фактичну передачу книги. Сервер повторно перевірить доступність.</p>}
          <div className="modal__foot">
            {review && <Button onClick={() => setReview(false)}>Назад до редагування</Button>}
            <Button onClick={onClose}>Скасувати</Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!ready || Boolean(error)}>{review ? 'Підтвердити видачу' : 'Перевірити видачу'}</Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
