import { Router } from 'express';
import { assert } from '../errors.js';
import { listRequests } from '../services/history.js';
import { str } from '../validation.js';
import { accountId } from './common.js';

export const historyRoutes = Router();
historyRoutes.get('/requests', async (request, response) => {
  const limit = request.query.limit === undefined ? 50 : Number(request.query.limit);
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 100, 400, 'validation', 'limit must be 1 to 100');
  let cursor = '9223372036854775807';
  if (request.query.cursor !== undefined) {
    assert(typeof request.query.cursor === 'string' && /^\d{1,19}$/.test(request.query.cursor), 400, 'validation', 'Invalid cursor');
    const value = BigInt(request.query.cursor);
    assert(value > 0n && value <= 9223372036854775807n, 400, 'validation', 'Invalid cursor');
    cursor = request.query.cursor;
  }
  const userFilter = request.query.userId === undefined ? null : str(request.query.userId, 'userId');
  response.json(await listRequests(accountId(request), { limit, cursor, userFilter }));
});
