import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readConfig } from '../config.js';
const config = readConfig();
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolSize });
export const db = drizzle(pool);
