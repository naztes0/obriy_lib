import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ActionModal from '../components/ActionModal.jsx';
import ChangeBookModal from '../components/ChangeBookModal.jsx';
import CopyHistoryModal from '../components/CopyHistoryModal.jsx';
import InventoryNumberModal from '../components/InventoryNumberModal.jsx';
import ConditionModal from '../components/ConditionModal.jsx';
import IssueLoanModal from '../components/IssueLoanModal.jsx';
import { Badge, Button, ErrorBox, Field, Modal, Notice, PageHeader, Spinner } from '../components/ui.jsx';
import { AVAILABILITY_REASON, CONDITION } from '../lib/format.js';
import { useAsync, useSubmit } from '../lib/hooks.js';
import BookFormModal from './BookFormModal.jsx';

function AddCopyModal({ bookId, onClose, onDone }) {
  const [inventoryNumber, setInventoryNumber] = useState('');
  const [condition, setCondition] = useState('good');
  const [defect, setDefect] = useState('');
  const needsDefect = condition !== 'good';

  const action = useCallback(
    () =>
      api.post(`/api/v1/books/${bookId}/copies`, {
        inventoryNumber,
        condition,
        defectDescription: needsDefect ? defect : null,
      }),
    [bookId, inventoryNumber, condition, defect, needsDefect],
  );
  const { submit, busy, error } = useSubmit(action);
  const fields = error?.fields ?? {};

  async function onSubmit(event) {
    event.preventDefault();
    const result = await submit();
    if (result) onDone();
  }

  return (
    <Modal title="Новий примірник" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <ErrorBox error={error?.code === 'VALIDATION_ERROR' ? null : error} />
        <Field label="Інвентарний номер" required error={fields.inventoryNumber}
          hint="З маркування примірника. 1–32 символи: літери, цифри, дефіс, коса риска.">
          {(id) => <input id={id} value={inventoryNumber} onChange={(e) => setInventoryNumber(e.target.value)} autoFocus />}
        </Field>
        <Field label="Фізичний стан" required error={fields.condition}>
          {(id) => (
            <select id={id} value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="good">Добрий</option>
              <option value="worn">Зношений</option>
              <option value="damaged">Пошкоджений</option>
            </select>
          )}
        </Field>
        {needsDefect && (
          <Field label="Опис дефектів" required error={fields.defectDescription}>
            {(id) => <textarea id={id} rows={3} value={defect} onChange={(e) => setDefect(e.target.value)} />}
          </Field>
        )}
        <div className="modal__foot">
          <Button onClick={onClose}>Скасувати</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!inventoryNumber.trim()}>Додати</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function BookDetailPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { data: book, error, loading, reload } = useAsync(() => api.get(`/api/v1/books/${bookId}`), [bookId]);
  const [modal, setModal] = useState(null);
  const [flash, setFlash] = useState('');
  const close = () => setModal(null);
  const done = (message) => () => {
    close();
    setFlash(message);
    reload();
  };

  if (loading && !book) return <Spinner />;
  if (error && !book) return <ErrorBox error={error} onRetry={reload} />;
  if (!book) return null;

  const authors = book.authors.map((a) => a.name ?? a).join(', ');

  return (
    <>
      <div className="crumbs"><Link to="/books">← Каталог</Link></div>
      <PageHeader
        title={book.title}
        actions={
          <>
            <Button onClick={() => setModal({ type: 'edit' })} disabled={book.isArchived}>Редагувати</Button>
            {book.isArchived ? (
              isManager && <Button onClick={() => setModal({ type: 'restoreBook' })}>Відновити</Button>
            ) : (
              <Button variant="danger" onClick={() => setModal({ type: 'archiveBook' })}>В архів</Button>
            )}
            {isManager && <Button variant="danger" onClick={() => setModal({ type: 'deleteBook' })}>Видалити</Button>}
          </>
        }
      />
      {flash && <Notice kind="ok">{flash}</Notice>}
      <ErrorBox error={error} onRetry={reload} />
      {book.isArchived && <Notice kind="warn">Книга в архіві: нові видачі та редагування недоступні. Відновлення — завідувач.</Notice>}

      <div className="card">
        <dl className="kv">
          <dt>Автори</dt><dd>{authors}</dd>
          <dt>Видавництво</dt><dd>{book.publisher}</dd>
          <dt>Рік видання</dt><dd>{book.publicationYear ?? 'Не встановлено'}</dd>
          <dt>ISBN</dt><dd>{book.isbn ?? '—'}</dd>
          <dt>Тип</dt><dd>{book.isTextbook ? 'Підручник' : 'Звичайне видання'}</dd>
          <dt>Примірників</dt><dd>усього неархівних: <strong>{book.totalCopies}</strong>, доступних: <strong>{book.availableCopies}</strong></dd>
        </dl>
      </div>

      <div className="page-head">
        <h2>Примірники</h2>
        <Button onClick={() => setModal({ type: 'addCopy' })} disabled={book.isArchived}>+ Додати примірник</Button>
      </div>
      <table>
        <thead><tr><th>Інв. №</th><th>Стан</th><th>Доступність</th><th>Дії</th></tr></thead>
        <tbody>
          {book.copies.length === 0 && <tr><td colSpan="4" className="row-muted">Примірників ще немає.</td></tr>}
          {book.copies.map((copy) => (
            <tr key={copy.id} className={copy.isArchived ? 'row-muted' : ''}>
              <td className="nowrap"><strong>{copy.inventoryNumber}</strong></td>
              <td>
                {CONDITION[copy.condition]}
                {copy.defectDescription && <div className="field__hint">{copy.defectDescription}</div>}
              </td>
              <td>
                {copy.isAvailable ? (
                  <Badge kind="ok">Доступний</Badge>
                ) : (
                  copy.availabilityReasons.map((r) => (
                    <Badge key={r} kind={r === 'lost' || r === 'damaged' ? 'danger' : 'warn'}>{AVAILABILITY_REASON[r] ?? r}</Badge>
                  ))
                )}
              </td>
              <td>
                <div className="actions">
                  <Button small variant="primary" disabled={!copy.isAvailable} onClick={() => setModal({ type: 'issue', copy })}>Видати</Button>
                  <Button small onClick={() => setModal({ type: 'history', copy })}>Історія</Button>
                  {copy.isArchived && isManager && (
                    <>
                      <Button small onClick={() => setModal({ type: 'restoreCopy', copy })} disabled={book.isArchived} title={book.isArchived ? 'Спочатку відновіть книгу' : undefined}>Відновити</Button>
                      <Button small variant="danger" onClick={() => setModal({ type: 'deleteCopy', copy })}>Видалити</Button>
                    </>
                  )}
                  {!copy.isArchived && (
                    <>
                      <Button small onClick={() => setModal({ type: 'condition', copy })}>Стан</Button>
                      <Button small onClick={() => setModal({ type: 'unavailable', copy })}>
                        {copy.isTemporarilyUnavailable ? 'Зробити доступним' : 'Тимчасово недоступний'}
                      </Button>
                      {!copy.isLost && !copy.availabilityReasons.includes('on_loan') && (
                        <Button small variant="danger" onClick={() => setModal({ type: 'loss', copy })}>Втрата</Button>
                      )}
                      {copy.isLost && isManager && (
                        <Button small onClick={() => setModal({ type: 'found', copy })}>Знайдено</Button>
                      )}
                      <Button small onClick={() => setModal({ type: 'changeBook', copy })}>Змінити видання</Button>
                      <Button small onClick={() => setModal({ type: 'archiveCopy', copy })}>В архів</Button>
                      {isManager && (
                        <>
                          <Button small onClick={() => setModal({ type: 'inventory', copy })}>Інв. №</Button>
                          <Button small variant="danger" onClick={() => setModal({ type: 'writeOff', copy })}>Списати</Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal?.type === 'edit' && (
        <BookFormModal book={book} onClose={close} onSaved={done('Зміни збережено.')} />
      )}
      {modal?.type === 'addCopy' && <AddCopyModal bookId={book.id} onClose={close} onDone={done('Примірник додано.')} />}
      {modal?.type === 'condition' && <ConditionModal copy={modal.copy} onClose={close} onDone={done('Стан примірника збережено.')} />}
      {modal?.type === 'issue' && (
        <IssueLoanModal
          copy={modal.copy}
          bookTitle={book.title}
          isTextbook={book.isTextbook}
          onClose={close}
          onDone={done('Видачу оформлено.')}
        />
      )}
      {modal?.type === 'unavailable' && (
        <ActionModal
          title={modal.copy.isTemporarilyUnavailable ? 'Зняти недоступність' : 'Тимчасова недоступність'}
          description={`Примірник ${modal.copy.inventoryNumber}. Це не закриває видачу та не заважає поверненню.`}
          submitLabel="Підтвердити"
          run={(_, reason) =>
            api.patch(`/api/v1/copies/${modal.copy.id}/temporary-unavailability`, {
              isTemporarilyUnavailable: !modal.copy.isTemporarilyUnavailable,
              reason,
            })
          }
          onClose={close}
          onDone={done('Збережено.')}
        />
      )}
      {modal?.type === 'loss' && (
        <ActionModal
          title="Зафіксувати втрату примірника"
          description={`Примірник ${modal.copy.inventoryNumber} стане недоступним і потрапить у звіт про втрати.`}
          danger
          submitLabel="Зафіксувати втрату"
          run={(key, reason) =>
            api.post(`/api/v1/copies/${modal.copy.id}/loss`, { version: modal.copy.version, reason }, key)
          }
          onClose={close}
          onDone={done('Втрату зафіксовано.')}
        />
      )}
      {modal?.type === 'changeBook' && <ChangeBookModal copy={modal.copy} currentBookId={book.id} onClose={close} onDone={done('Видання примірника змінено.')} />}
      {modal?.type === 'history' && <CopyHistoryModal copy={modal.copy} onClose={close} onChanged={reload} />}
      {modal?.type === 'inventory' && <InventoryNumberModal copy={modal.copy} onClose={close} onDone={done('Інвентарний номер виправлено.')} />}
      {modal?.type === 'found' && (
        <ActionModal
          title="Знайдений примірник"
          description={`Примірник ${modal.copy.inventoryNumber} повернеться до фонду зі збереженням історії втрати. Стара видача не поновлюється.`}
          label="Обставини"
          submitLabel="Повернути до фонду"
          run={(key, reason) => api.post(`/api/v1/copies/${modal.copy.id}/found`, { version: modal.copy.version, reason }, key)}
          onClose={close}
          onDone={done('Примірник повернено до фонду.')}
        />
      )}
      {modal?.type === 'archiveCopy' && (
        <ActionModal
          title="Архівувати примірник"
          description={`Примірник ${modal.copy.inventoryNumber} стане недоступним. Якщо в нього є незавершена видача, архівація буде відхилена. Якщо історії немає — запис можна видалити остаточно з архіву.`}
          required={false}
          label="Причина (необов’язково)"
          danger
          submitLabel="Архівувати"
          run={(key, reason) => api.post(`/api/v1/copies/${modal.copy.id}/archive`, { version: modal.copy.version, confirmArchive: true, reason: reason || null }, key)}
          onClose={close}
          onDone={done('Примірник архівовано.')}
        />
      )}
      {modal?.type === 'restoreCopy' && (
        <ActionModal
          title="Відновити примірник"
          description="Ознаки втрати й тимчасової недоступності зберігаються."
          required={false}
          label="Коментар"
          submitLabel="Відновити"
          run={(key) => api.post(`/api/v1/copies/${modal.copy.id}/restore`, { version: modal.copy.version, confirmRestore: true }, key)}
          onClose={close}
          onDone={done('Примірник відновлено.')}
        />
      )}
      {modal?.type === 'deleteCopy' && (
        <ActionModal
          title="Видалити примірник остаточно"
          description={`Видалення примірника ${modal.copy.inventoryNumber} незворотне. Воно можливе лише для примірника без історії; якщо історія є, використайте «Списати».`}
          required={false}
          label="Коментар"
          danger
          submitLabel="Видалити остаточно"
          run={(key) => api.post(`/api/v1/copies/${modal.copy.id}/delete`, { version: modal.copy.version, confirmDelete: true }, key)}
          onClose={close}
          onDone={done('Примірник видалено.')}
        />
      )}
      {modal?.type === 'writeOff' && (
        <ActionModal
          title="Списати примірник"
          description={`УВАГА: запис примірника ${modal.copy.inventoryNumber} разом з усією історією його видач і змін буде остаточно видалено, а записи цього примірника зникнуть з історії читачів. Підсумки звітів зміняться. Дію не можна скасувати. Можливо лише після завершення всіх видач і врегулювання втрат.`}
          label="Підстава списання"
          danger
          submitLabel="Списати назавжди"
          run={(key, reason) => api.post(`/api/v1/copies/${modal.copy.id}/write-off`, { version: modal.copy.version, reason, confirmReportImpact: true }, key)}
          onClose={close}
          onDone={done('Примірник списано.')}
        />
      )}
      {modal?.type === 'archiveBook' && (
        <ActionModal
          title="Архівувати книгу"
          description="Книга й усі її примірники стануть недоступними для видачі. Архівація можлива лише за відсутності незавершених видач."
          required={false}
          label="Причина (необов’язково)"
          danger
          submitLabel="Архівувати"
          run={(key, reason) =>
            api.post(`/api/v1/books/${book.id}/archive`, { version: book.version, confirmArchive: true, reason: reason || null }, key)
          }
          onClose={close}
          onDone={done('Книгу архівовано.')}
        />
      )}
      {modal?.type === 'deleteBook' && (
        <ActionModal
          title="Видалити книгу остаточно"
          description="Незворотно. Можливо лише для книги без примірників і без історії; інакше використайте архівацію."
          required={false}
          label="Коментар"
          danger
          submitLabel="Видалити остаточно"
          run={(key) => api.post(`/api/v1/books/${book.id}/delete`, { version: book.version, confirmDelete: true }, key)}
          onClose={close}
          onDone={() => { close(); navigate('/books'); }}
        />
      )}
      {modal?.type === 'restoreBook' && (
        <ActionModal
          title="Відновити книгу"
          description="Примірники автоматично не відновлюються — їх потрібно відновлювати окремо."
          required={false}
          label="Коментар"
          submitLabel="Відновити"
          run={(key) => api.post(`/api/v1/books/${book.id}/restore`, { version: book.version, confirmRestore: true }, key)}
          onClose={close}
          onDone={done('Книгу відновлено.')}
        />
      )}
    </>
  );
}
