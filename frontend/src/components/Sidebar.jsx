import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Resumen' },
  { to: '/items', label: 'Artículos', permission: 'items.read' },
  { to: '/groups', label: 'Grupos', permission: 'items.write' },
  { to: '/requests', label: 'Solicitudes', permission: 'stock.request' },
  { to: '/approvals', label: 'Aprobaciones', permission: 'stock.approve' },
  { to: '/destinations', label: 'Destinos', permission: 'items.read' },
  { to: '/deposits', label: 'Depósitos', permission: 'items.write' },
  { to: '/reports', label: 'Reportes', permission: 'reports.read' },
  { to: '/audit', label: 'Auditoría', permission: 'stock.logs.read' },
  { to: '/users', label: 'Usuarios', permission: 'users.read' }
];

export default function Sidebar() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Thibe Stock</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.filter(item => !item.permission || permissions.includes(item.permission)).map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">v1.0.0</div>
    </aside>
  );
}
