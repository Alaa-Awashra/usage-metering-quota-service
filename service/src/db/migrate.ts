import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pool } from './client.js';
export async function runMigrations():Promise<void> {
  const client=await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(801047123)');
    const folder=join(process.cwd(),'src','db','migrations');
    await migrate(drizzle(client),{migrationsFolder:folder});
  } finally { await client.query('SELECT pg_advisory_unlock(801047123)').catch(()=>{}); client.release(); }
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) runMigrations().then(()=>pool.end()).catch(async e=>{console.error(e);await pool.end();process.exitCode=1;});
