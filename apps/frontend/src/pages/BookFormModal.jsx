import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { Button, ErrorBox, Field, Modal, Notice } from '../components/ui.jsx';
import { useSubmit } from '../lib/hooks.js';
import { currentKyivYear, uniqueNonEmpty } from '../lib/validation.js';

export default function BookFormModal({ book, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: book?.title ?? '',
    authors: (book?.authors ?? []).map((a) => a.name ?? a).length
      ? (book?.authors ?? []).map((a) => a.name ?? a)
      : [''],
    publisher: book?.publisher ?? '',
    publicationYear: book?.publicationYear ?? '',
    isbn: book?.isbn ?? '',
    isTextbook: book?.isTextbook ?? false,
  });
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [activeAuthor, setActiveAuthor] = useState(null);
  const [authorSuggestions, setAuthorSuggestions] = useState([]);

  useEffect(() => {
    if (activeAuthor === null || form.authors[activeAuthor].trim().length < 2) { setAuthorSuggestions([]); return undefined; }
    let current = true;
    const query = form.authors[activeAuthor].trim();
    const timer = setTimeout(async () => {
      try {
        const result = await api.get('/api/v1/books', { author: query, page: 1, pageSize: 25 });
        const names = [...new Set((result.data ?? []).flatMap((item) => item.authors ?? []).map((a) => a.name ?? a)
          .filter((name) => name.toLocaleLowerCase('uk-UA').includes(query.toLocaleLowerCase('uk-UA'))))];
        if (current) setAuthorSuggestions(names.slice(0, 8));
      } catch { if (current) setAuthorSuggestions([]); }
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [activeAuthor, form.authors]);

  const action = useCallback(async () => {
    const body = {
      title: form.title,
      authors: uniqueNonEmpty(form.authors),
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
  const setAuthor = (index, value) => setForm((f) => ({ ...f, authors: f.authors.map((author, i) => i === index ? value : author) }));
  const addAuthor = () => setForm((f) => ({ ...f, authors: [...f.authors, ''] }));
  const removeAuthor = (index) => setForm((f) => ({ ...f, authors: f.authors.filter((_, i) => i !== index) }));
  const moveAuthor = (index, direction) => setForm((f) => {
    const next = [...f.authors];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    return { ...f, authors: next };
  });
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
          {(id) => <input id={id} value={form.title} onChange={set('title')} minLength={1} maxLength={500} required autoFocus />}
        </Field>
        <fieldset className={`author-editor${fields.authors ? ' author-editor--invalid' : ''}`}>
          <legend>Автори <span className="field__req">*</span></legend>
          <p className="field__hint">Введіть нового автора або оберіть наявного зі списку. Порядок авторів можна змінювати стрілками.</p>
          {form.authors.map((author, index) => (
            <div className="author-row" key={index}>
              <span className="author-row__number">{index + 1}</span>
              <div className="author-input-wrap" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setActiveAuthor(null); }}>
                <input aria-label={`Автор ${index + 1}`} value={author} onFocus={() => setActiveAuthor(index)} onChange={(e) => { setAuthor(index, e.target.value); setActiveAuthor(index); }}
                  required maxLength={200} placeholder="Прізвище та ім’я автора" autoFocus={index === 0} autoComplete="off" />
                {activeAuthor === index && authorSuggestions.length > 0 && <div className="author-suggestions">
                  {authorSuggestions.map((name) => <button type="button" key={name} onClick={() => { setAuthor(index, name); setActiveAuthor(null); }}>{name}</button>)}
                </div>}
              </div>
              <Button small onClick={() => moveAuthor(index, -1)} disabled={index === 0} aria-label="Перемістити вище">↑</Button>
              <Button small onClick={() => moveAuthor(index, 1)} disabled={index === form.authors.length - 1} aria-label="Перемістити нижче">↓</Button>
              <Button small variant="danger" onClick={() => removeAuthor(index)} disabled={form.authors.length === 1} aria-label="Видалити автора">×</Button>
            </div>
          ))}
          {fields.authors && <div className="field__error">{fields.authors}</div>}
          <Button small onClick={addAuthor}>+ Додати автора</Button>
        </fieldset>
        <div className="grid2">
          <Field label="Видавництво" required error={fields.publisher} hint="Невідоме — «Не встановлено».">
            {(id) => <input id={id} value={form.publisher} onChange={set('publisher')} required maxLength={200} />}
          </Field>
          <Field label="Рік видання" error={fields.publicationYear} hint="Необов’язково. Ціле число, наприклад 2019.">
            {(id) => <input id={id} type="number" inputMode="numeric" min="1" max={currentKyivYear()} step="1" value={form.publicationYear} onChange={set('publicationYear')} />}
          </Field>
        </div>
        <Field label="ISBN" error={fields.isbn} hint="Необов’язково. ISBN-10 або ISBN-13, дефіси допускаються.">
          {(id) => <input id={id} value={form.isbn} onChange={set('isbn')} maxLength={32} inputMode="numeric" placeholder="978-966-00-0000-0" />}
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
