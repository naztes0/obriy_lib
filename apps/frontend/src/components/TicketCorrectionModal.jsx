import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';
import { Button, ErrorBox, Field, Modal } from './ui.jsx';
export default function TicketCorrectionModal({reader,onClose,onDone}) {
  const [number,setNumber]=useState(reader.ticketNumber);
  const [reason,setReason]=useState('');
  const [confirm,setConfirm]=useState(false);
  const action=useCallback(() => api.patch(`/api/v1/readers/${reader.id}`,{version:reader.version,ticketNumber:number,reason,confirmTicketNumberChange:confirm}),[reader,number,reason,confirm]);
  const {submit,busy,error}=useSubmit(action);
  return <Modal title="Виправити номер квитка" onClose={onClose} busy={busy}><form onSubmit={async(e)=>{e.preventDefault();if(await submit())onDone();}}>
    <p>Попередній номер: {reader.ticketNumber}. Зміна вплине на пошук і відображення історії. Попереднє значення буде збережено в аудиті.</p>
    <ErrorBox error={error}/><Field label="Новий номер" required>{id=><input id={id} required pattern="[A-Za-zА-Яа-яІіЇїЄєҐґ0-9/-]{1,32}" maxLength={32} value={number} onChange={e=>setNumber(e.target.value)}/>}</Field>
    <Field label="Причина" required>{id=><textarea id={id} required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/>}</Field>
    <label className="check"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Підтверджую правильність номера</label>
    <div className="modal__foot"><Button onClick={onClose} disabled={busy}>Скасувати</Button><Button type="submit" busy={busy} disabled={!confirm||!reason.trim()||number===reader.ticketNumber}>Зберегти</Button></div>
  </form></Modal>;
}
