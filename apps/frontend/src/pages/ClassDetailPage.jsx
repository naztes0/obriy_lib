import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client.js';
import { Badge, Button, Empty, ErrorBox, Field, Modal, Notice, PageHeader, Pagination, Spinner } from '../components/ui.jsx';
import { formatDate, todayKyiv } from '../lib/format.js';
import { useAsync, useDebounced, useSubmit } from '../lib/hooks.js';
import ReaderFormModal from './ReaderFormModal.jsx';

function MembershipModal({ reader: initialReader, schoolClass, classes, onClose, onDone }) {
  const fresh = useAsync(() => api.get(`/api/v1/readers/${initialReader.id}`), [initialReader.id]);
  const reader = fresh.data ?? initialReader;
  const [target, setTarget] = useState(schoolClass.id);
  const action = useCallback(() => api.patch(`/api/v1/readers/${reader.id}`, {
    classId: target || null, version: reader.version,
  }), [reader, target]);
  const { submit, busy, error } = useSubmit(action);
  return (
    <Modal title="Змінити клас учня" onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); const result = await submit(); if (result) onDone(); }}>
        <p><strong>{reader.fullName}</strong> · квиток {reader.ticketNumber}</p>
        <p>Поточний клас: {reader.schoolClass?.name ?? 'Не зазначено'}. Картка, видачі та історичні назви класів у видачах зберігаються.</p>
        <ErrorBox error={error ?? fresh.error} onRetry={fresh.reload} />
        <Field label="Новий клас">
          {(id) => <select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Без класу</option>
            {classes.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>}
        </Field>
        {!target && <Notice kind="info">Учня буде прибрано лише зі списку класу. Його читацьку картку не буде видалено.</Notice>}
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={fresh.loading || Boolean(fresh.error) || target === (reader.schoolClass?.id ?? '')}>Підтвердити</Button>
        </div>
      </form>
    </Modal>
  );
}

function ExistingStudentModal({ schoolClass, classes, onClose, onDone }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const debounced = useDebounced(query);
  const { data, meta, loading, error, reload } = useAsync(() => api.get('/api/v1/readers', {
    category: 'student', archived: 'active', q: debounced, page, pageSize: 25,
  }), [debounced, page]);
  if (selected) return <MembershipModal reader={selected} schoolClass={schoolClass} classes={classes} onClose={() => setSelected(null)} onDone={onDone} />;
  return (
    <Modal title={`Додати наявного учня до ${schoolClass.name}`} onClose={onClose} wide>
      <p>Оберіть читацьку картку. Якщо учень уже має клас, підтвердьте переведення — нова картка не створюється.</p>
      <Field label="Пошук учня">{(id) => <input id={id} placeholder="ПІБ або номер квитка" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />}</Field>
      <ErrorBox error={error} onRetry={reload} />
      {loading ? <Spinner /> : data?.length === 0 ? <Empty>Учнів не знайдено.</Empty> : <table>
        <thead><tr><th>Учень</th><th>Квиток</th><th>Поточний клас</th><th>Дія</th></tr></thead>
        <tbody>{(data ?? []).map((r) => <tr key={r.id}>
          <td>{r.fullName}</td><td>{r.ticketNumber}</td><td>{r.schoolClass?.name ?? 'Не зазначено'}</td>
          <td><Button small disabled={r.schoolClass?.id === schoolClass.id} onClick={() => setSelected(r)}>{r.schoolClass?.id === schoolClass.id ? 'У цьому класі' : 'Обрати'}</Button></td>
        </tr>)}</tbody>
      </table>}
      <Pagination meta={meta} onPage={setPage} />
    </Modal>
  );
}

export default function ClassDetailPage() {
  const { classId } = useParams();
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState('active');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const debounced = useDebounced(query);
  const classes = useAsync(() => api.get('/api/v1/school-classes', { status: 'all' }), []);
  const students = useAsync(() => api.get('/api/v1/readers', {
    classId, category: 'student', archived, q: debounced, page, pageSize: 25,
  }), [classId, archived, debounced, page]);
  const schoolClass = classes.data?.find((c) => c.id === classId);
  const done = (message) => { setModal(null); setFlash(message); students.reload(); };
  if (classes.loading) return <Spinner />;
  if (classes.error) return <ErrorBox error={classes.error} onRetry={classes.reload} />;
  if (!schoolClass) return <><PageHeader title="Клас не знайдено" /><Link to="/classes">До списку класів</Link></>;
  return (
    <>
      <div className="crumbs"><Link to="/classes">← Класи</Link></div>
      <PageHeader title={`Клас ${schoolClass.name}`} actions={schoolClass.isActive && <>
        <Button variant="primary" onClick={() => setModal({ type: 'new' })}>+ Новий учень</Button>
        <Button onClick={() => setModal({ type: 'existing' })}>Додати наявного читача</Button>
        <Link className="btn" to={`/loans/batch?classId=${classId}`}>Видати підручники класу</Link>
      </>} />
      {!schoolClass.isActive && <Notice kind="warn">Клас неактивний. Можна переглядати учнів і переводити їх до іншого класу.</Notice>}
      {flash && <Notice kind="ok">{flash}</Notice>}
      <div className="toolbar">
        <Field label="Пошук учня">{(id) => <input id={id} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="ПІБ або номер квитка" />}</Field>
        <Field label="Картки">{(id) => <select id={id} value={archived} onChange={(e) => { setArchived(e.target.value); setPage(1); }}>
          <option value="active">Активні</option><option value="archived">Архівні</option><option value="all">Усі</option>
        </select>}</Field>
      </div>
      <ErrorBox error={students.error} onRetry={students.reload} />
      {students.loading ? <Spinner /> : students.data?.length === 0 ? <Empty>За цими умовами учнів немає. Додайте нового учня або оберіть наявного читача.</Empty> : <table>
        <thead><tr><th>Учень</th><th>Квиток</th><th>Чинний до</th><th>Стан</th><th>Дії</th></tr></thead>
        <tbody>{(students.data ?? []).map((r) => <tr key={r.id}>
          <td><Link to={`/readers/${r.id}`}>{r.fullName}</Link></td><td>{r.ticketNumber}</td><td>{formatDate(r.ticketExpiresOn)}</td>
          <td>{r.isArchived && <Badge>Архів</Badge>} {r.isBlocked && <Badge kind="danger">Заблоковано</Badge>} {r.ticketExpiresOn < todayKyiv() && <Badge kind="warn">Квиток завершився</Badge>}</td>
          <td><Button small disabled={r.isArchived} onClick={() => setModal({ type: 'move', reader: r })}>Змінити клас</Button></td>
        </tr>)}</tbody>
      </table>}
      <Pagination meta={students.meta} onPage={setPage} />
      {modal?.type === 'new' && <ReaderFormModal initialClassId={classId} onClose={() => setModal(null)} onSaved={() => done('Учня зареєстровано.')} />}
      {modal?.type === 'existing' && <ExistingStudentModal schoolClass={schoolClass} classes={classes.data} onClose={() => setModal(null)} onDone={() => done('Клас учня оновлено.')} />}
      {modal?.type === 'move' && <MembershipModal reader={modal.reader} schoolClass={schoolClass} classes={classes.data} onClose={() => setModal(null)} onDone={() => done('Клас учня оновлено. Картка й історія збережені.')} />}
    </>
  );
}
