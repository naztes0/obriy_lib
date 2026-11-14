import { useState } from 'react';
import api from '../api/client.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { CATEGORY } from '../lib/format.js';
import { ErrorBox } from './ui.jsx';

export default function ReaderPicker({ value, onChange }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const { data, error, loading, reload } = useAsync(
    () => api.get('/api/v1/readers', { q: debounced, pageSize: 8 }),
    [debounced],
  );

  return (
    <div>
      <input
        placeholder="ПІБ або номер квитка"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Пошук читача"
      />
      <ErrorBox error={error} onRetry={reload} />
      <div className="pick-list" aria-busy={loading}>
        {(data ?? []).map((reader) => {
          const disabled = reader.isArchived || reader.isBlocked;
          return (
            <button
              type="button"
              key={reader.id}
              aria-pressed={value?.id === reader.id}
              disabled={disabled}
              onClick={() => onChange(reader)}
            >
              <strong>{reader.fullName}</strong> · {reader.ticketNumber} · {CATEGORY[reader.category]}
              {reader.schoolClass ? `, ${reader.schoolClass.name}` : ''}
              {reader.isBlocked ? ' — заблокований' : ''}
              {reader.isArchived ? ' — в архіві' : ''}
            </button>
          );
        })}
        {!loading && data?.length === 0 && <div className="empty">Читачів не знайдено.</div>}
      </div>
    </div>
  );
}
