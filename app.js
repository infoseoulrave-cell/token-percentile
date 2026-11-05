import { classifyPath, windowStart } from './lib/parse.js';

const $ = id => document.getElementById(id);
const EN = document.documentElement.lang === 'en';
const L = (ko, en) => (EN ? en : ko);
const LOCALE = EN ? 'en-US' : 'ko-KR';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- formatting ----------
export function fmtTokens(n) {
  if (EN) {
    if (n >= 1e12) return +(n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return +(n / 1e9).toFixed(n >= 1e11 ? 0 : 2) + 'B';
    if (n >= 1e6) return +(n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return +(n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
    return Math.round(n).toLocaleString(LOCALE);
  }
  if (n >= 1e12) return +(n / 1e12).toFixed(2) + '조';
  if (n >= 1e8) return +(n / 1e8).toFixed(n >= 1e10 ? 0 : 2) + '억';
  if (n >= 1e4) return +(n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + '만';
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtTop(p) {
  if (EN) {
    if (p < 0.01) return { pre: 'Top', val: '<0.01', post: '%' };
    if (p > 99.99) return { pre: 'Bottom', val: '<0.01', post: '%' };
    if (p > 99) return { pre: 'Bottom', val: (100 - p).toFixed(2), post: '%' };
    return { pre: 'Top', val: p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p).toString(), post: '%' };
  }
  if (p < 0.01) return { pre: '상위', val: '0.01', post: '% 미만' };
  if (p > 99.99) return { pre: '하위', val: '0.01', post: '% 미만' };
  if (p > 99) return { pre: '하위', val: (100 - p).toFixed(2), post: '%' };
  const v = p < 1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : Math.round(p).toString();
  return { pre: '상위', val: v, post: '%' };
}
const topText = p => { const f = fmtTop(p); return `${f.pre} ${f.val}${f.post}`; };
function comment(top) {
  if (EN) {
    if (top <= 1) return 'You are among the heaviest users.';
    if (top <= 10) return 'Serious power user.';
    if (top <= 30) return 'Well above average.';
    if (top <= 60) return 'Right around the middle.';
    if (top <= 90) return 'A fairly light user.';
    return 'A very light user.';
  }
  if (top <= 1) return '최상위 헤비 유저예요.';
  if (top <= 10) return '상당한 파워 유저예요.';
  if (top <= 30) return '평균보다 꽤 많이 쓰는 편이에요.';
  if (top <= 60) return '딱 중간 근처예요.';
  if (top <= 90) return '가볍게 쓰는 편이에요.';
  return '아주 가볍게 쓰는 편이에요.';
}

// ---------- official-figure estimate (log-normal fit) ----------
const S = 1.28, MU = Math.log(13) - S * S / 2, DAYS_PER_MONTH = 15;
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
const estimateTop = (dailyTokens, rate) => (1 - phi((Math.log(dailyTokens / 1e6 * rate) - MU) / S)) * 100;
const getRate = () => { const r = parseFloat($('rate').value); return r > 0 ? r : 0.55; };

// ---------- measured distribution (submissions) ----------
let stats = null;
async function loadStats() {
  try {
    const r = await fetch('/api/stats', { cache: 'no-store' });
    if (r.ok) stats = await r.json();
  } catch { stats = null; }
  return stats;
}
// quantiles: values at p = pFrom..pTo evenly spaced. Returns { top, edge } (top = % of submitters above v).
function measuredTop(v) {
  if (!stats || !stats.n || !stats.quantiles || !stats.quantiles.length) return null;
  const q = stats.quantiles, L = q.length - 1, p0 = stats.pFrom ?? 0, p1 = stats.pTo ?? 1;
  if (v < q[0]) return { top: 100 - p0 * 100, edge: 'bottom' };
  if (v > q[L]) return { top: 100 - p1 * 100, edge: 'top' };
  let i = 0; while (i < L && q[i + 1] < v) i++;
  const a = Math.log(Math.max(q[i], 1)), b = Math.log(Math.max(q[i + 1], 1));
  const frac = b > a ? Math.min(1, Math.max(0, (Math.log(v) - a) / (b - a))) : 0.5;
  return { top: 100 - (p0 + (p1 - p0) * (i + frac) / L) * 100, edge: null };
}
const measuredText = m => m.edge === 'top' ? L(`상위 ${+m.top.toFixed(2)}% 이내`, `within the top ${+m.top.toFixed(2)}%`)
  : m.edge === 'bottom' ? L(`하위 ${+(100 - m.top).toFixed(2)}% 이내`, `within the bottom ${+(100 - m.top).toFixed(2)}%`) : topText(m.top);

// ---------- folder selection ----------
const chosen = new Map(); // relPath -> { file, kind }
const cutoff = windowStart().getTime();
let skippedOld = 0;

function addFile(file, relPath, fallbackKind) {
  const path = relPath || file.webkitRelativePath || file.name;
  if (!path.endsWith('.jsonl')) return;
  let kind = classifyPath(path) || fallbackKind || (/rollout-/.test(path) ? 'codex' : 'claude');
  if (file.lastModified < cutoff) { skippedOld++; return; }
  chosen.set(path, { file, kind });
}
function refreshChosen() {
  const c = { claude: [0, 0], codex: [0, 0] };
  for (const { file, kind } of chosen.values()) { c[kind][0]++; c[kind][1] += file.size; }
  const mb = b => (b / 1048576).toFixed(b > 1048576 * 10 ? 0 : 1) + 'MB';
  $('chips').innerHTML = ['claude', 'codex'].filter(k => c[k][0]).map(k =>
    `<span class="chip"><i class="dot ${k}"></i>${k === 'claude' ? 'Claude Code' : 'Codex'} · ${L(`파일 ${c[k][0]}개`, `${c[k][0]} files`)} · ${mb(c[k][1])}</span>`).join('')
    + (chosen.size ? `<button type="button" class="link" id="clear">${L('비우기', 'Clear')}</button>` : '');
  $('analyze').disabled = chosen.size === 0;
  const clr = $('clear'); if (clr) clr.onclick = () => { chosen.clear(); skippedOld = 0; refreshChosen(); };
}
for (const [btn, input, kind] of [['pickClaude', 'inClaude', 'claude'], ['pickCodex', 'inCodex', 'codex']]) {
  $(btn).onclick = () => $(input).click();
  $(input).onchange = e => { for (const f of e.target.files) addFile(f, null, kind); e.target.value = ''; refreshChosen(); };
}

async function walkEntry(entry, out) {
  if (entry.isFile) { await new Promise(res => entry.file(f => { out.push([f, entry.fullPath.replace(/^\//, '')]); res(); }, res)); return; }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise(res => reader.readEntries(res, () => res([])));
    if (!batch.length) break;
    for (const e of batch) await walkEntry(e, out);
  }
}
const drop = $('drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async e => {
  const entries = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  $('chips').innerHTML = `<span class="muted">${L('폴더 읽는 중…', 'Reading folder…')}</span>`;
  for (const en of entries) await walkEntry(en, out);
  for (const [f, p] of out) addFile(f, p, null);
  refreshChosen();
});

// OS-specific instructions
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
function setOS(mac) {
  document.querySelectorAll('#os button').forEach(b => b.classList.toggle('on', (b.dataset.os === 'mac') === mac));
  $('howto').innerHTML = mac
    ? `<li>Claude Code: <code>~/.claude/projects</code> · Codex: <code>~/.codex/sessions</code></li>
       <li>${L('폴더 선택 창에서 <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd>를 누르고 위 경로를 붙여 넣으세요. (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd>로 숨김 폴더 표시)',
         'In the folder picker press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd> and paste the path above. (<kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd> shows hidden folders)')}</li>`
    : `<li>Claude Code: <code>%USERPROFILE%\\.claude\\projects</code> · Codex: <code>%USERPROFILE%\\.codex\\sessions</code></li>
       <li>${L('폴더 선택 창 위쪽 주소창에 위 경로를 붙여 넣고 Enter → [폴더 선택]을 누르세요.', 'Paste the path above into the address bar of the folder picker, press Enter, then click [Select Folder].')}</li>`;
}
document.querySelectorAll('#os button').forEach(b => b.onclick = () => setOS(b.dataset.os === 'mac'));
setOS(isMac);

// ---------- analysis ----------
let report = null;
$('analyze').onclick = () => {
  const items = [...chosen.values()];
  if (!items.length) return;
  $('analyze').disabled = true;
  $('progress').hidden = false; $('bar').style.width = '0%';
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = async ({ data }) => {
    if (data.type === 'progress') { $('bar').style.width = (data.ratio * 100).toFixed(1) + '%'; return; }
    worker.terminate();
    $('progress').hidden = true; $('analyze').disabled = false;
    if (data.type === 'error') { $('chips').insertAdjacentHTML('beforeend', `<span class="err">${L('분석 실패', 'Analysis failed')}: ${esc(data.message)}</span>`); return; }
    report = data.result;
    await loadStats();
    renderReport();
  };
  worker.postMessage({ items });
};

// ---------- charts ----------
const tip = $('tip');
function showTip(e, html) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect(), x = Math.min(e.clientX + 14, innerWidth - r.width - 8), y = Math.max(e.clientY - r.height - 12, 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.hidden = true; };

function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }

// series: [{ key, label, cls }]; rows: [{ label, tip, values:{key:n} }]
function barChart(svg, rows, series, { height = 220 } = {}) {
  const W = 640, H = height, L = 52, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(...rows.map(r => series.reduce((s, k) => s + (r.values[k.key] || 0), 0)), 0));
  const bw = (W - L - R) / rows.length, y = v => T + (H - T - B) * (1 - v / max);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v ? fmtTokens(v) : 0}</text>`;
  }
  let bars = '';
  const every = Math.ceil(rows.length / 8);
  rows.forEach((r, i) => {
    const x = L + i * bw + Math.max(1, bw * 0.15), w = Math.max(2, bw * 0.7);
    let acc = 0;
    const segs = series.filter(s => r.values[s.key] > 0);
    segs.forEach((s, j) => {
      const v = r.values[s.key], y0 = y(acc), y1 = y(acc + v);
      const gap = j > 0 ? 2 : 0, h = Math.max(0, y0 - y1 - gap);
      if (h > 0) bars += `<rect x="${x}" y="${y1}" width="${w}" height="${h}" rx="${j === segs.length - 1 ? Math.min(3, w / 2) : 0}" class="s-${s.cls}"/>`;
      acc += v;
    });
    if (i % every === 0) bars += `<text x="${x + w / 2}" y="${H - 8}" class="axis" text-anchor="middle">${esc(r.label)}</text>`;
    bars += `<rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent" data-i="${i}"/>`;
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g + `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="base"/>` + bars;
  svg.onmousemove = e => { const i = e.target.dataset && e.target.dataset.i; if (i == null) return hideTip(); showTip(e, rows[i].tip); };
  svg.onmouseleave = hideTip;
}

// ---------- report ----------
function rankBlock() {
  const r = report, rate = getRate();
  const est = r.avgDaily ? estimateTop(r.avgDaily, rate) : null;
  const meas = r.avgDaily ? measuredTop(r.avgDaily) : null;
  const n = stats?.n || 0;
  const useMeasured = meas != null && n >= 30;
  const primary = useMeasured ? meas.top : est;
  const f = useMeasured && meas.edge === 'top' ? { pre: L('상위', 'Top'), val: String(+meas.top.toFixed(2)), post: L('% 이내', '% or higher') }
    : useMeasured && meas.edge === 'bottom' ? { pre: L('하위', 'Bottom'), val: String(+(100 - meas.top).toFixed(2)), post: L('% 이내', '% or lower') } : fmtTop(primary);
  const sub = useMeasured
    ? L(`실측 · 제출자 <b>${n.toLocaleString(LOCALE)}명</b> 중 활동일 평균 기준`, `Measured · among <b>${n.toLocaleString(LOCALE)}</b> submitters, by average per active day`)
    : L(`추정 · Anthropic 공식 통계(기업 개발자) 기반 모델`, `Estimate · model fit to Anthropic's published figures (enterprise developers)`);
  const other = useMeasured
    ? L(`공식 통계 기반 추정으로는 ${topText(est)}`, `The estimate from published figures says ${topText(est)}`)
    : meas != null ? L(`참고: 제출자 ${n}명 중 ${measuredText(meas)} (표본이 30명 이상이면 실측을 기본으로 보여줘요)`, `For reference: ${measuredText(meas)} among ${n} submitters (measured rank becomes the default at 30+)`)
      : L(`실측 순위는 제출자가 30명 이상 모이면 보여드려요 (현재 ${n}명)`, `Measured rank appears once 30+ people submit (currently ${n})`);
  return `<div class="big"><small>${f.pre}</small><span class="pct">${f.val}</span><small>${f.post}</small></div>
    <div class="caption">${comment(primary)}<br>${sub}</div><div class="caption small">${other}</div>${shareRow(primary, r.avgDaily, 1)}`;
}

// ---------- sharing ----------
const SITE = 'https://token-percentile.vercel.app/' + (EN ? 'en/' : '');
const shareUrl = (top, daily, measured) => `${SITE}?s=${+top.toFixed(top < 1 ? 2 : 1)}&d=${Math.round(daily)}&m=${measured}`;
const shareText = (top, daily, measured) => L(
  `내 AI 코딩 토큰 사용량은 ${topText(top)} — 하루 평균 ${fmtTokens(daily)} 토큰 (${measured ? 'Claude Code·Codex 로그 실측' : '직접 입력'}). 나는 몇 %일까?`,
  `My AI coding token usage: ${topText(top)} — ${fmtTokens(daily)} tokens per active day (${measured ? 'measured from Claude Code / Codex logs' : 'self-reported'}). Where do you rank?`);
function shareRow(top, daily, measured, cls = '') {
  if (!(top > 0 && top <= 100) || !(daily >= 1 && daily <= 2e10)) return '';
  const a = `data-s="${top}" data-d="${Math.round(daily)}" data-m="${measured}"`;
  return `<div class="share ${cls}"><button type="button" class="btn" data-share="native" ${a}>${L('결과 공유하기', 'Share result')}</button>
    <button type="button" class="btn" data-share="x" ${a}>X</button><button type="button" class="btn" data-share="threads" ${a}>Threads</button>
    <span class="shareMsg" aria-live="polite"></span></div>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-share]');
  if (!b) return;
  const top = +b.dataset.s, daily = +b.dataset.d, measured = +b.dataset.m;
  const url = shareUrl(top, daily, measured), text = shareText(top, daily, measured);
  const msg = b.parentElement.querySelector('.shareMsg');
  if (b.dataset.share === 'x') { window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener'); return; }
  if (b.dataset.share === 'threads') { window.open(`https://www.threads.net/intent/post?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener'); return; }
  if (navigator.share) { try { await navigator.share({ title: L('나는 AI 토큰을 상위 몇 % 쓸까?', 'What percentile is my AI token usage?'), text, url }); return; } catch (err) { if (err.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(`${text} ${url}`); msg.textContent = L('링크와 문구를 복사했어요.', 'Copied link and text.'); }
  catch { msg.textContent = url; }
});

// Landing from a shared link: ?s=<top %>&d=<daily tokens>&m=<1 measured | 0 manual>
(function showShared() {
  const q = new URLSearchParams(location.search);
  if (!q.has('s')) return;
  const top = parseFloat(q.get('s')), daily = parseInt(q.get('d'), 10), measured = q.get('m') === '1';
  if (!(top > 0 && top <= 100) || !(daily > 0 && daily <= 2e10)) return;
  const f = fmtTop(top), el = $('shared');
  el.innerHTML = `<h3>${L('공유받은 결과', 'Someone shared this result')}</h3><div class="big"><small>${f.pre}</small><span class="pct">${esc(f.val)}</span><small>${f.post}</small></div>
    <div class="caption">${L(`하루 평균 <b>${fmtTokens(daily)}</b> 토큰 · ${measured ? '로그 실측' : '직접 입력'}<br>나는 몇 %일까요? 아래에서 내 로그로 재 보세요.`,
      `<b>${fmtTokens(daily)}</b> tokens per active day · ${measured ? 'measured from logs' : 'self-reported'}<br>Where do you rank? Measure your own logs below.`)}</div>`;
  el.hidden = false;
})();

function renderReport() {
  const r = report;
  $('report').hidden = false;
  if (!r.total) {
    $('rank').innerHTML = `<div class="caption">${L(`최근 ${r.windowDays}일 안의 사용 기록을 찾지 못했어요. 폴더가 맞는지 확인해 주세요.`, `No usage found in the last ${r.windowDays} days. Check that you picked the right folder.`)}</div>`;
    ['kpis', 'dayWrap', 'tables', 'hourWrap', 'submitCard'].forEach(id => $(id).hidden = true);
    return;
  }
  ['kpis', 'dayWrap', 'tables', 'hourWrap', 'submitCard'].forEach(id => $(id).hidden = false);
  $('rank').innerHTML = rankBlock();

  const kp = [
    [L('최근 30일 총 토큰', 'Total tokens, last 30 days'), fmtTokens(r.total), r.claudeTotal && r.codexTotal ? `Claude ${fmtTokens(r.claudeTotal)} · Codex ${fmtTokens(r.codexTotal)}` : (r.claudeTotal ? 'Claude Code' : 'Codex')],
    [L('활동일', 'Active days'), L(`${r.activeDays}일`, `${r.activeDays}`), L('30일 중', 'of 30')],
    [L('활동일 평균', 'Per active day'), fmtTokens(r.avgDaily), L('하루 토큰', 'tokens / day')],
    [L('캐시 적중률', 'Cache hit ratio'), (r.cacheRatio * 100).toFixed(1) + '%', L(`입력 중 캐시 읽기 비율 · 출력 ${(r.outputRatio * 100).toFixed(1)}%`, `cache reads / input · output ${(r.outputRatio * 100).toFixed(1)}%`)],
  ];
  $('kpis').innerHTML = kp.map(([l, v, s]) => `<div class="kpi"><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${s}</div></div>`).join('');

  const tools = [{ key: 'claude', label: 'Claude Code', cls: 'claude' }, { key: 'codex', label: 'Codex', cls: 'codex' }].filter(s => r[s.key + 'Total'] > 0);
  $('dayLegend').innerHTML = tools.length > 1 ? tools.map(s => `<span><i class="dot ${s.cls}"></i>${s.label}</span>`).join('') : '';
  $('dayTitle').textContent = tools.length > 1 ? L('일별 토큰', 'Tokens per day') : `${L('일별 토큰', 'Tokens per day')} · ${tools[0].label}`;
  barChart($('dayChart'), r.days.map(d => ({
    label: d.day.slice(5).replace('-', '/'),
    values: { claude: d.claude, codex: d.codex },
    tip: `<b>${d.day}</b><br>` + tools.map(s => `<i class="dot ${s.cls}"></i>${s.label} ${fmtTokens(d[s.key])}`).join('<br>') + (tools.length > 1 ? `<br>${L('합계', 'Total')} ${fmtTokens(d.claude + d.codex)}` : ''),
  })), tools);
  $('dayTable').innerHTML = `<tr><th>${L('날짜', 'Date')}</th>${tools.map(s => `<th>${s.label}</th>`).join('')}</tr>` +
    r.days.map(d => `<tr><td>${d.day}</td>${tools.map(s => `<td>${d[s.key].toLocaleString(LOCALE)}</td>`).join('')}</tr>`).join('');

  const share = v => (v / r.total * 100).toFixed(1) + '%';
  $('models').innerHTML = r.models.slice(0, 8).map(m => `<tr><td><i class="dot ${m.tool}"></i>${esc(m.model)}</td><td>${fmtTokens(m.tokens)}</td><td>${share(m.tokens)}</td></tr>`).join('');
  $('projects').innerHTML = r.projects.slice(0, 8).map(p => `<tr><td>${esc(p.name)}</td><td>${fmtTokens(p.tokens)}</td><td>${share(p.tokens)}</td></tr>`).join('');

  barChart($('hourChart'), r.hours.map((v, h) => ({ label: L(`${h}시`, `${h}h`), values: { all: v }, tip: `<b>${L(`${h}시대`, `${h}:00–${h}:59`)}</b><br>${fmtTokens(v)} ${L('토큰', 'tokens')} (${share(v)})` })), [{ key: 'all', cls: 'all' }], { height: 160 });

  const wDays = Number.isFinite(r.codexPlan?.windowMinutes) && r.codexPlan.windowMinutes > 0 ? (Math.round(r.codexPlan.windowMinutes / 1440) || 1) : null;
  $('plan').innerHTML = r.codexPlan ? `${L('Codex 요금제', 'Codex plan')}: <b>${esc(r.codexPlan.plan)}</b>` + (Number.isFinite(r.codexPlan.usedPercent)
    ? ` · ${L('마지막 기록 시점 한도 사용률', 'limit used at last record')} ${esc(r.codexPlan.usedPercent)}%${wDays ? L(` (${wDays}일 창)`, ` (${wDays}-day window)`) : ''}` : '') : '';

  renderSubmit();
}

// ---------- anonymous submission ----------
let sessionId = null;
function storedClientId() { try { return localStorage.getItem('tp_client_id'); } catch { return null; } }
function clientId() {
  let id = storedClientId() || sessionId;
  if (!id) { id = sessionId = crypto.randomUUID(); try { localStorage.setItem('tp_client_id', id); } catch {} }
  return id;
}
function payload(create = true) {
  const r = report;
  return {
    v: 1, clientId: create ? clientId() : (storedClientId() || sessionId || L('(보낼 때 이 브라우저용 무작위 ID를 만들어요)', '(a random ID for this browser is created when you send)')), windowDays: r.windowDays, activeDays: r.activeDays,
    total: r.total, avgDaily: r.avgDaily, claudeTotal: r.claudeTotal, codexTotal: r.codexTotal,
    cacheRatio: +r.cacheRatio.toFixed(4), outputRatio: +r.outputRatio.toFixed(4),
    codexPlan: r.codexPlan && r.codexTotal > 0 && /^[a-z0-9_-]{1,20}$/i.test(r.codexPlan.plan) ? r.codexPlan.plan : null,
  };
}
function renderSubmit() {
  $('payload').textContent = JSON.stringify(payload(false), null, 2);
  const ready = !!stats && !stats.error;
  $('submit').disabled = !ready;
  $('submitMsg').textContent = ready ? '' : L('실측 순위 서버를 준비 중이에요. 조금 뒤에 다시 와 주세요.', 'The ranking server is not ready yet. Please try again later.');
}
$('submit').onclick = async () => {
  const btn = $('submit'); btn.disabled = true; $('submitMsg').textContent = L('보내는 중…', 'Sending…');
  try {
    const res = await fetch('/api/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    $('submitMsg').textContent = L('고마워요! 반영됐어요. 같은 브라우저에서 다시 보내면 기존 값이 갱신돼요.', 'Thanks! Added. Sending again from this browser updates your entry.');
    $('payload').textContent = JSON.stringify(payload(false), null, 2);
    await loadStats(); $('rank').innerHTML = rankBlock();
  } catch (e) {
    $('submitMsg').textContent = L('제출 실패: ', 'Submit failed: ') + e.message;
  } finally { btn.disabled = false; }
};

// ---------- quick manual estimate ----------
const UNITS = { '천': 1e3, '만': 1e4, '억': 1e8, '조': 1e12, 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 };
export function parseTokens(raw) {
  const s = raw.replace(/[,\s_]/g, '').toUpperCase().replace(/토큰$/, '').replace(/TOKENS?$/, '');
  if (!s) return null;
  const re = /(\d+(?:\.\d+)?)(천|만|억|조|K|M|B|T)?/g;
  let total = 0, consumed = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== consumed) return NaN;
    total += parseFloat(m[1]) * (m[2] ? UNITS[m[2]] : 1);
    consumed = re.lastIndex;
  }
  return consumed === s.length && total > 0 ? total : NaN;
}
let period = 'day';
function quick() {
  const n = parseTokens($('tokens').value), out = $('quickOut');
  if (n === null) { out.innerHTML = `<span class="muted">${L(`공식 통계 기준 중앙값은 하루 약 ${fmtTokens(Math.exp(MU) / getRate() * 1e6)} 토큰이에요.`, `The median implied by published figures is about ${fmtTokens(Math.exp(MU) / getRate() * 1e6)} tokens per day.`)}</span>`; return; }
  if (Number.isNaN(n)) { out.innerHTML = `<span class="err">${L('읽을 수 없는 형식이에요. 예: 3000만, 1.2억, 50M', "Couldn't read that. Examples: 30M, 1.2B, 500K")}</span>`; return; }
  const daily = period === 'month' ? n / DAYS_PER_MONTH : n;
  const est = estimateTop(daily, getRate()), meas = measuredTop(daily);
  out.innerHTML = `<b class="accent">${topText(est)}</b> <span class="muted">${L('(공식 통계 기반 추정)', '(estimate from published figures)')}</span>` +
    (meas != null ? L(` · 제출자 ${stats.n}명 중 <b>${measuredText(meas)}</b>`, ` · <b>${measuredText(meas)}</b> among ${stats.n} submitters`) : '') +
    `<br><span class="muted">${period === 'month' ? L(`한 달 ${fmtTokens(n)} ≈ 하루 ${fmtTokens(daily)}`, `${fmtTokens(n)} per month ≈ ${fmtTokens(daily)} tokens per day`) : L(`하루 ${fmtTokens(daily)}`, `${fmtTokens(daily)} tokens per day`)}${L(' 토큰 기준', '')}</span>` +
    shareRow(est, daily, 0, 'left');
}
document.querySelectorAll('#period button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#period button').forEach(x => x.classList.toggle('on', x === b));
  period = b.dataset.p; quick();
});
$('tokens').addEventListener('input', quick);
$('rate').addEventListener('input', () => { quick(); if (report) $('rank').innerHTML = rankBlock(); });

loadStats().then(() => { quick(); const n = stats?.n; if (n != null) $('poolSize').textContent = L(`현재 제출자 ${n.toLocaleString(LOCALE)}명`, `Submitters so far: ${n.toLocaleString(LOCALE)}`); });
quick();
