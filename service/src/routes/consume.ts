import { Router } from 'express';
import { consume } from '../accounting/consume.js';
import { object, str, units } from '../validation.js';
import { accountId } from './common.js';

export const consumeRoutes = Router();
consumeRoutes.post('/consume', async (request, response) => {
  const body = object(request.body);
  const externalId = str(body.userId, 'userId');
  const amount = units(body.units, 'units');
  const requestId = str(body.requestId, 'requestId', 128);
  response.json(await consume({ accountId: accountId(request), externalId, units: amount, requestId }));
});
