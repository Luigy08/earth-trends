import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { verifyAppCheck, verifyIdToken } from './auth';
import type { CallableHandler } from './backend.types';
import { handleBalamApi } from './balam/balam.functions';
import { CONFIG, HTTP_STATUS, MAX_BODY_BYTES } from './config.constant';
import { disconnectPrisma } from './db/client';
import { HttpsError } from './http';
import * as endpoints from './index';
import { logger } from './logger';

const isCallable = (value: unknown): value is CallableHandler => typeof value === 'object' && value !== null && 'callable' in value;

function sendError(response: Response, error: unknown, endpoint: string): void {
  if (error instanceof HttpsError) {
    response.status(HTTP_STATUS[error.code]).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    return;
  }
  // Unexpected failures are logged by name only: messages may carry provider or request details.
  logger.error('Request failed', { endpoint, kind: error instanceof Error ? error.name : 'unknown' });
  response.status(HTTP_STATUS.internal).json({ error: { code: 'internal', message: 'The request could not be completed.' } });
}

const app = express();
app.disable('x-powered-by');
// The host's load balancer terminates TLS and forwards the request.
app.set('trust proxy', 1);
app.get('/healthz', (_request, response) => { response.json({ status: 'ok' }); });
app.use(cors({ origin: [...CONFIG.corsOrigins], methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Firebase-AppCheck'], maxAge: 3600 }));
app.use(express.json({ limit: MAX_BODY_BYTES }));

// Every callable is `POST /api/<name>` with `{ data }`, answering `{ result }` or `{ error: { code, message } }`.
for (const [name, endpoint] of Object.entries(endpoints)) {
  if (!isCallable(endpoint)) continue;
  app.post(`/api/${name}`, async (request, response) => {
    try {
      await verifyAppCheck(request.get('x-firebase-appcheck'));
      const token = await verifyIdToken(request.get('authorization'));
      const body = request.body as { data?: unknown } | undefined;
      const result = await endpoint.run({ data: body?.data, ...(token ? { auth: { uid: token.uid, token } } : {}) });
      response.json({ result: result ?? null });
    } catch (error) { sendError(response, error, name); }
  });
}

app.use('/balam', (request, response) => { void handleBalamApi(request, response); });
app.use((_request, response) => { sendError(response, new HttpsError('not-found', 'Not found.'), 'unknown'); });
app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  // Body parser rejections: malformed JSON or a body over the size limit.
  const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
  sendError(response, new HttpsError(tooLarge ? 'resource-exhausted' : 'invalid-argument', tooLarge ? 'The request is too large.' : 'The request is not valid JSON.'), request.path);
});

const server = app.listen(CONFIG.port, () => {
  logger.info('Server listening', { port: CONFIG.port });
  endpoints.analysisWorker.start();
});

// On a deploy or restart: stop taking work, let open requests finish. An interrupted analysis keeps its lease
// and is retried by the next process once the lease expires.
process.on('SIGTERM', () => {
  endpoints.analysisWorker.stop();
  server.close(() => { void disconnectPrisma().finally(() => process.exit(0)); });
});
