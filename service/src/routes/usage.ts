import { Router } from 'express';
import { getAccountUsage, getUserUsage } from '../services/usage.js';
import { optionalMonth } from '../validation.js';
import { accountId, userIdParam } from './common.js';

export const usageRoutes = Router();
usageRoutes.get('/usage', async (request, response) => {
  response.json(await getAccountUsage(accountId(request), optionalMonth(request.query.month)));
});
usageRoutes.get('/users/:userId/usage', async (request, response) => {
  const month = optionalMonth(request.query.month);
  const externalId = userIdParam(request);
  response.json(await getUserUsage(accountId(request), externalId, month));
});
