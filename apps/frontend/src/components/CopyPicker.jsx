import { useState } from 'react';
import api from '../api/client.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { Button, ErrorBox, Pagination } from './ui.jsx';
import { CONDITION } from '../lib/format.js';

export default function CopyPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [bookId, setBookId] = useState(null);
  const debounced = useDebounced(query);
  const books = useAsync(() => api.get('/api/v1/books', { title: debounced, page, pageSize: 8 }), [debounced,page]);
  const book = useAsync(() => bookId ? api.get(`/api/v1/books/${bookId}`) : Promise.resolve({data:null}), [bookId]);
  return <div>
    <input aria-label="Пошук видання для примірника" placeholder="Назва видання" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
    <ErrorBox error={books.error ?? book.error} />
    <div className="pick-list">{(books.data ?? []).map((b) => <Button key={b.id} onClick={() => setBookId(b.id)}>{b.title}</Button>)}</div>
    <Pagination meta={books.meta} onPage={setPage} />
    {book.data && <label>Примірник видання «{book.data.title}»
      <select aria-label="Правильний примірник" value={value?.id ?? ''} onChange={(e) => onChange(book.data.copies.find((c) => c.id === e.target.value) ?? null)}>
        <option value="">Оберіть примірник</option>
        {book.data.copies.filter((c) => c.isAvailable).map((c) => <option key={c.id} value={c.id}>{c.inventoryNumber} · {CONDITION[c.condition]}</option>)}
      </select>
    </label>}
    {value && <p>Обрано примірник: {value.inventoryNumber}</p>}
  </div>;
}
