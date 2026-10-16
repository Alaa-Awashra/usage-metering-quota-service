import type { Request } from 'express';
import { str } from '../validation.js';

export const accountId = (request: Request): string => request.accountId!;
export const userIdParam = (request: Request): string => str(request.params.userId, 'userId');
