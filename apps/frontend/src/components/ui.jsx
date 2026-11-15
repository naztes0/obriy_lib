import { useEffect, useId, useRef } from 'react';
import { formatDateTime, LOAN_STATUS } from '../lib/format.js';

export function Spinner({ label = 'Завантаження…' }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  const technical = error.status === 0 || error.status >= 500;
  const retry = onRetry ?? (['VERSION_CONFLICT','READER_STATE_CHANGED'].includes(error.code) ? () => window.dispatchEvent(new Event('data:refresh')) : null);
  return (
    <div className="alert alert--error" role="alert">
      <div>{error.message}</div>
      {technical && (
        <div className="alert__meta">
          {error.requestId ? `Код звернення: ${error.requestId}. ` : ''}
          {formatDateTime(new Date().toISOString())}
        </div>
      )}
      {retry && (
        <button type="button" className="btn btn--small" onClick={retry}>
          Оновити дані
        </button>
      )}
    </div>
  );
}

export function Notice({ kind = 'info', children }) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Button({ busy, children, variant = 'default', small, ...props }) {
  const classes = ['btn', variant !== 'default' && `btn--${variant}`, small && 'btn--small']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} {...props} disabled={busy || props.disabled}>
      {busy ? 'Зачекайте…' : children}
    </button>
  );
}

export function Field({ label, hint, error, children, required }) {
  const id = useId();
  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="field__req"> *</span>}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <div className="field__hint">{hint}</div>}
      {error && <div className="field__error">{error}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, busy = false }) {
  const ref = useRef(null);
  const previousFocus = useRef(document.activeElement);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busyRef.current) closeRef.current();
      if (event.key === 'Tab') {
        const elements = [...(ref.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? [])].filter((e) => e.getClientRects().length);
        const first = elements[0]; const last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); previousFocus.current?.focus(); };
  }, []);

  return (
    <div className="modal-backdrop">
      <div
        className={`modal${wide ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" disabled={busy} onClick={onClose} aria-label="Закрити">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) {
    return meta ? <div className="pager__info">Усього: {meta.totalItems}</div> : null;
  }
  return (
    <div className="pager">
      <Button small disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
        ← Назад
      </Button>
      <span className="pager__info">
        Сторінка {meta.page} з {meta.totalPages} · усього {meta.totalItems}
      </span>
      <Button small disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
        Далі →
      </Button>
    </div>
  );
}

export function Badge({ kind = 'neutral', children }) {
  return <span className={`badge badge--${kind}`}>{children}</span>;
}

export function LoanStatusBadge({ status }) {
  const kind = { issued: 'info', lost: 'danger', returned: 'ok', compensated: 'neutral' }[status];
  return <Badge kind={kind}>{LOAN_STATUS[status] ?? status}</Badge>;
}

export function PageHeader({ title, subtitle, eyebrow, actions }) {
  return (
    <div className="page-head">
      <div className="page-head__copy">
        {eyebrow && <div className="page-head__eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="page-head__actions">{actions}</div>
    </div>
  );
}

export function Empty({ children = 'Нічого не знайдено.' }) {
  return <div className="empty">{children}</div>;
}
