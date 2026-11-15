import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, BarChart3, BookOpen, CircleHelp, Command, LogOut,
  Menu, Moon, PanelLeftClose, PanelLeftOpen, School, Search, ShieldAlert, Sun, UserCog, Users, X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE } from '../lib/format.js';
import PendingRequests from './PendingRequests.jsx';

const navigation = [
  { to: '/books', label: 'Каталог', icon: BookOpen },
  { to: '/readers', label: 'Читачі', icon: Users },
  { to: '/loans', label: 'Видачі', icon: ArrowLeftRight },
  { to: '/reports', label: 'Звіти', icon: BarChart3 },
  { to: '/restrictions', label: 'Блокування', icon: ShieldAlert },
  { to: '/classes', label: 'Класи', icon: School, managerOnly: true },
  { to: '/staff', label: 'Працівники', icon: UserCog, managerOnly: true },
];

export default function Layout() {
  const { staff, logout, isManager } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('obriy-sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('obriy-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const links = useMemo(() => navigation.filter((item) => !item.managerOnly || isManager), [isManager]);
  const matches = links.filter((item) => item.label.toLocaleLowerCase('uk-UA').includes(query.trim().toLocaleLowerCase('uk-UA')));

  useEffect(() => {
    localStorage.setItem('obriy-sidebar', collapsed ? 'collapsed' : 'expanded');
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('obriy-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (to) => {
    navigate(to);
    setCommandOpen(false);
    setMobileOpen(false);
    setQuery('');
  };

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}${mobileOpen ? ' app-shell--mobile-open' : ''}`}>
      <header className="mobile-bar">
        <button type="button" className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="Відкрити меню"><Menu size={20} /></button>
        <div className="brand brand--mobile"><span>О</span><strong>Обрій</strong></div>
        <div className="mobile-bar__actions">
          <button type="button" className="icon-btn" onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}>{theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}</button>
          <button type="button" className="icon-btn" onClick={() => setCommandOpen(true)} aria-label="Швидкий пошук"><Search size={19} /></button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Головна навігація">
        <div className="sidebar__head">
          <NavLink to="/books" className="brand" onClick={() => setMobileOpen(false)}>
            <span>О</span><div><strong>Обрій</strong><small>бібліотечна система</small></div>
          </NavLink>
          <button type="button" className="icon-btn sidebar__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Закрити меню"><X size={19} /></button>
        </div>

        <button type="button" className="command-trigger" onClick={() => setCommandOpen(true)}>
          <Search size={17} /><span>Швидкий пошук</span><kbd>Ctrl K</kbd>
        </button>

        <nav className="sidebar__nav">
          <div className="sidebar__label">Робочий простір</div>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} title={collapsed ? label : undefined} onClick={() => setMobileOpen(false)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__foot">
          <NavLink to="/help" title={collapsed ? 'Допомога' : undefined} onClick={() => setMobileOpen(false)}>
            <CircleHelp size={18} /><span>Допомога</span>
          </NavLink>
          <button type="button" className="theme-toggle" onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} title={collapsed ? (theme === 'dark' ? 'Світла тема' : 'Темна тема') : undefined}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}<span>{theme === 'dark' ? 'Світла тема' : 'Темна тема'}</span>
          </button>
          <div className="sidebar-user">
            <span className="sidebar-user__avatar">{staff.displayName?.trim()?.[0]?.toUpperCase() ?? 'Б'}</span>
            <span className="sidebar-user__identity"><strong>{staff.displayName}</strong><small>{ROLE[staff.role]}</small></span>
            <button type="button" className="icon-btn" onClick={logout} aria-label="Вийти"><LogOut size={17} /></button>
          </div>
          <button type="button" className="sidebar-collapse" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>{collapsed ? 'Розгорнути меню' : 'Згорнути меню'}</span>
          </button>
        </div>
      </aside>
      <button className="sidebar-scrim" type="button" onClick={() => setMobileOpen(false)} aria-label="Закрити меню" />

      <main className="workspace">
        <div className="workspace__utility">
          <button type="button" className="utility-search" onClick={() => setCommandOpen(true)}>
            <Search size={16} /><span>Знайти читача, книгу або розділ…</span><kbd>Ctrl K</kbd>
          </button>
          <button type="button" className="utility-theme" onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
          <div className="utility-user"><span>{staff.displayName}</span><b>{staff.displayName?.trim()?.[0]?.toUpperCase() ?? 'Б'}</b></div>
        </div>
        <div className="content">
          <PendingRequests />
          <Outlet />
        </div>
      </main>

      {commandOpen && (
        <div className="command-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCommandOpen(false)}>
          <div className="command-menu" role="dialog" aria-modal="true" aria-label="Швидкий перехід">
            <div className="command-menu__input"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Введіть назву розділу…" autoFocus /><kbd>Esc</kbd></div>
            <div className="command-menu__label">Перейти до</div>
            <div className="command-menu__results">
              {matches.map(({ to, label, icon: Icon }) => (
                <button type="button" key={to} onClick={() => go(to)}><Icon size={18} /><span>{label}</span><Command size={13} /></button>
              ))}
              {matches.length === 0 && <div className="command-menu__empty">Розділ не знайдено</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
