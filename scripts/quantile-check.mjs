// Verifies the stats query shape on synthetic values (no table writes).
// Usage: node --env-file=.env.local scripts/quantile-check.mjs
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const PS = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
const vals = Array.from({ length: 100 }, (_, i) => (i + 1) * 1000);
const [row] = await sql`
  select count(*)::int as n, percentile_cont(${PS}::float8[]) within group (order by v) as q
  from unnest(${vals}::bigint[]) as t(v)`;
console.log('n', row.n, 'len', row.q.length, 'p1', row.q[0], 'p50', row.q[49], 'p99', row.q[98], typeof row.q[0]);
