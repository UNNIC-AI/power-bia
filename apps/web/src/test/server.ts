import { setupServer } from 'msw/node';

/**
 * Empty by default: every test declares the responses it depends on with
 * `server.use(...)`, so a handler cannot leak between files and no test relies
 * on a shared fixture it did not ask for.
 */
export const server = setupServer();
