import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const STORAGE_KEY = 'gestionthibe:auth';

const AuthContext = createContext(null);

function normalizePath(path) {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

function parseStoredValue() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { user: null, accessToken: null, refreshToken: null };
    }
    const parsed = JSON.parse(stored);
    return {
      user: parsed.user || null,
      accessToken: parsed.accessToken || null,
      refreshToken: parsed.refreshToken || null
    };
  } catch (error) {
    console.warn('No se pudo leer el estado de autenticación persistido', error);
    return { user: null, accessToken: null, refreshToken: null };
  }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(() => parseStoredValue());
  const [initializing, setInitializing] = useState(true);
  const refreshPromiseRef = useRef(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persistState = useCallback(nextState => {
    if (nextState.accessToken && nextState.refreshToken && nextState.user) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          accessToken: nextState.accessToken,
          refreshToken: nextState.refreshToken,
          user: nextState.user
        })
      );
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearState = useCallback(() => {
    setState({ user: null, accessToken: null, refreshToken: null });
    persistState({ user: null, accessToken: null, refreshToken: null });
  }, [persistState]);

  const refreshSession = useCallback(async () => {
    const { refreshToken } = stateRef.current;
    if (!refreshToken) {
      return null;
    }
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken })
      })
        .then(async response => {
          if (!response.ok) {
            throw new Error('No se pudo refrescar la sesión');
          }
          const data = await response.json();
          setState(prev => {
            const next = {
              ...prev,
              user: data.user,
              accessToken: data.accessToken
            };
            persistState({ ...next, refreshToken: prev.refreshToken });
            return next;
          });
          return data;
        })
        .catch(error => {
          clearState();
          throw error;
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }
    return refreshPromiseRef.current;
  }, [clearState, persistState]);

  useEffect(() => {
    let isMounted = true;
    const bootstrap = async () => {
      try {
        if (stateRef.current.refreshToken && stateRef.current.accessToken) {
          await refreshSession();
        }
      } catch (error) {
        if (isMounted) {
          console.warn('Sesión inválida, se requiere autenticación nuevamente.');
        }
      } finally {
        if (isMounted) {
          setInitializing(false);
        }
      }
    };
    bootstrap();
    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  const login = useCallback(
    async (email, password) => {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.message || 'No se pudo iniciar sesión';
        throw new Error(message);
      }
      const nextState = {
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken
      };
      setState(nextState);
      persistState(nextState);
      return data.user;
    },
    [persistState]
  );

  const logout = useCallback(async () => {
    const { refreshToken } = stateRef.current;
    try {
      if (refreshToken) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
      }
    } catch (error) {
      console.warn('No se pudo cerrar sesión correctamente', error);
    } finally {
      clearState();
    }
  }, [clearState]);

  const authFetch = useCallback(
    async (path, { method = 'GET', body, query, headers = {}, skipAuth = false } = {}) => {
      const url = new URL(`${API_BASE_URL}${normalizePath(path)}`);
      if (query) {
        Object.entries(query)
          .filter(([, value]) => value !== undefined && value !== null && value !== '')
          .forEach(([key, value]) => url.searchParams.append(key, value));
      }

      const config = {
        method,
        headers: {
          Accept: 'application/json',
          ...headers
        }
      };

      let isFormData = false;
      if (body !== undefined && body !== null) {
        if (body instanceof FormData) {
          config.body = body;
          isFormData = true;
        } else {
          config.body = JSON.stringify(body);
          config.headers['Content-Type'] = 'application/json';
        }
      }

      if (!skipAuth) {
        const { accessToken } = stateRef.current;
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        }
      }

      let response = await fetch(url, config);

      if (response.status === 401 && !skipAuth && stateRef.current.refreshToken) {
        try {
          await refreshSession();
        } catch (error) {
          throw new Error('Sesión expirada. Inicie sesión nuevamente.');
        }
        const { accessToken } = stateRef.current;
        if (accessToken) {
          const retryConfig = {
            ...config,
            headers: { ...config.headers, Authorization: `Bearer ${accessToken}` }
          };
          if (!isFormData && body !== undefined && body !== null && !(body instanceof FormData)) {
            retryConfig.body = JSON.stringify(body);
          }
          response = await fetch(url, retryConfig);
        }
      }

      const contentType = response.headers.get('content-type') || '';
      let data = null;
      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => null);
      } else if (contentType.startsWith('text/')) {
        data = await response.text();
      }

      if (!response.ok) {
        const message = data?.message || (typeof data === 'string' ? data : 'Error en la solicitud');
        const error = new Error(message);
        error.status = response.status;
        error.details = data;
        throw error;
      }

      return data;
    },
    [refreshSession]
  );

  const value = useMemo(
    () => ({
      user: state.user,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      initializing,
      login,
      logout,
      authFetch
    }),
    [state.user, state.accessToken, state.refreshToken, initializing, login, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe utilizarse dentro de un AuthProvider');
  }
  return context;
}
