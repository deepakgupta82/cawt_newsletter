import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in the browser, so no CORS handling in app code.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env['API_PORT'] ?? 7071}`,
        changeOrigin: true,
      },
    },
  },
});
