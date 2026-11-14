import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';
import { Button, ErrorBox, Field, Modal } from './ui.jsx';

export default function ConditionModal({ copy, onClose, onDone }) {
  const [condition, setCondition] = useState(copy.condition === 'unrecorded' ? 'good' : copy.condition);
  const [defect, setDefect] = useState(copy.defectDescription ?? '');
  const [reason, setReason] = useState('');
  const needsDefect = condition !== 'good';

  const action = useCallback(
    () =>
      api.patch(`/api/v1/copies/${copy.id}/condition`, {
        condition,
        defectDescription: needsDefect ? defect : null,
        reason,
      }),
    [copy.id, condition, defect, reason, needsDefect],
  );
  const { submit, busy, error } = useSubmit(action);
  const fields = error?.fields ?? {};

  async function onSubmit(event) {
    event.preventDefault();
    const result = await submit();
    if (result) onDone(result.data);
  }

  return (
    <Modal title={`Фізичний стан · ${copy.inventoryNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <ErrorBox error={error} />
        <Field label="Стан" required error={fields.condition}>
          {(id) => (
            <select id={id} value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="good">Добрий</option>
              <option value="worn">Зношений (видача можлива)</option>
              <option value="damaged">Пошкоджений (видача заборонена)</option>
            </select>
          )}
        </Field>
        {needsDefect && (
          <Field label="Опис дефектів" required error={fields.defectDescription}>
            {(id) => <textarea id={id} rows={3} value={defect} onChange={(e) => setDefect(e.target.value)} />}
          </Field>
        )}
        <Field label="Причина зміни" required error={fields.reason}>
          {(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!reason.trim() || (needsDefect && !defect.trim())}>
            Зберегти стан
          </Button>
        </div>
      </form>
    </Modal>
  );
}
