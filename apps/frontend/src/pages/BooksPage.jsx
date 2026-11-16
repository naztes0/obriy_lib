import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { Button, Empty, ErrorBox, Field, PageHeader, Pagination, Spinner, Badge } from '../components/ui.jsx';
import { useAsync, useDebounced } from '../lib/hooks.js';
import BookFormModal from './BookFormModal.jsx';

export default function BooksPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ title: '', author: '', publisher: '', archived: 'active' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(filters);

  const { data, meta, error, loading, reload } = useAsync(
    () => api.get('/api/v1/books', { ...debounced, page, pageSize: 25 }),
    [debounced, page],
  );

  const set = (name) => (e) => {
    setPage(1);
    setFilters((f) => ({ ...f, [name]: e.target.value }));
  };

  return (
    <>
      <PageHeader title="Каталог" actions={<Button variant="primary" onClick={() => setCreating(true)}>+ Нова книга</Button>} />
      <div className="toolbar">
        <Field label="Назва">{(id) => <input id={id} value={filters.title} onChange={set('title')} placeholder="Фрагмент назви" />}</Field>
        <Field label="Автор">{(id) => <input id={id} value={filters.author} onChange={set('author')} placeholder="Фрагмент імені" />}</Field>
        <Field label="Видавництво">{(id) => <input id={id} value={filters.publisher} onChange={set('publisher')} />}</Field>
        <Field label="Архів">
          {(id) => (
            <select id={id} value={filters.archived} onChange={set('archived')}>
              <option value="active">Активні</option>
              <option value="archived">Архівні</option>
              <option value="all">Усі</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : data?.length === 0 ? (
        <Empty>За цими умовами книг не знайдено.</Empty>
      ) : (
        <table>
          <thead>
            <tr><th>Назва</th><th>Автори</th><th>Видавництво</th><th>Рік</th><th>Примірники</th></tr>
          </thead>
          <tbody>
            {(data ?? []).map((book) => (
              <tr key={book.id} className={book.isArchived ? 'row-muted' : ''}>
                <td>
                  <Link to={`/books/${book.id}`}>{book.title}</Link>{' '}
                  {book.isTextbook && <Badge kind="info">Підручник</Badge>}{' '}
                  {book.isArchived && <Badge>Архів</Badge>}
                </td>
                <td>{book.authors.map((a) => a.name ?? a).join(', ')}</td>
                <td>{book.publisher}</td>
                <td>{book.publicationYear ?? 'Не встановлено'}</td>
                <td className="nowrap">доступно {book.availableCopies} з {book.totalCopies}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination meta={meta} onPage={setPage} />
      {creating && (
        <BookFormModal
          onClose={() => setCreating(false)}
          onSaved={(book) => {
            setCreating(false);
            navigate(`/books/${book.id}`);
          }}
        />
      )}
    </>
  );
}
