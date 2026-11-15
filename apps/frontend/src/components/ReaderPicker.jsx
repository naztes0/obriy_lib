import { useEffect, useRef, useState } from 'react';
import api from '../api/client.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { CATEGORY, todayKyiv } from '../lib/format.js';
import { ErrorBox, Pagination } from './ui.jsx';

export default function ReaderPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const debounced = useDebounced(query);
  const { data, meta, error, loading, reload } = useAsync(
    () => api.get('/api/v1/readers', { q: debounced, page, pageSize: 8 }),
    [debounced, page],
  );

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const changeReader = () => {
    setQuery('');
    setPage(1);
    onChange(null);
    setOpen(true);
  };

  return (
    <div className="reader-picker" ref={rootRef}>
      <div className="reader-picker__control">
      <input
        placeholder="ПІБ або номер квитка"
        value={query}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
        onChange={(e) => { setQuery(e.target.value); setPage(1); setOpen(true); }}
        aria-label="Пошук читача"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
      />
      {value && <button className="btn btn--small" type="button" onClick={changeReader}>Змінити</button>}
      </div>
      {open && <div className="reader-picker__dropdown">
        <ErrorBox error={error} onRetry={reload} />
        <div className="pick-list" aria-busy={loading}>
          {(data ?? []).map((reader) => {
            const expired = reader.category === 'student' && reader.ticketExpiresOn < todayKyiv();
            const ended = reader.employmentEndedOn && reader.employmentEndedOn <= todayKyiv();
            const disabled = loading || reader.isArchived || reader.isBlocked || expired || ended;
            return (
              <button
                type="button"
                key={reader.id}
                aria-pressed={value?.id === reader.id}
                disabled={disabled}
                onClick={() => { onChange(reader); setQuery(reader.fullName); setOpen(false); }}
              >
                <strong>{reader.fullName}</strong> · {reader.ticketNumber} · {CATEGORY[reader.category]}
                {reader.schoolClass ? `, ${reader.schoolClass.name}` : ''}
                {reader.isBlocked ? ' — заблокований' : ''}
                {reader.isArchived ? ' — в архіві' : ''}
                {expired ? ' — квиток завершився' : ''}
                {ended ? ' — роботу в ліцеї завершено' : ''}
              </button>
            );
          })}
          {!loading && data?.length === 0 && <div className="empty">Читачів не знайдено.</div>}
        </div>
        <Pagination meta={meta} onPage={setPage} />
      </div>}
    </div>
  );
}
