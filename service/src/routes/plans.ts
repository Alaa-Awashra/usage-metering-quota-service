import { Router } from 'express';
import { assert } from '../errors.js';
import { createPlan, getPlan, listPlans, updatePlan } from '../services/plans.js';
import { object, str, units, uuid } from '../validation.js';
import { accountId } from './common.js';

export const planRoutes = Router();
planRoutes.get('/plans', async (request, response) => {
  response.json(await listPlans(accountId(request)));
});
planRoutes.post('/plans', async (request, response) => {
  const body = object(request.body);
  const name = str(body.name, 'name');
  assert(body.scope === 'account' || body.scope === 'user', 400, 'validation', 'scope must be account or user');
  const monthlyLimit = units(body.monthlyLimit, 'monthlyLimit', true);
  const maxPerRequest = units(body.maxPerRequest, 'maxPerRequest');
  response.status(201).json(await createPlan(accountId(request), { name, scope: body.scope, monthlyLimit, maxPerRequest }));
});
planRoutes.get('/plans/:id', async (request, response) => {
  response.json(await getPlan(accountId(request), uuid(request.params.id)));
});
planRoutes.patch('/plans/:id', async (request, response) => {
  const planId = uuid(request.params.id);
  const body = object(request.body);
  assert(Object.keys(body).length > 0 && Object.keys(body).every(key => ['name', 'monthlyLimit', 'maxPerRequest'].includes(key)), 400, 'validation', 'Invalid plan fields');
  const name = body.name === undefined ? undefined : str(body.name, 'name');
  const monthlyLimit = body.monthlyLimit === undefined ? undefined : units(body.monthlyLimit, 'monthlyLimit', true);
  const maxPerRequest = body.maxPerRequest === undefined ? undefined : units(body.maxPerRequest, 'maxPerRequest');
  response.json(await updatePlan(accountId(request), planId, { name, monthlyLimit, maxPerRequest }));
});
