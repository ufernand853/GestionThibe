const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const API_ROOT_URL = API_BASE_URL.replace(/\/api$/, '');

export { API_BASE_URL, API_ROOT_URL };
