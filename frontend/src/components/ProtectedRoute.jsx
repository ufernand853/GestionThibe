import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children }) {
  const { user, initializing } = useAuth();

  if (initializing) {
    return <div className="page-loading">Preparando aplicación...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
