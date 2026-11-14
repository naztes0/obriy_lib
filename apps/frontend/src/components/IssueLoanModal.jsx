import { useCallback, useState } from 'react';
import api from '../api/client.js';
import { useSubmit } from '../lib/hooks.js';
import { CONDITION, todayKyiv } from '../lib/format.js';
import ReaderPicker from './ReaderPicker.jsx';
import { Button, ErrorBox, Field, Modal } from './ui.jsx';

export default function IssueLoanModal({ copy, bookTitle, isTextbook, onClose, onDone }) {
  const [reader, setReader] = useState(null);
  const [dueDate, setDueDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const action = useCallback(
    (key) =>
      api.post(
        '/api/v1/loans',
        { readerId: reader.id, copyId: copy.id, dueDate: dueDate || null },
        key,
      ),
    [reader, copy.id, dueDate],
  );
  const { submit, busy, error } = useSubmit(action);

  async function onSubmit(event) {
    event.preventDefault();
    const result = await submit();
    if (result) onDone(result.data);
  }

  const unrecorded = copy.condition === 'unrecorded';

  return (
    <Modal title="Видача примірника" onClose={onClose} wide>
      <form onSubmit={onSubmit}>
        <p>
          <strong>{bookTitle}</strong>, інв. № <strong>{copy.inventoryNumber}</strong>
        </p>
        <ErrorBox error={error} />
        <Field label="Читач" required error={error?.fields?.readerId}>
          {() => <ReaderPicker value={reader} onChange={setReader} />}
        </Field>
        {reader && (
          <p className="alert alert--info">
            Обрано: <strong>{reader.fullName}</strong>, квиток {reader.ticketNumber}
          </p>
        )}
        <Field
          label="Строк повернення"
          error={error?.fields?.dueDate}
          hint={
            isTextbook
              ? 'Для підручника можна вказати дату завершення навчального періоду. Порожньо — 30 днів.'
              : 'Порожньо — до кінця 30-го дня від сьогодні. Для учня строк обмежується датою закінчення квитка.'
          }
        >
          {(id) => <input id={id} type="date" min={todayKyiv()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </Field>
        {unrecorded ? (
          <div className="alert alert--warn">
            Стан примірника не зафіксовано. Перед видачею огляньте його й зафіксуйте стан у картці книги.
          </div>
        ) : (
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Підтверджую фізичний стан примірника: <strong>{CONDITION[copy.condition]}</strong>
            {copy.defectDescription ? ` (${copy.defectDescription})` : ''}
          </label>
        )}
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!reader || !confirmed || unrecorded}>
            Видати
          </Button>
        </div>
      </form>
    </Modal>
  );
}
