import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, ErrorBox, Field, Modal, Notice } from '../components/ui.jsx';
import { CATEGORY } from '../lib/format.js';
import { useAsync, useSubmit } from '../lib/hooks.js';
import { patterns } from '../lib/validation.js';

export default function ReaderFormModal({ reader, initialClassId = '', onClose, onSaved }) {
  const { isManager } = useAuth();
  const editing = Boolean(reader);
  const { data: classes } = useAsync(() => api.get('/api/v1/school-classes', { status: 'active' }), []);
  const [form, setForm] = useState({
    fullName: reader?.fullName ?? '',
    category: reader?.category ?? 'student',
    phone: reader?.phone ?? '+380',
    address: reader?.address ?? '',
    ticketType: reader?.ticketType ?? 'existing',
    ticketNumber: reader?.ticketNumber ?? '',
    classId: reader?.schoolClass?.id ?? initialClassId,
    ticketExpiresOn: reader?.ticketExpiresOn ?? '',
  });
  const [confirmNamesake, setConfirmNamesake] = useState(false);
  const [confirmTicketChange, setConfirmTicketChange] = useState(false);
  const [reason, setReason] = useState('');
  const student = form.category === 'student';
  const electronic = form.ticketType === 'electronic';

  const action = useCallback(async () => {
    if (!editing) {
      return api.post('/api/v1/readers', {
        fullName: form.fullName,
        category: form.category,
        phone: form.phone,
        address: form.address || null,
        ticketType: student && electronic ? 'electronic' : 'existing',
        ...(student && electronic ? {} : { ticketNumber: form.ticketNumber }),
        classId: student ? form.classId || null : null,
        ticketExpiresOn: student ? form.ticketExpiresOn : null,
        confirmNamesake,
      });
    }
    const changed = {};
    if (form.fullName !== reader.fullName) changed.fullName = form.fullName;
    if (form.category !== reader.category) changed.category = form.category;
    if (form.phone !== reader.phone) changed.phone = form.phone;
    if ((form.address || null) !== (reader.address || null)) changed.address = form.address || null;
    if (form.ticketNumber !== reader.ticketNumber) changed.ticketNumber = form.ticketNumber;
    if (student && form.classId !== (reader.schoolClass?.id ?? '')) changed.classId = form.classId || null;
    if (student && form.ticketExpiresOn !== (reader.ticketExpiresOn ?? '')) changed.ticketExpiresOn = form.ticketExpiresOn;
    if (form.category !== reader.category && !student) { changed.classId = null; changed.ticketExpiresOn = null; }
    return api.patch(`/api/v1/readers/${reader.id}`, { ...changed, version: reader.version, confirmNamesake, confirmTicketNumberChange: confirmTicketChange, reason });
  }, [form, editing, reader, student, electronic, confirmNamesake, confirmTicketChange, reason]);
  const { submit, busy, error } = useSubmit(action);
  const fields = error?.fields ?? {};
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  const namesakes = error?.code === 'NAMESAKE_WARNING' ? error.details?.matches : null;
  const ticketChangeWarning = error?.code === 'TICKET_NUMBER_CHANGE_CONFIRMATION_REQUIRED';
  const generic = error && !namesakes && !ticketChangeWarning && error.code !== 'VALIDATION_ERROR';

  return (
    <Modal title={editing ? 'Редагування читача' : 'Новий читач'} onClose={onClose} wide>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onSaved(r.data); }}>
        {generic && <ErrorBox error={error} />}
        {error?.code === 'VALIDATION_ERROR' && <Notice kind="error">Перевірте виділені поля.</Notice>}
        {namesakes && (
          <Notice kind="warn">
            Є читачі з таким самим ПІБ (повні тезки дозволені):
            <ul>
              {namesakes.map((m) => (
                <li key={m.id ?? m.readerId}>
                  <Link to={`/readers/${m.id ?? m.readerId}`} target="_blank">{m.fullName}</Link>, квиток {m.ticketNumber}{m.isArchived ? ' (архів)' : ''}
                </li>
              ))}
            </ul>
            <label className="check">
              <input type="checkbox" checked={confirmNamesake} onChange={(e) => setConfirmNamesake(e.target.checked)} />
              Це інша людина — зберегти
            </label>
          </Notice>
        )}
        {ticketChangeWarning && (
          <Notice kind="warn">
            Зміна номера вплине на пошук запису й відображення в історії. Підтвердіть правильність нового номера.
            <label className="check">
              <input type="checkbox" checked={confirmTicketChange} onChange={(e) => setConfirmTicketChange(e.target.checked)} />
              Підтверджую зміну номера
            </label>
          </Notice>
        )}
        <Field label="ПІБ" required error={fields.fullName}>
          {(id) => <input id={id} value={form.fullName} onChange={set('fullName')} required minLength={3} maxLength={200} pattern={patterns.personName} title="Вкажіть щонайменше прізвище та ім’я літерами" autoComplete="name" autoFocus />}
        </Field>
        <div className="grid2">
          <Field label="Категорія" required error={fields.category}>
            {(id) => (
              <select id={id} value={form.category} onChange={set('category')}>
                {Object.entries(CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label="Особистий телефон" required error={fields.phone} hint="Формат +380XXXXXXXXX без пробілів. Номер батьків не використовується.">
            {(id) => <input id={id} type="tel" value={form.phone} onChange={set('phone')} required pattern={patterns.phone} maxLength={13} title="Формат: +380XXXXXXXXX" autoComplete="tel" inputMode="tel" />}
          </Field>
        </div>
        {student && (
          <div className="grid2">
            <Field label="Клас" error={fields.classId} hint="Необов’язково. Учень без класу може отримувати окремі книги.">
              {(id) => (
                <select id={id} value={form.classId} onChange={set('classId')}>
                  <option value="">Не зазначено</option>
                  {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </Field>
            <Field label="Квиток чинний до" required error={fields.ticketExpiresOn} hint="За даними ліцею про завершення навчання.">
              {(id) => <input id={id} type="date" value={form.ticketExpiresOn} onChange={set('ticketExpiresOn')} required />}
            </Field>
          </div>
        )}
        {!editing && student && (
          <label className="check">
            <input type="checkbox" checked={electronic}
              onChange={(e) => setForm((f) => ({ ...f, ticketType: e.target.checked ? 'electronic' : 'existing' }))} />
            У учня немає квитка — сформувати електронний (номер E-… присвоїться автоматично)
          </label>
        )}
        {!(student && electronic && !editing) && (
          <Field label="Номер читацького квитка" required error={fields.ticketNumber}
            hint={editing && !isManager ? 'Змінити номер може лише завідувач.' : '1–32 символи: літери, цифри, дефіс, коса риска.'}>
            {(id) => <input id={id} value={form.ticketNumber} onChange={set('ticketNumber')} required pattern={electronic ? 'E-[0-9]{6}' : patterns.ticket} minLength={electronic ? 8 : 1} maxLength={32} title={electronic ? 'Формат електронного квитка: E-000000' : '1–32 літери, цифри, дефіс або /'} disabled={editing && !isManager} />}
          </Field>
        )}
        <Field label="Адреса" error={fields.address} hint="Необов’язково.">
          {(id) => <input id={id} value={form.address} onChange={set('address')} maxLength={500} autoComplete="street-address" />}
        </Field>
        {editing && form.ticketNumber !== reader.ticketNumber && (
          <Field label="Причина виправлення номера" required error={fields.reason}>
            {(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} />}
          </Field>
        )}
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy}>Зберегти</Button>
        </div>
      </form>
    </Modal>
  );
}
