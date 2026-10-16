import { Router } from 'express';
import { getAccount, changeAccountPlan } from '../services/accounts.js';
import { object, uuid } from '../validation.js';
import { accountId } from './common.js';

export const accountRoutes = Router();
accountRoutes.get('/account', async (request, response) => {
  response.json(await getAccount(accountId(request)));
});
accountRoutes.put('/account/plan', async (request, response) => {
  const body = object(request.body);
  const planId = uuid(body.planId, 'planId');
  response.json(await changeAccountPlan(accountId(request), planId));
});
