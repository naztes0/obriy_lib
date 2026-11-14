import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, ErrorBox, Field } from '../components/ui.jsx';

export default function LoginPage() {
  const { staff, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (staff) return <Navigate to={location.state?.from ?? '/books'} replace />;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login({ login: form.login, password: form.password });
      navigate(location.state?.from ?? '/books', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card login" onSubmit={onSubmit}>
      <h1>Бібліотека «Обрій»</h1>
      <ErrorBox error={error} />
      <Field label="Логін" error={error?.fields?.login} required>
        {(id) => (
          <input id={id} autoComplete="username" autoFocus value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })} />
        )}
      </Field>
      <Field label="Пароль" error={error?.fields?.password} required>
        {(id) => (
          <input id={id} type="password" autoComplete="current-password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        )}
      </Field>
      <Button type="submit" variant="primary" busy={busy} disabled={!form.login || !form.password}>
        Увійти
      </Button>
    </form>
  );
}
