import { defineConfig } from 'vitest/config';

/** Tests come from `src` only, never from the compiled copies in `dist`. See apps/api/vitest.config.ts. */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
});
