import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { env } from './env.js';

const app = await buildApp();

/*
 * Containers get SIGTERM and then a hard kill. Draining rather than exiting on
 * the spot matters here because a question in flight holds an open model stream
 * and a DAX query; the delay is the budget for those to finish.
 */
closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) app.log.error({ err }, 'shutting down after an unhandled error');
  else app.log.info(`${signal} received, shutting down`);

  await app.close();
});

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
