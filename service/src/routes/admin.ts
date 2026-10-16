import { Router } from 'express';
import { adminAuth } from '../auth.js';
import { createAccount } from '../services/accounts.js';
import { object, str } from '../validation.js';

export const adminRoutes = Router();
adminRoutes.post('/accounts', adminAuth, async (request, response) => {
  const body = object(request.body);
  const name = str(body.name, 'name');
  const planName = str(body.planName, 'planName');
  response.status(201).json(await createAccount(name, planName));
});
