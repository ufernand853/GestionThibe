import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // React Router resuelve rutas como /login en el navegador. Vite debe
  // devolver index.html también cuando esas rutas se abren directamente.
  appType: 'spa',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['th.linsse.com']
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['th.linsse.com']
  }
});
