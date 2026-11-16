import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';
import ReaderPicker from './ReaderPicker.jsx';
import CopyPicker from './CopyPicker.jsx';
import { Button, ErrorBox, Field, Modal } from './ui.jsx';

export default function CorrectParticipantsModal({ loan, onClose, onDone }) {
  const [reader, setReader] = useState(null);
  const [copy, setCopy] = useState(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const action = useCallback((key) => api.post(`/api/v1/loans/${loan.id}/correct-participants`, {
    version: loan.version, readerId: reader?.id, copyId: copy?.id, reason, confirm,
  }, key), [loan,reader,copy,reason,confirm]);
  const { submit, busy, error } = useSubmit(action);
  return <Modal title="Виправити учасників видачі" onClose={onClose} busy={busy} wide>
    <form onSubmit={async (e) => { e.preventDefault(); if (await submit()) onDone(); }}>
      <p>Було: {loan.reader.fullName} · квиток {loan.reader.ticketNumber}; примірник {loan.copy.inventoryNumber}. Змініть читача, примірник або обидва записи. Старі посилання залишаться в аудиті.</p>
      <ErrorBox error={error} />
      <Field label="Правильний читач">{() => <ReaderPicker value={reader} onChange={setReader} />}</Field>
      <Field label="Правильний примірник">{() => <CopyPicker value={copy} onChange={setCopy} />}</Field>
      <Field label="Причина" required>{(id) => <textarea id={id} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Перевірено фактичного читача та примірник</label>
      <div className="modal__foot"><Button onClick={onClose}>Скасувати</Button><Button type="submit" busy={busy} disabled={!reason.trim() || !confirm || (!reader && !copy)}>Виправити</Button></div>
    </form>
  </Modal>;
}
