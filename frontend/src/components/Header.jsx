import { useAuth } from '../context/AuthContext.jsx';

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <h1>Stock</h1>
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
