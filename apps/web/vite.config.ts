import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
// `vitest/config` re-exports vite's own `defineConfig` widened with the `test`
// block below; importing it from `vite` would not typecheck.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxying keeps the app same-origin in development, so the SameSite=Strict
    // session cookie behaves exactly as it will in production behind a proxy.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  /** Tests come from `src` only, never from a build output. See apps/api/vitest.config.ts. */
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
