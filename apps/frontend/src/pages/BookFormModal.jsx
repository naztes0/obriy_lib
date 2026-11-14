import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { Button, ErrorBox, Field, Modal, Notice } from '../components/ui.jsx';
import { useSubmit } from '../lib/hooks.js';

export default function BookFormModal({ book, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: book?.title ?? '',
    authors: (book?.authors ?? []).map((a) => a.name ?? a).join('\n'),
    publisher: book?.publisher ?? '',
    publicationYear: book?.publicationYear ?? '',
    isbn: book?.isbn ?? '',
    isTextbook: book?.isTextbook ?? false,
  });
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const action = useCallback(async () => {
    const body = {
      title: form.title,
      authors: form.authors.split('\n').map((s) => s.trim()).filter(Boolean),
      publisher: form.publisher,
      publicationYear: form.publicationYear === '' ? null : Number(form.publicationYear),
      isbn: form.isbn.trim() || null,
      isTextbook: form.isTextbook,
      confirmDuplicate,
    };
    return book
      ? api.patch(`/api/v1/books/${book.id}`, { ...body, version: book.version })
      : api.post('/api/v1/books', body);
  }, [form, confirmDuplicate, book]);
  const { submit, busy, error } = useSubmit(action);

  async function onSubmit(event) {
    event.preventDefault();
    const result = await submit();
    if (result) onSaved(result.data);
  }

  const fields = error?.fields ?? {};
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));
  const isbnDuplicate = error?.code === 'ISBN_ALREADY_EXISTS' ? error.details?.book : null;
  const possibleDuplicates = error?.code === 'POSSIBLE_BOOK_DUPLICATE' ? error.details?.matches : null;
  const showGenericError = error && !isbnDuplicate && !possibleDuplicates && error.code !== 'VALIDATION_ERROR';

  return (
    <Modal title={book ? 'Редагування книги' : 'Нова книга'} onClose={onClose} wide>
      <form onSubmit={onSubmit}>
        {showGenericError && <ErrorBox error={error} />}
        {error?.code === 'VALIDATION_ERROR' && <Notice kind="error">Перевірте виділені поля.</Notice>}
        {isbnDuplicate && (
          <Notice kind="error">
            Книга з таким ISBN уже існує:{' '}
            <Link to={`/books/${isbnDuplicate.id}`} onClick={onClose}>{isbnDuplicate.title}</Link>.
            Відкрийте її й додайте примірник замість створення дубліката.
          </Notice>
        )}
        {possibleDuplicates && (
          <Notice kind="warn">
            Знайдено схоже видання без ISBN:{' '}
            {possibleDuplicates.map((m, i) => (
              <span key={m.id}>
                {i > 0 && ', '}
                <Link to={`/books/${m.id}`} onClick={onClose}>{m.title}</Link>
              </span>
            ))}
            . Якщо це інше видання, підтвердіть і збережіть ще раз.
            <label className="check">
              <input type="checkbox" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
              Це інше видання, створити окремий запис
            </label>
          </Notice>
        )}
        <Field label="Назва" required error={fields.title}>
          {(id) => <input id={id} value={form.title} onChange={set('title')} maxLength={500} autoFocus />}
        </Field>
        <Field label="Автори" required error={fields.authors} hint="Кожен автор — з нового рядка. Невідомий — «Не встановлено».">
          {(id) => <textarea id={id} rows={3} value={form.authors} onChange={set('authors')} />}
        </Field>
        <div className="grid2">
          <Field label="Видавництво" required error={fields.publisher} hint="Невідоме — «Не встановлено».">
            {(id) => <input id={id} value={form.publisher} onChange={set('publisher')} />}
          </Field>
          <Field label="Рік видання" error={fields.publicationYear} hint="Необов’язково. Ціле число, наприклад 2019.">
            {(id) => <input id={id} inputMode="numeric" value={form.publicationYear} onChange={set('publicationYear')} />}
          </Field>
        </div>
        <Field label="ISBN" error={fields.isbn} hint="Необов’язково. ISBN-10 або ISBN-13, дефіси допускаються.">
          {(id) => <input id={id} value={form.isbn} onChange={set('isbn')} />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.isTextbook} onChange={(e) => setForm((f) => ({ ...f, isTextbook: e.target.checked }))} />
          Підручник
        </label>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy}>Зберегти</Button>
        </div>
      </form>
    </Modal>
  );
}
