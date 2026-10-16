import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { pool } from './db/client.js';
import { readConfig } from './config.js';
import { HttpError } from './errors.js';
export function generateKey(): string { return 'mq_'+randomBytes(32).toString('base64url'); }
export function hashKey(key: string): string { return createHash('sha256').update(key).digest('hex'); }
export function adminAuth(req: Request, _res: Response, next: NextFunction): void {
  const expected=Buffer.from(readConfig().adminToken);
  const actual=Buffer.from(req.get('X-Admin-Token') ?? '');
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return next(new HttpError(401,'unauthorized','Invalid admin token'));
  next();
}
declare global { namespace Express { interface Request { accountId?: string } } }
export async function apiAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header=req.get('Authorization') ?? '';
    if (!/^ApiKey mq_[A-Za-z0-9_-]{43}$/.test(header)) throw new HttpError(401,'unauthorized','Invalid API key');
    const key=header.slice(7);
    const result=await pool.query('SELECT account_id FROM api_keys WHERE key_hash=$1',[hashKey(key)]);
    if (!result.rows[0]) throw new HttpError(401,'unauthorized','Invalid API key');
    req.accountId=result.rows[0].account_id;
    next();
  } catch (error) { next(error); }
}
