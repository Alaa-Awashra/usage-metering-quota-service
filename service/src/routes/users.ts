import { Router } from 'express';
import { registerUser, getUser, changeUserPlan } from '../services/users.js';
import { object, str, uuid } from '../validation.js';
import { accountId, userIdParam } from './common.js';

export const userRoutes = Router();
userRoutes.post('/users', async (request, response) => {
  const body = object(request.body);
  const externalId = str(body.externalId, 'externalId');
  const planId = uuid(body.planId, 'planId');
  response.status(201).json(await registerUser(accountId(request), externalId, planId));
});
userRoutes.get('/users/:userId', async (request, response) => {
  response.json(await getUser(accountId(request), userIdParam(request)));
});
userRoutes.put('/users/:userId/plan', async (request, response) => {
  const externalId = userIdParam(request);
  const body = object(request.body);
  const planId = uuid(body.planId, 'planId');
  response.json(await changeUserPlan(accountId(request), externalId, planId));
});
