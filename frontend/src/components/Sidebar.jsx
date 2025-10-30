import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Resumen' },
  { to: '/items', label: 'Artículos', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/groups', label: 'Grupos', permission: 'items.write', hiddenForRoles: ['Operador'] },
  { to: '/requests', label: 'Solicitudes', permission: 'stock.request' },
  { to: '/approvals', label: 'Aprobaciones', permission: 'stock.approve', hiddenForRoles: ['Operador'] },
  { to: '/locations', label: 'Ubicaciones', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/reports', label: 'Reportes', permission: 'reports.read', hiddenForRoles: ['Operador'] },
  { to: '/audit', label: 'Auditoría', permission: 'stock.logs.read', hiddenForRoles: ['Operador'] },
  { to: '/users', label: 'Usuarios', permission: 'users.read', hiddenForRoles: ['Operador'] }
];

export default function Sidebar() {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const role = user?.role || null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Stock</div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.filter(item => {
          if (item.hiddenForRoles && role && item.hiddenForRoles.includes(role)) {
            return false;
          }
          if (item.permission && !permissions.includes(item.permission)) {
            return false;
          }
          return true;
        }).map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">v1.0.0</div>
    </aside>
  );
}
