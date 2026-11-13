import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Navigation, visibleNavItems } from './Sidebar.jsx';

export default function Header() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const menu = useRef(null);
  const section = visibleNavItems(user)
    .filter(({ to }) => location.pathname === to || location.pathname.startsWith(to + '/'))
    .sort((first, second) => second.to.length - first.to.length)[0]?.label;

  useEffect(() => {
    menu.current?.close();
  }, [location.key]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 900px)');
    const closeOnDesktop = event => {
      if (!event.matches) menu.current?.close();
    };
    mobile.addEventListener('change', closeOnDesktop);
    return () => mobile.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <header className="app-header">
      <h1>Stock</h1>
      <span className="mobile-section-name">{section}</span>
      <button type="button" className="mobile-menu-trigger" aria-label="Abrir menú"
        aria-haspopup="dialog" onClick={() => menu.current.showModal()}>☰</button>
      <dialog className="mobile-menu" ref={menu} aria-label="Menú de navegación" onClick={event => {
        if (event.target === event.currentTarget) menu.current.close();
      }}>
        <div className="mobile-menu-panel">
          <div className="flex-between">
            <strong>{user?.username} · {user?.role || 'Sin rol'}</strong>
            <button type="button" aria-label="Cerrar menú" onClick={() => menu.current.close()}>×</button>
          </div>
          <Navigation user={user} onNavigate={() => menu.current.close()} />
          <button type="button" className="mobile-menu-logout" onClick={logout}>Cerrar sesión</button>
        </div>
      </dialog>
      <div className="header-user">
        {user ? (
          <>
            <span>
              {user.username} · {user.role || 'Sin rol'}
            </span>
            <button type="button" className="secondary-button" onClick={logout}>
              Cerrar sesión
            </button>
          </>
        ) : (
          <span>Sin sesión activa</span>
        )}
      </div>
    </header>
  );
}
