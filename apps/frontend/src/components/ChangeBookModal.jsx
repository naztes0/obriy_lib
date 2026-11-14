import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useAsync, useDebounced, useSubmit } from '../lib/hooks.js';
import { Button, ErrorBox, Field, Modal } from './ui.jsx';

export default function ChangeBookModal({ copy, currentBookId, onClose, onDone }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const [book, setBook] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { data, error: listError, loading, reload } = useAsync(
    () => api.get('/api/v1/books', { title: debounced, pageSize: 10 }),
    [debounced],
  );

  const action = useCallback(
    (key) =>
      api.patch(`/api/v1/copies/${copy.id}/book`, { version: copy.version, bookId: book.id, reason, confirmBookChange: confirmed }, key),
    [copy, book, reason, confirmed],
  );
  const { submit, busy, error } = useSubmit(action);
  const candidates = (data ?? []).filter((b) => b.id !== currentBookId && !b.isArchived);

  return (
    <Modal title={`Змінити видання · інв. № ${copy.inventoryNumber}`} onClose={onClose} wide>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(); }}>
        <p className="field__hint">Прив’язку можна змінити лише до першої видачі цього примірника. Після зміни він зникне з цієї картки.</p>
        <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
        <Field label="Нове видання" required error={error?.fields?.bookId}>
          {() => (
            <>
              <input placeholder="Пошук за назвою" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Пошук видання" />
              <ErrorBox error={listError} onRetry={reload} />
              <div className="pick-list" aria-busy={loading}>
                {candidates.map((b) => (
                  <button type="button" key={b.id} aria-pressed={book?.id === b.id} onClick={() => setBook(b)}>
                    <strong>{b.title}</strong> · {b.authors.map((a) => a.name ?? a).join(', ')} · {b.publisher}
                  </button>
                ))}
                {!loading && candidates.length === 0 && <div className="empty">Видань не знайдено.</div>}
              </div>
            </>
          )}
        </Field>
        {book && <p className="alert alert--info">Обрано: <strong>{book.title}</strong></p>}
        <Field label="Причина" required error={error?.fields?.reason}>
          {(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          Підтверджую зміну видання для примірника
        </label>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!book || !reason.trim() || !confirmed}>Змінити видання</Button>
        </div>
      </form>
    </Modal>
  );
}
