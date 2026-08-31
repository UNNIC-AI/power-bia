import { defineConfig } from 'vitest/config';

/**
 * Tests are collected from `src` only.
 *
 * Vitest 4 narrowed its `defaultExclude` to `node_modules` and `.git` — `dist`
 * was on that list in v3 and no longer is. Since `pnpm build` compiles every
 * `*.test.ts` into `dist/`, the default globs then pick up both copies: the suite
 * silently reports double the tests, and a stale compiled copy keeps passing
 * after its source has changed.
 *
 * Scoping `include` rather than extending `exclude` states the intent and does
 * not depend on what a future default happens to be.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
  },
});
