import { neon } from '@neondatabase/serverless';

let sql;
export function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    sql = neon(url);
  }
  return sql;
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// Idempotent schema; also kept in db/schema.sql.
let ensured = null;
export function ensureSchema() {
  return (ensured ||= createSchema().catch(e => { ensured = null; throw e; }));
}
async function createSchema() {
  const q = db();
  await q`create table if not exists submissions (
    client_id uuid primary key,
    active_days smallint not null check (active_days between 1 and 30),
    total bigint not null,
    avg_daily bigint not null,
    claude_total bigint not null,
    codex_total bigint not null,
    cache_ratio real not null,
    output_ratio real not null,
    codex_plan text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await q`create index if not exists submissions_updated_idx on submissions (updated_at)`;
  await q`create table if not exists rate_limits (
    ip_hash text not null,
    day date not null,
    count int not null default 0,
    primary key (ip_hash, day)
  )`;
}
