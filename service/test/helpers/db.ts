import { strictEqual } from 'node:assert';
export async function setup() {
  const url=process.env.TEST_DATABASE_URL;
  if(!url) throw new Error('TEST_DATABASE_URL is required for PostgreSQL tests');
  const dbName=new URL(url).pathname.slice(1);
  if(!dbName.endsWith('_test')) throw new Error('Refusing to run tests outside a _test database');
  process.env.DATABASE_URL=url;
  process.env.ADMIN_TOKEN='test-admin-token-longer-than-thirty-two-characters';
  const {runMigrations}=await import('../../src/db/migrate.js');
  const {seed}=await import('../../src/db/seed.js');
  const {pool}=await import('../../src/db/client.js');
  await runMigrations(); await seed();
  const {default:app}=await import('../../src/app.js');
  const server=app.listen(0);
  await new Promise<void>(r=>server.once('listening',r));
  const address=server.address(); strictEqual(typeof address,'object');
  const base=`http://127.0.0.1:${(address as {port:number}).port}`;
  async function call(path:string, method='GET',body?:unknown,key?:string,admin=false) {
    const response=await fetch(base+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{Authorization:`ApiKey ${key}`}:{}) ,...(admin?{'X-Admin-Token':process.env.ADMIN_TOKEN!}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json() as any};
  }
  async function account(planName='Starter') { const r=await call('/admin/accounts','POST',{name:`test-${crypto.randomUUID()}`,planName},undefined,true); strictEqual(r.status,201); return r.data as {id:string;apiKey:string}; }
  async function close() { await new Promise<void>(r=>server.close(()=>r())); }
  return {pool,base,call,account,close};
}
