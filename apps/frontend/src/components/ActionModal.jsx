import { useCallback, useState } from 'react';
import { useSubmit } from '../lib/hooks.js';
import { Button, ErrorBox, Field, Modal } from './ui.jsx';

export default function ActionModal({
  title, description, label = 'Причина', fieldName = 'reason', required = true,
  submitLabel = 'Підтвердити', danger = false, run, onClose, onDone, children,
}) {
  const [text, setText] = useState('');
  const action = useCallback((key) => run(key, text.trim()), [run, text]);
  const { submit, busy, error } = useSubmit(action);

  async function onSubmit(event) {
    event.preventDefault();
    const result = await submit();
    if (result) onDone(result.data);
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit}>
        {description && <p>{description}</p>}
        <ErrorBox error={error} />
        {children}
        <Field label={label} required={required} error={error?.fields?.[fieldName]}>
          {(id) => <textarea id={id} rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} autoFocus />}
        </Field>
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy} disabled={required && !text.trim()}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
