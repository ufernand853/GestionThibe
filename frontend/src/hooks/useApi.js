import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function useApi() {
  const { authFetch } = useAuth();

  return useMemo(
    () => ({
      get: (path, options) => authFetch(path, { ...options, method: 'GET' }),
      post: (path, body, options) => authFetch(path, { ...options, method: 'POST', body }),
      put: (path, body, options) => authFetch(path, { ...options, method: 'PUT', body }),
      patch: (path, body, options) => authFetch(path, { ...options, method: 'PATCH', body }),
      delete: (path, options) => authFetch(path, { ...options, method: 'DELETE' })
    }),
    [authFetch]
  );
}
