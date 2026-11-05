// Node check: run the same parser over local logs.  node scripts/scan-local.mjs [--json]
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createAggregator, classifyPath } from '../lib/parse.js';

const agg = createAggregator();
const cutoff = agg.windowStartMs;

function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

const roots = [join(homedir(), '.claude', 'projects'), join(homedir(), '.codex', 'sessions'), join(homedir(), '.codex', 'archived_sessions')];
let files = 0;
for (const root of roots) {
  for (const f of walk(root)) {
    if (statSync(f).mtimeMs < cutoff) continue;
    const kind = classifyPath(f);
    if (!kind) continue;
    files++;
    const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
    if (kind === 'codex') agg.beginCodexFile();
    for await (const line of rl) kind === 'codex' ? agg.addCodexLine(line) : agg.addClaudeLine(line, null);
    if (kind === 'codex') agg.endCodexFile();
  }
}
const r = agg.result();
if (process.argv.includes('--json')) { console.log(JSON.stringify(r)); process.exit(0); }
const M = n => (n / 1e6).toFixed(1) + 'M';
console.log(`files ${files} | total ${M(r.total)} (claude ${M(r.claudeTotal)}, codex ${M(r.codexTotal)}) | active ${r.activeDays}d | avg/day ${M(r.avgDaily)} | cache ${(r.cacheRatio * 100).toFixed(1)}%`);
console.log('claude parts', Object.fromEntries(Object.entries(r.totals.claude).map(([k, v]) => [k, M(v)])));
console.log('codex parts ', Object.fromEntries(Object.entries(r.totals.codex).map(([k, v]) => [k, M(v)])));
console.log('days', r.days.map(d => `${d.day.slice(5)}:${M(d.claude)}/${M(d.codex)}`).join(' '));
console.log('models', r.models.slice(0, 6).map(m => `${m.tool}:${m.model}=${M(m.tokens)}`).join(', '));
console.log('plan', r.codexPlan, 'stats', r.stats);
