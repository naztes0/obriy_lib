import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { Badge, Button, ErrorBox, Field, Notice, PageHeader, Spinner } from '../components/ui.jsx';
import { CONDITION, formatDate, todayKyiv } from '../lib/format.js';
import { useAsync, useDebounced, useSubmit } from '../lib/hooks.js';

const MAX_BATCH = 500;
const byInventory = (a, b) => a.inventoryNumber.localeCompare(b.inventoryNumber, 'uk', { numeric: true });

async function fetchClassStudents(classId) {
  const students = [];
  let page = 1;
  let totalPages = 1;
  do {
    const { data, meta } = await api.get('/api/v1/readers', { archived: 'active', page, pageSize: 100 });
    students.push(...data.filter((r) => r.category === 'student' && r.schoolClass?.id === classId));
    totalPages = meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  students.sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk'));
  return { data: students };
}

function TextbookPicker({ selectedIds, onAdd }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);
  const [busyId, setBusyId] = useState(null);
  const [addError, setAddError] = useState(null);
  const { data, error, loading, reload } = useAsync(() => api.get('/api/v1/books', { title: debounced, pageSize: 50 }), [debounced]);
  const textbooks = (data ?? []).filter((b) => b.isTextbook && !selectedIds.includes(b.id));

  async function add(book) {
    setBusyId(book.id);
    setAddError(null);
    try {
      const { data: full } = await api.get(`/api/v1/books/${book.id}`);
      onAdd({
        id: full.id,
        title: full.title,
        copies: full.copies.filter((c) => c.isAvailable).sort(byInventory),
      });
    } catch (caught) {
      setAddError(caught);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <input placeholder="Пошук підручника за назвою" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Пошук підручника" />
      <ErrorBox error={error ?? addError} onRetry={reload} />
      <div className="pick-list" aria-busy={loading}>
        {textbooks.map((b) => (
          <button type="button" key={b.id} disabled={busyId === b.id || b.availableCopies === 0} onClick={() => add(b)}>
            <strong>{b.title}</strong> · {b.authors.map((a) => a.name ?? a).join(', ')} · доступно {b.availableCopies}
          </button>
        ))}
        {!loading && textbooks.length === 0 && <div className="empty">Підручників (з ознакою «Підручник») не знайдено.</div>}
      </div>
    </div>
  );
}

function ConfirmBar({ payload, onResult, onStale }) {
  const action = useCallback((key) => api.post('/api/v1/textbook-issue-batches', payload, key), [payload]);
  const { submit, busy, error } = useSubmit(action);

  useEffect(() => {
    if (error?.code === 'BATCH_VALIDATION_FAILED' && error.details) onStale(error.details);
  }, [error, onStale]);

  const handled = error && ['BATCH_VALIDATION_FAILED', 'BATCH_STATE_CHANGED'].includes(error.code);
  return (
    <>
      {handled && <Notice kind="warn">{error.message} Перевірте таблицю й підтвердіть ще раз.</Notice>}
      {error && !handled && <ErrorBox error={error} />}
      <Button
        variant="primary"
        busy={busy}
        onClick={async () => { const r = await submit(); if (r) onResult(r.data); }}
      >
        Підтвердити видачу ({payload.items.length})
      </Button>
    </>
  );
}

export default function BatchIssuePage() {
  const [classId, setClassId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selected, setSelected] = useState({});
  const [books, setBooks] = useState([]);
  const [assign, setAssign] = useState({});
  const [excluded, setExcluded] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const classes = useAsync(() => api.get('/api/v1/school-classes', { status: 'active' }), []);
  const students = useAsync(() => (classId ? fetchClassStudents(classId) : Promise.resolve({ data: [] })), [classId]);

  useEffect(() => {
    const next = {};
    for (const s of students.data ?? []) next[s.id] = !s.isBlocked && Date.parse(s.ticketExpiresOn ?? '9999-12-31') >= Date.parse(todayKyiv());
    setSelected(next);
    setAssign({});
    setExcluded({});
    setPreview(null);
  }, [students.data]);

  const rows = useMemo(() => {
    const list = [];
    for (const book of books) {
      for (const student of students.data ?? []) {
        if (!selected[student.id]) continue;
        const key = `${student.id}:${book.id}`;
        list.push({ key, student, book, copyId: assign[key] ?? '', excluded: Boolean(excluded[key]) });
      }
    }
    return list;
  }, [books, students.data, selected, assign, excluded]);

  const activeRows = rows.filter((r) => !r.excluded);
  const unassigned = activeRows.filter((r) => !r.copyId).length;
  const tooMany = activeRows.length > MAX_BATCH;
  const usedCopies = new Set(activeRows.map((r) => r.copyId).filter(Boolean));

  const invalidate = () => setPreview(null);

  function autoAssign() {
    const next = { ...assign };
    for (const book of books) {
      const taken = new Set(Object.entries(next).filter(([k]) => !k.endsWith(`:${book.id}`)).map(([, v]) => v));
      const pool = book.copies.filter((c) => !taken.has(c.id));
      let i = 0;
      for (const r of rows.filter((x) => x.book.id === book.id && !x.excluded)) {
        next[r.key] = pool[i]?.id ?? '';
        i += 1;
      }
    }
    setAssign(next);
    invalidate();
  }

  const previewAction = useCallback(
    async (_key, rowsToCheck) => {
      const res = await api.post('/api/v1/textbook-issue-batches/preview', {
        classId,
        dueDate,
        items: rowsToCheck.map((r) => ({ readerId: r.student.id, copyId: r.copyId })),
      });
      setPreview({ data: res.data, rows: rowsToCheck });
      return res;
    },
    [classId, dueDate],
  );
  const { submit: runPreview, busy: previewing, error: previewError } = useSubmit(previewAction);

  function excludeRow(key) {
    const nextExcluded = { ...excluded, [key]: true };
    setExcluded(nextExcluded);
    const remaining = rows.filter((r) => !nextExcluded[r.key]);
    if (remaining.length && remaining.every((r) => r.copyId)) runPreview(remaining);
    else setPreview(null);
  }

  const canPreview = classId && dueDate && activeRows.length > 0 && unassigned === 0 && !tooMany;
  const payload = useMemo(
    () => preview && {
      classId,
      dueDate,
      items: preview.rows.map((r) => ({ readerId: r.student.id, copyId: r.copyId })),
    },
    [preview, classId, dueDate],
  );
  const signature = payload ? JSON.stringify(payload) : '';

  function reset() {
    setResult(null); setPreview(null); setBooks([]); setAssign({}); setExcluded({}); setClassId(''); setDueDate('');
  }

  if (result) {
    return (
      <>
        <PageHeader title="Масова видача оформлена" />
        {result.wasRepeated && <Notice kind="info">Цей самий пакет уже було збережено раніше — дублікатів не створено.</Notice>}
        <Notice kind="ok">Пакет №{result.id}, клас {result.className}: створено видач — {result.issueCount}.</Notice>
        <table>
          <thead><tr><th>Учень</th><th>Квиток</th><th>Видання</th><th>Інв. №</th><th>Строк</th></tr></thead>
          <tbody>
            {result.loans.map((l) => (
              <tr key={l.id}>
                <td><Link to={`/readers/${l.reader.id}`}>{l.reader.fullName ?? `Читач №${l.reader.id}`}</Link></td>
                <td>{l.reader.ticketNumber}</td>
                <td>{l.book.title}</td>
                <td>{l.copy.inventoryNumber}</td>
                <td>{formatDate(l.currentDueDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Повернення виконуються окремо для кожного примірника (картка читача → «Повернення»).</p>
        <Button variant="primary" onClick={reset}>Нова масова видача</Button>
      </>
    );
  }

  return (
    <>
      <div className="crumbs"><Link to="/loans">← Видачі</Link></div>
      <PageHeader title="Масова видача підручників класу" />

      <div className="card">
        <h2>1. Клас і строк</h2>
        <ErrorBox error={classes.error} onRetry={classes.reload} />
        <div className="toolbar">
          <Field label="Клас" required>
            {(id) => (
              <select id={id} value={classId} onChange={(e) => { setClassId(e.target.value); setBooks([]); }}>
                <option value="">— оберіть клас —</option>
                {(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Спільна дата повернення" required hint="Не пізніше закінчення квитка учня.">
            {(id) => <input id={id} type="date" min={todayKyiv()} value={dueDate} onChange={(e) => { setDueDate(e.target.value); invalidate(); }} />}
          </Field>
        </div>
      </div>

      {classId && (
        <div className="card">
          <h2>2. Учні</h2>
          <ErrorBox error={students.error} onRetry={students.reload} />
          {students.loading ? <Spinner label="Завантажуємо учнів класу…" /> : (students.data ?? []).length === 0 ? (
            <p className="row-muted">У цьому класі немає активних учнів.</p>
          ) : (
            <>
              <div className="actions" style={{ marginBottom: 8 }}>
                <Button small onClick={() => { setSelected(Object.fromEntries(students.data.map((s) => [s.id, !s.isBlocked]))); invalidate(); }}>Обрати всіх, крім заблокованих</Button>
                <Button small onClick={() => { setSelected({}); invalidate(); }}>Зняти всі</Button>
              </div>
              <table>
                <thead><tr><th /><th>ПІБ</th><th>Квиток</th><th>Квиток до</th><th>Примітка</th></tr></thead>
                <tbody>
                  {students.data.map((s) => (
                    <tr key={s.id}>
                      <td><input type="checkbox" checked={Boolean(selected[s.id])} aria-label={`Обрати ${s.fullName}`}
                        onChange={(e) => { setSelected({ ...selected, [s.id]: e.target.checked }); invalidate(); }} /></td>
                      <td>{s.fullName}</td>
                      <td>{s.ticketNumber}</td>
                      <td>{formatDate(s.ticketExpiresOn)}</td>
                      <td>{s.isBlocked && <Badge kind="danger">Заблоковано</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {classId && (
        <div className="card">
          <h2>3. Підручники</h2>
          {books.map((b) => (
            <p key={b.id}>
              <strong>{b.title}</strong> — доступних примірників: {b.copies.length}{' '}
              <Button small onClick={() => { setBooks(books.filter((x) => x.id !== b.id)); invalidate(); }}>Прибрати</Button>
            </p>
          ))}
          <TextbookPicker selectedIds={books.map((b) => b.id)} onAdd={(b) => { setBooks([...books, b]); invalidate(); }} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <h2>4. Призначення примірників</h2>
          <div className="actions" style={{ marginBottom: 8 }}>
            <Button onClick={autoAssign}>Призначити автоматично</Button>
          </div>
          {tooMany && <Notice kind="error">Один пакет — до {MAX_BATCH} видач, зараз {activeRows.length}. Зніміть позначки з частини учнів і оформіть клас кількома пакетами.</Notice>}
          <table>
            <thead><tr><th>Учень</th><th>Видання</th><th>Примірник</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.excluded ? 'row-muted' : ''}>
                  <td>{r.student.fullName}</td>
                  <td>{r.book.title}</td>
                  <td>
                    <select aria-label={`Примірник для ${r.student.fullName}`} value={r.copyId} disabled={r.excluded}
                      onChange={(e) => { setAssign({ ...assign, [r.key]: e.target.value }); invalidate(); }}>
                      <option value="">— не призначено —</option>
                      {r.book.copies.filter((c) => c.id === r.copyId || !usedCopies.has(c.id)).map((c) => (
                        <option key={c.id} value={c.id}>{c.inventoryNumber} ({CONDITION[c.condition]})</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {r.excluded
                      ? <Button small onClick={() => { setExcluded({ ...excluded, [r.key]: false }); invalidate(); }}>Повернути</Button>
                      : <Button small onClick={() => { setExcluded({ ...excluded, [r.key]: true }); invalidate(); }}>Виключити</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {unassigned > 0 && <p className="field__hint">Не призначено примірників: {unassigned}. Примірників може не вистачати — тоді виключіть учнів або зменште набір.</p>}
          <div style={{ marginTop: 12 }}>
            <ErrorBox error={previewError} />
            <Button variant="primary" busy={previewing} disabled={!canPreview} onClick={() => runPreview(activeRows)}>
              Перевірити пакет
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="card">
          <h2>5. Попередній перегляд</h2>
          <Notice kind={preview.data.canConfirm ? 'ok' : 'warn'}>
            Клас {preview.data.schoolClass.name}, дата видачі {formatDate(preview.data.issueDate)}, повернення до {formatDate(preview.data.dueDate)}.
            Рядків: {preview.data.totalItems}, коректних: {preview.data.validItems}, з помилками: {preview.data.invalidItems}.
            {preview.data.canConfirm ? ' Пакет можна підтвердити.' : ' Виправте або виключіть проблемні рядки.'}
          </Notice>
          <table>
            <thead><tr><th>Учень</th><th>Квиток</th><th>Видання</th><th>Примірник</th><th>Стан</th><th>Строк</th><th>Результат</th></tr></thead>
            <tbody>
              {preview.data.items.map((item) => {
                const row = preview.rows[item.index];
                return (
                  <tr key={item.index}>
                    <td>{item.reader.fullName ?? '—'}</td>
                    <td>{item.reader.ticketNumber ?? '—'}</td>
                    <td>{item.book?.title ?? '—'}</td>
                    <td>{item.copy.inventoryNumber ?? '—'}</td>
                    <td>{item.copy.condition ? CONDITION[item.copy.condition] : '—'}</td>
                    <td>{formatDate(item.dueDate)}</td>
                    <td>
                      {item.isValid ? <Badge kind="ok">Готово</Badge> : (
                        <>
                          {item.errors.map((e) => <div key={e.code}><Badge kind="danger">{e.message}</Badge></div>)}
                          {row && <Button small onClick={() => excludeRow(row.key)}>Виключити рядок</Button>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="field__hint">Підтвердження зберігає пакет повністю або не зберігає жодної видачі. Сервер перевіряє всі рядки ще раз.</p>
          {preview.data.canConfirm && (
            <ConfirmBar
              key={signature}
              payload={payload}
              onResult={setResult}
              onStale={(details) => setPreview((p) => (p ? { ...p, data: details } : p))}
            />
          )}
        </div>
      )}
    </>
  );
}
