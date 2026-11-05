// Usage: node --env-file=.env.local scripts/db-check.mjs [deleteClientId]
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const id = process.argv[2];
console.log('latest', await sql`select client_id, active_days, total, avg_daily, codex_plan, created_at from submissions order by created_at desc limit 5`);
if (id) { const r = await sql`delete from submissions where client_id = ${id} returning client_id`; console.log('deleted', r); }
console.log('count', await sql`select count(*)::int n from submissions`);
