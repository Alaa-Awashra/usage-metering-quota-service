import express, { type Request, type Response, type NextFunction } from 'express';
import { pool } from './db/client.js';
import { apiAuth } from './auth.js';
import { HttpError } from './errors.js';
import { adminRoutes } from './routes/admin.js';
import { accountRoutes } from './routes/account.js';
import { planRoutes } from './routes/plans.js';
import { userRoutes } from './routes/users.js';
import { consumeRoutes } from './routes/consume.js';
import { usageRoutes } from './routes/usage.js';
import { historyRoutes } from './routes/history.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((request, response, next) => {
  const start = performance.now();
  response.on('finish', () => console.log(JSON.stringify({
    route: request.originalUrl.split('?')[0],
    status: response.statusCode,
    ms: Math.round(performance.now() - start),
    requestId: typeof request.body?.requestId === 'string' ? request.body.requestId : undefined,
  })));
  next();
});

app.get('/healthz', (_request, response) => response.json({ status: 'alive' }));
app.get('/readyz', async (_request, response) => {
  await pool.query('SELECT 1');
  response.json({ status: 'ready' });
});
app.use('/admin', adminRoutes);
app.use('/v1', apiAuth);
app.use('/v1', accountRoutes, planRoutes, userRoutes, consumeRoutes, usageRoutes, historyRoutes);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof HttpError) return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  const databaseError = error as { code?: string; type?: string };
  if (databaseError.type === 'entity.too.large') return response.status(413).json({ error: { code: 'too_large', message: 'Request body too large' } });
  if (error instanceof SyntaxError) return response.status(400).json({ error: { code: 'validation', message: 'Malformed JSON' } });
  if (databaseError.code === '23505') return response.status(409).json({ error: { code: 'conflict', message: 'Resource already exists' } });
  if (databaseError.code === '23503' || databaseError.code === '23514') return response.status(400).json({ error: { code: 'validation', message: 'Invalid resource relationship' } });
  if (databaseError.code === '40P01' || databaseError.code === '40001') {
    console.error(JSON.stringify({ error: 'retry_exhausted', pgCode: databaseError.code }));
    return response.status(503).json({ error: { code: 'retry_exhausted', message: 'Transaction could not complete; retry the request' } });
  }
  if (databaseError.code?.startsWith('08') || ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND'].includes(databaseError.code ?? '')) {
    console.error(JSON.stringify({ error: 'database_unavailable', pgCode: databaseError.code }));
    return response.status(503).json({ error: { code: 'database_unavailable', message: 'Database is unavailable' } });
  }
  console.error(JSON.stringify({ error: 'internal', pgCode: databaseError.code }));
  return response.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
});

export default app;
