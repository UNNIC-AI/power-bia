import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import '../lib/i18n.ts';
import { server } from './server.ts';

// jsdom implements neither, and the router's scroll restoration calls both.
window.scrollTo = () => {};
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

/*
 * The network is stubbed at the HTTP layer, not at the API client: that keeps
 * `lib/api.ts`, the error mapping and the TanStack Query wiring inside the test,
 * which is where the interesting bugs are.
 *
 * `error` on an unhandled request rather than `warn`, so a request nobody
 * stubbed fails the test instead of quietly returning undefined.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
});

afterAll(() => server.close());
