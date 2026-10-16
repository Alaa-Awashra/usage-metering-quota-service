import app from './app.js';
import { readConfig } from './config.js';
import { pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
const config=readConfig();
try {
  await runMigrations();
  await seed();
  const server=app.listen(config.port,()=>console.log(JSON.stringify({event:'listening',port:config.port})));
  const close=()=>server.close(()=>pool.end().then(()=>process.exit(0)));
  process.on('SIGTERM',close);process.on('SIGINT',close);
} catch(e) { console.error(e); await pool.end(); process.exitCode=1; }
