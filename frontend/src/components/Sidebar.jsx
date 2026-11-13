import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export const NAV_ITEMS = [
  { to: '/', label: 'Resumen' },
  { to: '/items', label: 'Artículos', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/items/local', label: 'Artículos Locales', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/items/barcode-reception', label: 'Escaneo de Productos', permissionsAny: ['stock.approve', 'stock.request'] },
  { to: '/venta-local', label: 'Venta desde Local' },
  { to: '/overstock', label: 'Sobrestock', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/items/trash', label: 'Papelera', permission: 'items.write', hiddenForRoles: ['Operador'] },
  { to: '/items/download', label: 'PDF e Impresión', permission: 'items.read', hiddenForRoles: ['Operador', 'Supervisor'] },
  { to: '/groups', label: 'Grupos', permission: 'items.write', hiddenForRoles: ['Operador'] },
  { to: '/requests', label: 'Solicitudes Depósitos', permission: 'stock.request' },
  { to: '/local-requests', label: 'Solicitudes Locales', permission: 'stock.request', visibleForRoles: ['Administrador'] },
  { to: '/approvals', label: 'Aprobaciones', permission: 'stock.approve', hiddenForRoles: ['Operador'] },
  { to: '/locations', label: 'Ubicaciones', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/reports', label: 'Reportes', permission: 'reports.read', hiddenForRoles: ['Operador'] },
  { to: '/shopify', label: 'Shopify', permission: 'items.read', hiddenForRoles: ['Operador'] },
  { to: '/audit', label: 'Auditoría', permission: 'stock.logs.read', hiddenForRoles: ['Operador'] },
  { to: '/users', label: 'Usuarios', permission: 'users.read', hiddenForRoles: ['Operador'] }
];

export function visibleNavItems(user) {
  const permissions = user?.permissions || [];
  const role = user?.role || null;
  const visibleItems = role === 'Vendedor'
    ? NAV_ITEMS.filter(item => item.to === '/venta-local')
    : NAV_ITEMS;

  return visibleItems.filter(item => {
          if (item.hiddenForRoles && role && item.hiddenForRoles.includes(role)) {
            return false;
          }
          if (item.visibleForRoles && !item.visibleForRoles.includes(role)) {
            return false;
          }
          if (item.permission && !permissions.includes(item.permission)) {
            return false;
          }
          if (item.permissionsAny && !item.permissionsAny.some(permission => permissions.includes(permission))) {
            return false;
          }
          return true;
  });
}

export function Navigation({ user, onNavigate }) {
  return (
    <nav className="sidebar-nav">
        {visibleNavItems(user).map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onNavigate}>
            {item.label}
          </NavLink>
        ))}
    </nav>
  );
}

export default function Sidebar() {
  const { user } = useAuth();
  return (
    <aside className="sidebar">
      <div className="sidebar-header">Stock</div>
      <Navigation user={user} />
      <div className="sidebar-footer">v1.0.0</div>
    </aside>
  );
}
