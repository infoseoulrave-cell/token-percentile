import { createHash } from 'node:crypto';
import { db, json, ensureSchema } from './_db.js';
import { validateSubmission } from './_validate.js';

const DAILY_LIMIT = 5;    // submissions per hashed IP per day
const MAX_BODY = 2048;

function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for');
  return (xff ? xff.split(',')[0] : request.headers.get('x-real-ip') || '').trim() || 'unknown';
}

export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === new URL(request.url).host; } catch { ok = false; }
    if (!ok) return json({ error: 'forbidden origin' }, 403);
  }

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'body too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'invalid json' }, 400); }
  const { value, error } = validateSubmission(body);
  if (error) return json({ error }, 400);

  const salt = process.env.RATE_SALT;
  if (!salt) return json({ error: 'server not configured' }, 500);

  try {
    await ensureSchema();
    const sql = db();
    const day = new Date().toISOString().slice(0, 10);
    const ipHash = createHash('sha256').update(`${salt}|${day}|${clientIp(request)}`).digest('hex');
    const [{ count }] = await sql`
      insert into rate_limits (ip_hash, day, count) values (${ipHash}, ${day}, 1)
      on conflict (ip_hash, day) do update set count = rate_limits.count + 1
      returning count`;
    await sql`delete from rate_limits where day < current_date - 1`;
    await sql`delete from submissions where updated_at < now() - interval '180 days'`;
    if (count > DAILY_LIMIT) return json({ error: '오늘 제출 횟수를 넘었어요. 내일 다시 시도해 주세요.' }, 429);

    const v = value;
    await sql`
      insert into submissions (client_id, active_days, total, avg_daily, claude_total, codex_total, cache_ratio, output_ratio, codex_plan)
      values (${v.clientId}, ${v.activeDays}, ${v.total}, ${v.avgDaily}, ${v.claudeTotal}, ${v.codexTotal}, ${v.cacheRatio}, ${v.outputRatio}, ${v.codexPlan})
      on conflict (client_id) do update set
        active_days = excluded.active_days, total = excluded.total, avg_daily = excluded.avg_daily,
        claude_total = excluded.claude_total, codex_total = excluded.codex_total,
        cache_ratio = excluded.cache_ratio, output_ratio = excluded.output_ratio,
        codex_plan = excluded.codex_plan, updated_at = now()`;
    return json({ ok: true });
  } catch (e) {
    console.error('submit failed', e);
    return json({ error: '저장 중 오류가 났어요.' }, 500);
  }
}
