import { db, json, ensureSchema } from './_db.js';

// 99 points: p = 0.01 ... 0.99 (tails clamped so no single submitter's exact min/max is exposed).
const PS = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
const MIN_N_FOR_QUANTILES = 20;

export async function GET() {
  try {
    await ensureSchema();
    const sql = db();
    const [row] = await sql`
      select count(*)::int as n,
             percentile_cont(${PS}::float8[]) within group (order by avg_daily) as q
      from submissions
      where updated_at > now() - interval '90 days'`;
    const n = row?.n || 0;
    const quantiles = n >= MIN_N_FOR_QUANTILES && row.q ? row.q.map(x => Math.round(Number(x))) : null;
    return json({ n, metric: 'avg_daily_tokens_30d', windowDays: 90, pFrom: 0.01, pTo: 0.99, quantiles },
      200, { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' });
  } catch (e) {
    console.error('stats failed', e);
    return json({ n: 0, quantiles: null, error: 'unavailable' }, 503);
  }
}
