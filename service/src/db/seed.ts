import { db, pool } from './client.js';
import { plans } from './schema.js';
import { fileURLToPath } from 'node:url';
export async function seed():Promise<void> {
  const values=[
    {scope:'account',name:'Starter',monthlyLimit:10000,maxPerRequest:100},
    {scope:'account',name:'Pro',monthlyLimit:100000,maxPerRequest:500},
    {scope:'user',name:'Basic',monthlyLimit:1000,maxPerRequest:20},
    {scope:'user',name:'Premium',monthlyLimit:5000,maxPerRequest:100},
  ];
  for(const value of values) await db.insert(plans).values(value).onConflictDoNothing();
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) seed().then(()=>pool.end()).catch(async e=>{console.error(e);await pool.end();process.exitCode=1;});
