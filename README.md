# token-percentile

**What percentile is your AI token usage?** → https://token-percentile.vercel.app/en/ · [한국어](https://token-percentile.vercel.app/)

Pick your Claude Code (`~/.claude/projects`) or Codex (`~/.codex/sessions`) log folder. The site reads the JSONL logs **inside your browser**, totals the last 30 days, and shows where you rank.

## Privacy: your logs never leave the browser

- Parsing runs in a Web Worker (`worker.js` → `lib/parse.js`). There is no upload code path for files.
- Nothing is sent unless you press **Send these numbers**. Then only these aggregates go to `/api/submit`: 30-day total, active days, per-tool totals, cache/output ratios, the Codex plan name, and a random browser ID. The exact payload is shown before you send it.
- The server stores no IP addresses. For rate limiting it keeps a salted hash that changes daily, for two days (`api/submit.js`).
- `/api/stats` publishes only p1–p99 quantiles, and only once there are at least 20 submissions. Submissions are deleted after 180 days.

## How tokens are counted

- **Claude Code**: `message.usage` on assistant lines (input + cache write + cache read + output). Streaming writes the same response on several lines, so lines are deduped by `message.id` + `requestId`, keeping the max of each field. Summing the raw lines overcounts.
- **Codex**: `token_usage_record` events per `response_id` when present. Older logs fall back to deltas of the cumulative `token_count` counter. Codex `input_tokens` includes cached tokens, so those are split out.
- **Ranking**: once 30+ people have submitted, the rank comes from their numbers. Until then it is an estimate: a log-normal fit to the enterprise-developer figures in [Anthropic's docs](https://code.claude.com/docs/en/costs) (about $13 per active day on average, 90% under $30), converted at $0.55 per 1M tokens.

## Run locally

```bash
node scripts/scan-local.mjs        # run the same parser over your own logs in Node
node scripts/test-validate.mjs     # submission validator tests
```

The frontend is static (`index.html`, `en/index.html`, `app.js`, `worker.js`, `lib/`). The API is Vercel Functions in `api/` backed by Postgres (Neon). Set `DATABASE_URL` and `RATE_SALT`.

## License

MIT
