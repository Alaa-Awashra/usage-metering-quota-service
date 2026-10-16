export interface Config { databaseUrl: string; adminToken: string; port: number; poolSize: number }
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  const adminToken = env.ADMIN_TOKEN;
  const port = Number(env.PORT ?? 3000);
  const poolSize = Number(env.DB_POOL_SIZE ?? 20);
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  if (!adminToken || adminToken.length < 32 || /^(replace|changeme|secret|password)/i.test(adminToken)) throw new Error('ADMIN_TOKEN must be a random secret of at least 32 characters');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100) throw new Error('DB_POOL_SIZE is invalid');
  return { databaseUrl, adminToken, port, poolSize };
}
