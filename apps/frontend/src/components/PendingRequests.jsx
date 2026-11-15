import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/client.js';
import { pendingRequests } from '../api/pending.js';
import { Button, ErrorBox, Notice } from './ui.jsx';

export default function PendingRequests() {
  const [items, setItems] = useState(pendingRequests);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  useEffect(() => {
    const update = () => setItems(pendingRequests());
    window.addEventListener('requests:changed', update);
    return () => window.removeEventListener('requests:changed', update);
  }, []);
  return <>
    {result && <Notice kind="ok">Результат операції підтверджено. {result.loanId && <Link to={`/loans/${result.loanId}`}>Відкрити видачу №{result.loanId}</Link>} <Button small onClick={() => { setResult(null); window.location.reload(); }}>Оновити сторінку</Button></Notice>}
    {items.length > 0 && <Notice kind="warn">
      <strong>Є операції, результат яких ще не підтверджено.</strong> Після завершення запиту вони зникнуть. Якщо відповідь втрачено, перевірте результат тим самим запитом — новий запис не створюється.
      {items.map((item) => <p key={item.key}>
        {item.path === '/api/v1/loans' ? `Видача примірника №${item.body.copyId}` : 'Облікова операція'} · {new Date(item.startedAt).toLocaleTimeString('uk-UA')}{' '}
        <Button small busy={busy} onClick={async () => {
          setBusy(true); setError(null);
          try {
            const res = await request(item.path, { method: item.method, body: item.body, idempotencyKey: item.key });
            setResult({ loanId: item.path === '/api/v1/loans' ? res.data.id : null });
          } catch (e) { setError(e); }
          finally { setBusy(false); }
        }}>Перевірити результат</Button>
      </p>)}
      <ErrorBox error={error} />
    </Notice>}
  </>;
}
