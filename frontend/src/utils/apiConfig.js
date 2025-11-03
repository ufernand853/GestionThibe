const fallbackBaseUrl =
  typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/api`
    : 'http://localhost:3000/api';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || fallbackBaseUrl).replace(/\/$/, '');
const API_ROOT_URL = API_BASE_URL.replace(/\/api$/, '');

export { API_BASE_URL, API_ROOT_URL };
