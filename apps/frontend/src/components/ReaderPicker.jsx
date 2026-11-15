import { useState } from 'react';
import api from '../api/client.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { CATEGORY, todayKyiv } from '../lib/format.js';
import { ErrorBox, Pagination } from './ui.jsx';

export default function ReaderPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(!value);
  const debounced = useDebounced(query);
  const { data, meta, error, loading, reload } = useAsync(
    () => api.get('/api/v1/readers', { q: debounced, page, pageSize: 8 }),
    [debounced, page],
  );

  return (
    <div>
      <div className="reader-picker__control">
      <input
        placeholder="ПІБ або номер квитка"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setPage(1); setOpen(true); }}
        aria-label="Пошук читача"
      />
      {value && <button className="btn btn--small" type="button" onClick={() => setOpen((v) => !v)}>{open ? 'Згорнути' : 'Змінити'}</button>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {open && <div className="pick-list" aria-busy={loading}>
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
      </div>}
      {open && <Pagination meta={meta} onPage={setPage} />}
    </div>
  );
}
