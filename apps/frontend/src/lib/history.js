import { CONDITION, LOAN_STATUS } from './format.js';
export const EVENT_KIND = {
  created:'Створено',condition_changed:'Зміна стану',temporary_unavailability_changed:'Тимчасова недоступність',
  issued:'Видача',returned:'Повернення',lost:'Втрата за видачею',lost_in_fund:'Втрата у фонді',found:'Знайдено',
  compensated:'Відшкодування',erroneous_return:'Помилкове повернення',extended:'Продовження',archived:'Архівація',
  restored:'Відновлення',inventory_number_corrected:'Виправлення номера',book_changed:'Зміна видання',
  participants_corrected:'Виправлення учасників',loss_corrected:'Виправлення втрати',loss_settled:'Врегулювання втрати',
  status_corrected:'Виправлення статусу',correct_participants:'Виправлення учасників',void_loan:'Вилучення помилкової видачі',
};
const labels = {condition:'стан',defectDescription:'дефекти',isLost:'втрачено',isArchived:'архів',isTemporarilyUnavailable:'тимчасово недоступний',
  inventoryNumber:'інвентарний номер',bookId:'видання №',readerId:'читач №',copyId:'примірник №',reader_id:'читач №',copy_id:'примірник №',
  oldDueDate:'попередній строк',newDueDate:'новий строк',currentDueDate:'строк',status:'статус',settled:'врегульовано',responsibleReaderKnown:'читача встановлено'};
export function eventValue(value) {
  if (!value) return '';
  if (typeof value === 'string') { try { value=JSON.parse(value); } catch { return value; } }
  if (typeof value !== 'object') return String(value);
  return Object.entries(value).map(([k,v]) => `${labels[k] ?? 'Дані'}: ${v == null ? 'Не зазначено' : typeof v === 'boolean' ? (v?'так':'ні') : k==='condition' ? CONDITION[v] ?? v : k==='status' ? LOAN_STATUS[v] ?? v : typeof v==='object' ? eventValue(v) : v}`).join('; ');
}
