import { useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { ErrorBox, Pagination } from './ui.jsx';
import { CONDITION } from '../lib/format.js';

export default function CopyPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [bookId, setBookId] = useState(null);
  const [booksOpen, setBooksOpen] = useState(false);
  const [copiesOpen, setCopiesOpen] = useState(false);
  const rootRef = useRef(null);
  const debounced = useDebounced(query);
  const books = useAsync(
    () => api.get('/api/v1/books', { title: debounced, page, pageSize: 8 }),
    [debounced, page],
  );
  const book = useAsync(
    () => bookId ? api.get(`/api/v1/books/${bookId}`) : Promise.resolve({ data: null }),
    [bookId],
  );
  const availableCopies = (book.data?.copies ?? []).filter((copy) => copy.isAvailable);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setBooksOpen(false);
        setCopiesOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const selectBook = (selected) => {
    setBookId(selected.id);
    setQuery(selected.title);
    onChange(null);
    setBooksOpen(false);
  };

  const changeBook = () => {
    setBookId(null);
    setQuery('');
    setPage(1);
    onChange(null);
    setCopiesOpen(false);
    setBooksOpen(true);
  };

  const selectCopy = (copy) => {
    onChange(copy);
    setCopiesOpen(false);
  };

  return <div className="entity-picker" ref={rootRef}>
    <div className="entity-picker__book">
      <div className="entity-picker__control">
        <input
          aria-label="Пошук видання для примірника"
          role="combobox"
          aria-expanded={booksOpen}
          autoComplete="off"
          placeholder="Назва видання"
          value={query}
          onFocus={() => setBooksOpen(true)}
          onKeyDown={(event) => event.key === 'Escape' && setBooksOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
            setBookId(null);
            onChange(null);
            setCopiesOpen(false);
            setBooksOpen(true);
          }}
        />
        {bookId && <button className="btn btn--small" type="button" onClick={changeBook}>Змінити</button>}
      </div>

      {booksOpen && <div className="entity-picker__dropdown">
        <ErrorBox error={books.error} onRetry={books.reload} />
        <div className="pick-list" aria-busy={books.loading}>
          {(books.data ?? []).map((item) => (
            <button type="button" key={item.id} onClick={() => selectBook(item)}>
              <strong>{item.title}</strong>
              <small>{item.authors?.map((author) => author.name ?? author).join(', ') || 'Автор не зазначений'}</small>
            </button>
          ))}
          {!books.loading && books.data?.length === 0 && <div className="empty">Видань не знайдено.</div>}
        </div>
        <Pagination meta={books.meta} onPage={setPage} />
      </div>}
    </div>

    <ErrorBox error={book.error} onRetry={book.reload} />
    {book.data && <div className="entity-picker__copy">
      <span className="field__hint">Примірник видання «{book.data.title}»</span>
      <button
        type="button"
        className={`entity-picker__selected${value ? ' entity-picker__selected--chosen' : ''}`}
        onClick={() => setCopiesOpen((open) => !open)}
        aria-expanded={copiesOpen}
      >
        <span>{value ? <><strong>{value.inventoryNumber}</strong><small>{CONDITION[value.condition]}</small></> : 'Оберіть примірник'}</span>
        <b>{copiesOpen ? 'Закрити' : value ? 'Змінити' : 'Обрати'}</b>
      </button>

      {copiesOpen && <div className="entity-picker__dropdown entity-picker__dropdown--copies">
        <div className="pick-list">
          {availableCopies.map((copy) => (
            <button type="button" key={copy.id} onClick={() => selectCopy(copy)}>
              <strong>{copy.inventoryNumber}</strong>
              <small>{CONDITION[copy.condition]}{copy.defectDescription ? ` · ${copy.defectDescription}` : ''}</small>
            </button>
          ))}
          {availableCopies.length === 0 && <div className="empty">Доступних примірників немає.</div>}
        </div>
      </div>}
    </div>}
  </div>;
}
