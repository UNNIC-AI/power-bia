import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
// `vitest/config` re-exports vite's own `defineConfig` widened with the `test`
// block below; importing it from `vite` would not typecheck.
import { defineConfig } from 'vitest/config';

/*
 * Where the dev server forwards `/api`. An env var rather than a literal because
 * the API is reachable at a different address depending on where each side runs:
 * `localhost:3000` with both on the host, `api:3000` with both in compose,
 * `host.docker.internal:3000` for this container against an API on the host.
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // A test file sitting next to a route is a test, not a route.
      routeFileIgnorePattern: '\\.(test|spec)\\.tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    // 0.0.0.0, so the dev server is reachable when it runs inside a container.
    host: true,
    port: 5173,
    // Proxying keeps the app same-origin in development, so the SameSite=Strict
    // session cookie behaves exactly as it will in production behind a proxy.
    proxy: {
      '/api': { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  /** Tests come from `src` only, never from a build output. See apps/api/vitest.config.ts. */
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
