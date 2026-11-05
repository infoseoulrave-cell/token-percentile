// Shared log parser for Claude Code (~/.claude/projects/**/*.jsonl)
// and Codex (~/.codex/sessions/**/*.jsonl). Runs in a browser worker and in Node tests.
// Everything stays local; only aggregate numbers leave this module.

export const WINDOW_DAYS = 30;

const pad = n => String(n).padStart(2, '0');
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function windowStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - (WINDOW_DAYS - 1));
  return d;
}

const baseName = p => (p ? String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null : null);
const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const emptyUsage = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const usageTotal = u => u.input + u.cacheWrite + u.cacheRead + u.output;

// Codex counts cached and cache-write tokens inside input_tokens; split them out.
function codexUsage(u) {
  const cached = num(u.cached_input_tokens), write = num(u.cache_write_input_tokens);
  return { input: Math.max(0, num(u.input_tokens) - cached - write), cacheWrite: write, cacheRead: cached, output: num(u.output_tokens) };
}

export function classifyPath(path) {
  const p = path.replace(/\\/g, '/');
  if (!p.endsWith('.jsonl')) return null;
  if (/(^|\/)\.?codex\/(archived_)?sessions\//.test(p) || /(^|\/)(archived_)?sessions\/\d{4}\//.test(p) || /rollout-[^/]*\.jsonl$/.test(p)) return 'codex';
  if (/(^|\/)projects\//.test(p) || /(^|\/)\.claude\//.test(p)) return 'claude';
  return null;
}

export function createAggregator({ now = new Date() } = {}) {
  const start = windowStart(now).getTime();
  const end = now.getTime();
  const claude = new Map();        // dedupe key -> record
  const codexEvents = [];          // finished codex records
  let codexFile = null;
  let codexPlan = null;            // latest rate-limit snapshot
  const stats = { claudeLines: 0, codexFiles: 0, badLines: 0 };

  const inWindow = ts => ts >= start && ts <= end;

  function addClaudeLine(line, fallbackProject) {
    if (!line.includes('"usage"')) return;
    let o; try { o = JSON.parse(line); } catch { stats.badLines++; return; }
    const m = o && o.message;
    if (o.type !== 'assistant' || !m || !m.usage) return;
    if (m.model === '<synthetic>') return;
    const ts = Date.parse(o.timestamp);
    if (!inWindow(ts)) return;
    stats.claudeLines++;
    const u = m.usage;
    const rec = {
      ts, tool: 'claude', model: m.model || 'unknown', project: baseName(o.cwd) || fallbackProject || 'unknown',
      input: num(u.input_tokens), cacheWrite: num(u.cache_creation_input_tokens),
      cacheRead: num(u.cache_read_input_tokens), output: num(u.output_tokens),
    };
    // Streaming writes one line per content block with the same message id; keep the max per field.
    const key = m.id ? `${m.id}:${o.requestId || ''}` : `${o.uuid || ts}`;
    const prev = claude.get(key);
    if (!prev) { claude.set(key, rec); return; }
    for (const f of ['input', 'cacheWrite', 'cacheRead', 'output']) prev[f] = Math.max(prev[f], rec[f]);
  }

  function beginCodexFile() {
    codexFile = { model: 'unknown', project: 'unknown', records: new Map(), deltas: [], last: null };
    stats.codexFiles++;
  }

  function addCodexLine(line) {
    if (!codexFile) beginCodexFile();
    const isMeta = line.includes('"session_meta"'), isCtx = line.includes('"turn_context"');
    const isRec = line.includes('"token_usage_record"'), isCount = line.includes('"token_count"');
    if (!isMeta && !isCtx && !isRec && !isCount) return;
    let o; try { o = JSON.parse(line); } catch { stats.badLines++; return; }
    const p = o && o.payload;
    if (!p) return;
    const ts = Date.parse(o.timestamp);
    const f = codexFile;
    if (o.type === 'session_meta') { f.project = baseName(p.cwd) || f.project; if (p.model) f.model = p.model; return; }
    if (o.type === 'turn_context') { if (p.model) f.model = p.model; if (p.cwd) f.project = baseName(p.cwd) || f.project; return; }
    if (o.type === 'token_usage_record' && p.usage) {
      const key = p.response_id || `${ts}:${f.records.size}`;
      if (!f.records.has(key)) f.records.set(key, { ts, model: f.model, project: f.project, ...codexUsage(p.usage) });
      return;
    }
    if (p.type === 'token_count') {
      if (p.rate_limits && p.rate_limits.plan_type && (!codexPlan || ts >= codexPlan.ts)) {
        const pr = p.rate_limits.primary || {};
        const finite = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        codexPlan = { ts, plan: String(p.rate_limits.plan_type).slice(0, 40), usedPercent: finite(pr.used_percent), windowMinutes: finite(pr.window_minutes) };
      }
      const tot = p.info && p.info.total_token_usage;
      if (!tot) return;
      const cur = codexUsage(tot);
      let d = cur;
      if (f.last) {
        d = { input: cur.input - f.last.input, cacheWrite: cur.cacheWrite - f.last.cacheWrite, cacheRead: cur.cacheRead - f.last.cacheRead, output: cur.output - f.last.output };
        if (d.input < 0 || d.cacheWrite < 0 || d.cacheRead < 0 || d.output < 0) d = cur; // counter reset
      }
      f.last = cur;
      if (usageTotal(d) > 0) f.deltas.push({ ts, model: f.model, project: f.project, ...d });
    }
  }

  function endCodexFile() {
    if (!codexFile) return;
    // Prefer exact per-response records; fall back to cumulative-counter deltas for older logs.
    const list = codexFile.records.size ? [...codexFile.records.values()] : codexFile.deltas;
    for (const r of list) if (inWindow(r.ts)) codexEvents.push({ ...r, tool: 'codex' });
    codexFile = null;
  }

  function result() {
    endCodexFile();
    const days = Object.create(null), models = new Map(), projects = new Map(), hours = new Array(24).fill(0);
    const totals = { claude: emptyUsage(), codex: emptyUsage() };
    const add = (r) => {
      const t = usageTotal(r);
      if (!t) return;
      const d = new Date(r.ts), k = dayKey(d);
      (days[k] ||= { claude: 0, codex: 0 })[r.tool] += t;
      const mk = `${r.tool}\u0000${r.model}`;
      models.set(mk, (models.get(mk) || 0) + t);
      projects.set(r.project, (projects.get(r.project) || 0) + t);
      hours[d.getHours()] += t;
      for (const f of ['input', 'cacheWrite', 'cacheRead', 'output']) totals[r.tool][f] += r[f];
    };
    for (const r of claude.values()) add(r);
    for (const r of codexEvents) add(r);

    const dayList = [];
    for (let d = windowStart(now); d.getTime() <= now.getTime(); d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      dayList.push({ day: k, claude: days[k]?.claude || 0, codex: days[k]?.codex || 0 });
    }
    const claudeTotal = usageTotal(totals.claude), codexTotal = usageTotal(totals.codex);
    const total = claudeTotal + codexTotal;
    const activeDays = dayList.filter(d => d.claude + d.codex > 0).length;
    const inputSide = totals.claude.input + totals.claude.cacheWrite + totals.claude.cacheRead
                    + totals.codex.input + totals.codex.cacheWrite + totals.codex.cacheRead;
    const cacheRead = totals.claude.cacheRead + totals.codex.cacheRead;
    const output = totals.claude.output + totals.codex.output;
    return {
      windowDays: WINDOW_DAYS,
      total, claudeTotal, codexTotal, activeDays,
      avgDaily: activeDays ? Math.round(total / activeDays) : 0,
      cacheRatio: inputSide ? cacheRead / inputSide : 0,
      outputRatio: total ? output / total : 0,
      totals, days: dayList, hours,
      models: [...models].map(([k, v]) => { const i = k.indexOf('\u0000'); return { tool: k.slice(0, i), model: k.slice(i + 1), tokens: v }; }).sort((a, b) => b.tokens - a.tokens),
      projects: [...projects].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens),
      codexPlan: codexPlan && { plan: codexPlan.plan, usedPercent: codexPlan.usedPercent, windowMinutes: codexPlan.windowMinutes },
      stats: { ...stats, claudeMessages: claude.size, codexRecords: codexEvents.length },
    };
  }

  return { addClaudeLine, beginCodexFile, addCodexLine, endCodexFile, result, windowStartMs: start };
}
