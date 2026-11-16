let actorId = null;
const prefix = 'obriy:pending:';
export function setRequestActor(id) { actorId = id == null ? null : String(id); }
const storageKey = () => actorId ? `${prefix}${actorId}` : null;
export function pendingRequests() {
  const key = storageKey();
  if (!key) return [];
  try { return JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { return []; }
}
function write(items) {
  const key = storageKey();
  if (!key) return;
  sessionStorage.setItem(key, JSON.stringify(items));
  window.dispatchEvent(new Event('requests:changed'));
}
export function rememberRequest(entry) {
  if (!actorId) return;
  const items = pendingRequests();
  const previous = items.find((item) => item.path === entry.path);
  if (previous && (previous.key !== entry.key || JSON.stringify(previous.body) !== JSON.stringify(entry.body))) {
    throw new Error('Спочатку перевірте результат попередньої операції в повідомленні над сторінкою.');
  }
  if (!previous) write([...items, { ...entry, startedAt: new Date().toISOString() }]);
}
export function forgetRequest(key) { write(pendingRequests().filter((item) => item.key !== key)); }
