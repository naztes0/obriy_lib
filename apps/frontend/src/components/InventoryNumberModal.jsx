import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';
import { Button, ErrorBox, Field, Modal, Notice } from './ui.jsx';

export default function InventoryNumberModal({ copy, onClose, onDone }) {
  const [inventoryNumber, setInventoryNumber] = useState(copy.inventoryNumber);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const action = useCallback(
    (key) =>
      api.patch(
        `/api/v1/copies/${copy.id}/inventory-number`,
        { version: copy.version, inventoryNumber, reason, confirmNumberChange: confirmed },
        key,
      ),
    [copy, inventoryNumber, reason, confirmed],
  );
  const { submit, busy, error } = useSubmit(action);
  const f = error?.fields ?? {};
  const changed = inventoryNumber.trim() !== copy.inventoryNumber;

  return (
    <Modal title="Виправлення інвентарного номера" onClose={onClose}>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await submit(); if (r) onDone(); }}>
        <p>Поточний номер: <strong>{copy.inventoryNumber}</strong></p>
        <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
        <Field label="Новий номер" required error={f.inventoryNumber} hint="1–32 символи: літери, цифри, дефіс, коса риска. Має бути унікальним серед активних і архівних.">
          {(id) => <input id={id} value={inventoryNumber} onChange={(e) => setInventoryNumber(e.target.value)} autoFocus />}
        </Field>
        <Field label="Причина виправлення" required error={f.reason}>
          {(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {changed && (
          <>
            <Notice kind="warn">
              Зміна номера вплине на пошук запису й відображення в історії. Підтвердьте правильність нового номера:{' '}
              <strong>{copy.inventoryNumber} → {inventoryNumber.trim()}</strong>. Попередній номер зберігається в історії.
            </Notice>
            <label className="check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Підтверджую правильність нового номера
            </label>
            {f.confirmNumberChange && <div className="field__error">{f.confirmNumberChange}</div>}
          </>
        )}
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!changed || !confirmed || !reason.trim()}>Виправити номер</Button>
        </div>
      </form>
    </Modal>
  );
}
