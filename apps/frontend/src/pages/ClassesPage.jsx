import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import ActionModal from '../components/ActionModal.jsx';
import api from '../api/client.js';
import { Badge, Button, Empty, ErrorBox, Field, Modal, Notice, PageHeader, Spinner } from '../components/ui.jsx';
import { useAsync, useSubmit } from '../lib/hooks.js';
import { patterns } from '../lib/validation.js';

function ClassModal({ schoolClass, onClose, onDone }) {
  const [name, setName] = useState(schoolClass?.name ?? '');
  const action = useCallback(
    () => (schoolClass
      ? api.patch(`/api/v1/school-classes/${schoolClass.id}`, { name })
      : api.post('/api/v1/school-classes', { name })),
    [schoolClass, name],
  );
  const { submit, busy, error } = useSubmit(action);
  return (
    <Modal title={schoolClass ? 'Перейменувати клас' : 'Новий клас'} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(); }}>
        <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
        <Field label="Назва класу" required error={error?.fields?.name} hint="Наприклад: 7-А. До 64 символів.">
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required pattern={patterns.className} minLength={1} maxLength={64} title="До 64 літер, цифр, пробілів, крапок або дефісів" autoFocus />}
        </Field>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>Зберегти</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ClassesPage() {
  const [status, setStatus] = useState('active');
  const { data, error, loading, reload } = useAsync(() => api.get('/api/v1/school-classes', { status }), [status]);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const [toggleError, setToggleError] = useState(null);

  async function toggle(schoolClass) {
    setToggleError(null);
    try {
      await api.patch(`/api/v1/school-classes/${schoolClass.id}/activity`, { isActive: !schoolClass.isActive });
      setFlash(schoolClass.isActive ? 'Клас деактивовано.' : 'Клас активовано.');
      reload();
    } catch (caught) {
      setToggleError(caught);
    }
  }

  return (
    <>
      <PageHeader title="Класи" actions={<Button variant="primary" onClick={() => setModal({})}>+ Новий клас</Button>} />
      {flash && <Notice kind="ok">{flash}</Notice>}
      <div className="toolbar">
        <Field label="Показати">
          {(id) => (
            <select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Активні</option>
              <option value="inactive">Неактивні</option>
              <option value="all">Усі</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorBox error={error ?? toggleError} onRetry={reload} />
      {loading && !data ? <Spinner /> : data?.length === 0 ? <Empty>Класів немає.</Empty> : (
        <table>
          <thead><tr><th>Клас</th><th>Стан</th><th>Дії</th></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td><Link to={`/classes/${c.id}`}><strong>{c.name}</strong></Link></td>
                <td>{c.isActive ? <Badge kind="ok">Активний</Badge> : <Badge>Неактивний</Badge>}</td>
                <td>
                  <div className="actions">
                    <Button small onClick={() => setModal(c)}>Перейменувати</Button>
                    <Button small onClick={() => toggle(c)}>{c.isActive ? 'Деактивувати' : 'Активувати'}</Button>
                    <Button small variant="danger" onClick={() => setModal({type:'delete',schoolClass:c})}>Вилучити</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal?.type === 'delete' && <ActionModal title={`Вилучити клас ${modal.schoolClass.name}`} description="Можливо лише без пов’язаних записів. Картки учнів та історію видач не буде видалено." required={false} submitLabel="Вилучити клас" danger
        run={() => api.post(`/api/v1/school-classes/${modal.schoolClass.id}/delete`,{confirm:true})} onClose={() => setModal(null)} onDone={() => {setModal(null);setFlash('Клас вилучено.');reload();}} />}
      {modal && modal.type !== 'delete' && (
        <ClassModal
          schoolClass={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); setFlash('Збережено.'); reload(); }}
        />
      )}
    </>
  );
}
