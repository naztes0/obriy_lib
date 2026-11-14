import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Badge, Button, ErrorBox, Field, Modal, Notice, PageHeader, Spinner } from '../components/ui.jsx';
import { ROLE, formatDateTime } from '../lib/format.js';
import { useAsync, useSubmit } from '../lib/hooks.js';

function FormModal({ title, onClose, onDone, run, children, canSubmit, submitLabel = 'Зберегти', error, busy, submit }) {
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(); }}>
        <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
        {children}
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!canSubmit}>{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateModal({ onClose, onDone }) {
  const [form, setForm] = useState({ login: '', displayName: '', password: '' });
  const action = useCallback(() => api.post('/api/v1/staff', form), [form]);
  const { submit, busy, error } = useSubmit(action);
  const f = error?.fields ?? {};
  const set = (n) => (e) => setForm({ ...form, [n]: e.target.value });
  return (
    <FormModal title="Новий бібліотекар" onClose={onClose} onDone={onDone} submit={submit} busy={busy} error={error}
      canSubmit={form.login && form.displayName && form.password} submitLabel="Створити">
      <Field label="Логін" required error={f.login} hint="3–64 символи: латинські літери, цифри, . _ -">
        {(id) => <input id={id} value={form.login} onChange={set('login')} autoFocus autoComplete="off" />}
      </Field>
      <Field label="Ім’я для відображення" required error={f.displayName}>
        {(id) => <input id={id} value={form.displayName} onChange={set('displayName')} />}
      </Field>
      <Field label="Початковий пароль" required error={f.password} hint="8–128 символів. Передайте його працівнику безпечним способом.">
        {(id) => <input id={id} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />}
      </Field>
    </FormModal>
  );
}

function ResetPasswordModal({ account, onClose, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const action = useCallback(() => api.patch(`/api/v1/staff/${account.id}/password`, { newPassword }), [account, newPassword]);
  const { submit, busy, error } = useSubmit(action);
  return (
    <FormModal title={`Скинути пароль · ${account.login}`} onClose={onClose} onDone={onDone} submit={submit} busy={busy} error={error}
      canSubmit={newPassword} submitLabel="Встановити пароль">
      <Field label="Новий пароль" required error={error?.fields?.newPassword} hint="8–128 символів.">
        {(id) => <input id={id} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus autoComplete="new-password" />}
      </Field>
    </FormModal>
  );
}

function OwnPasswordModal({ onClose, onDone }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const action = useCallback(() => api.patch('/api/v1/staff/me/password', form), [form]);
  const { submit, busy, error } = useSubmit(action);
  const f = error?.fields ?? {};
  return (
    <FormModal title="Змінити мій пароль" onClose={onClose} onDone={onDone} submit={submit} busy={busy} error={error}
      canSubmit={form.currentPassword && form.newPassword}>
      <Field label="Поточний пароль" required error={f.currentPassword}>
        {(id) => <input id={id} type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoFocus autoComplete="current-password" />}
      </Field>
      <Field label="Новий пароль" required error={f.newPassword} hint="8–128 символів.">
        {(id) => <input id={id} type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />}
      </Field>
    </FormModal>
  );
}

export default function StaffPage() {
  const { staff: me } = useAuth();
  const { data, error, loading, reload } = useAsync(() => api.get('/api/v1/staff'), []);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const [actionError, setActionError] = useState(null);
  const close = () => setModal(null);
  const done = (message) => () => { close(); setFlash(message); reload(); };

  async function toggle(account) {
    setActionError(null);
    try {
      await api.patch(`/api/v1/staff/${account.id}/activity`, { isActive: !account.isActive });
      setFlash(account.isActive ? 'Обліковий запис заблоковано.' : 'Обліковий запис розблоковано.');
      reload();
    } catch (caught) {
      setActionError(caught);
    }
  }

  return (
    <>
      <PageHeader
        title="Працівники"
        actions={
          <>
            <Button onClick={() => setModal({ type: 'ownPassword' })}>Змінити мій пароль</Button>
            <Button variant="primary" onClick={() => setModal({ type: 'create' })}>+ Новий бібліотекар</Button>
          </>
        }
      />
      {flash && <Notice kind="ok">{flash}</Notice>}
      <ErrorBox error={error ?? actionError} onRetry={reload} />
      {loading && !data ? <Spinner /> : (
        <table>
          <thead><tr><th>Логін</th><th>Ім’я</th><th>Роль</th><th>Створено</th><th>Стан</th><th>Дії</th></tr></thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id} className={a.isActive ? '' : 'row-muted'}>
                <td><strong>{a.login}</strong>{a.id === me.id && ' (ви)'}</td>
                <td>{a.displayName}</td>
                <td>{ROLE[a.role]}</td>
                <td>{formatDateTime(a.createdAt)}</td>
                <td>{a.isActive ? <Badge kind="ok">Активний</Badge> : <Badge kind="danger">Заблоковано</Badge>}</td>
                <td>
                  {a.role === 'librarian' && (
                    <div className="actions">
                      <Button small onClick={() => toggle(a)}>{a.isActive ? 'Заблокувати' : 'Розблокувати'}</Button>
                      <Button small onClick={() => setModal({ type: 'reset', account: a })}>Скинути пароль</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal?.type === 'create' && <CreateModal onClose={close} onDone={done('Бібліотекара створено.')} />}
      {modal?.type === 'reset' && <ResetPasswordModal account={modal.account} onClose={close} onDone={done('Пароль змінено.')} />}
      {modal?.type === 'ownPassword' && <OwnPasswordModal onClose={close} onDone={done('Ваш пароль змінено.')} />}
    </>
  );
}
