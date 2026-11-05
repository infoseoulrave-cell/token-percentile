// Pure validation for anonymous submissions (unit-tested in scripts/test-validate.mjs).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isInt = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const isRatio = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export const LIMITS = { maxTotal: 1e12, maxAvgDaily: 2e10, minTotal: 1000 };

export function validateSubmission(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'invalid body' };
  if (b.v !== 1) return { error: 'unsupported version' };
  if (typeof b.clientId !== 'string' || !UUID.test(b.clientId)) return { error: 'invalid clientId' };
  if (b.windowDays !== 30) return { error: 'invalid windowDays' };
  if (!isInt(b.activeDays, 1, 30)) return { error: 'invalid activeDays' };
  if (!isInt(b.total, LIMITS.minTotal, LIMITS.maxTotal)) return { error: 'invalid total' };
  if (!isInt(b.claudeTotal, 0, LIMITS.maxTotal) || !isInt(b.codexTotal, 0, LIMITS.maxTotal)) return { error: 'invalid tool totals' };
  if (b.claudeTotal + b.codexTotal !== b.total) return { error: 'tool totals do not add up' };
  if (!isInt(b.avgDaily, 1, LIMITS.maxAvgDaily)) return { error: 'invalid avgDaily' };
  if (Math.abs(b.avgDaily - Math.round(b.total / b.activeDays)) > 1) return { error: 'avgDaily does not match' };
  if (!isRatio(b.cacheRatio) || !isRatio(b.outputRatio)) return { error: 'invalid ratios' };
  if (b.codexPlan !== null && (typeof b.codexPlan !== 'string' || !/^[a-z0-9_-]{1,20}$/i.test(b.codexPlan))) return { error: 'invalid codexPlan' };
  if (b.codexPlan !== null && b.codexTotal === 0) return { error: 'codexPlan without codex usage' };
  return {
    value: {
      clientId: b.clientId.toLowerCase(), activeDays: b.activeDays, total: b.total, avgDaily: b.avgDaily,
      claudeTotal: b.claudeTotal, codexTotal: b.codexTotal, cacheRatio: b.cacheRatio, outputRatio: b.outputRatio,
      codexPlan: b.codexPlan ? b.codexPlan.toLowerCase() : null,
    },
  };
}
