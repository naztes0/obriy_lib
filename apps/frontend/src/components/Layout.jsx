import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE } from '../lib/format.js';

export default function Layout() {
  const { staff, logout, isManager } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">Бібліотека «Обрій»</div>
        <nav className="topbar__nav" aria-label="Основні розділи">
          <NavLink to="/books">Каталог</NavLink>
          <NavLink to="/readers">Читачі</NavLink>
          <NavLink to="/loans">Видачі</NavLink>
          <NavLink to="/reports">Звіти</NavLink>
          {isManager && <NavLink to="/classes">Класи</NavLink>}
          {isManager && <NavLink to="/staff">Працівники</NavLink>}
          <NavLink to="/help">Допомога</NavLink>
        </nav>
        <div className="topbar__user">
          <span title={ROLE[staff.role]}>
            {staff.displayName}{staff.displayName !== ROLE[staff.role] ? ` · ${ROLE[staff.role]}` : ''}
          </span>
          <button type="button" className="btn btn--small" onClick={logout}>
            Вийти
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
