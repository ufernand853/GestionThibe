import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginPage from './pages/Login.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import ItemsPage from './pages/items/ItemsPage.jsx';
import MovementRequestsPage from './pages/movements/MovementRequestsPage.jsx';
import ApprovalsPage from './pages/movements/ApprovalsPage.jsx';
import CustomersPage from './pages/customers/CustomersPage.jsx';
import ReportsPage from './pages/reports/ReportsPage.jsx';
import AuditLogsPage from './pages/audit/AuditLogsPage.jsx';
import UsersPage from './pages/users/UsersPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="requests" element={<MovementRequestsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit" element={<AuditLogsPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
