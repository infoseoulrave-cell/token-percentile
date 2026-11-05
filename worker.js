import { createAggregator } from './lib/parse.js';

async function* readLines(file) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { yield buf.slice(0, i); buf = buf.slice(i + 1); }
  }
  if (buf) yield buf;
}

self.onmessage = async ({ data }) => {
  try {
    const agg = createAggregator();
    const items = data.items; // [{ file, kind }]
    const totalBytes = items.reduce((s, x) => s + x.file.size, 0) || 1;
    let doneBytes = 0, lastPost = 0;
    for (const { file, kind } of items) {
      if (kind === 'codex') agg.beginCodexFile();
      for await (const line of readLines(file)) {
        if (kind === 'codex') agg.addCodexLine(line); else agg.addClaudeLine(line, null);
      }
      if (kind === 'codex') agg.endCodexFile();
      doneBytes += file.size;
      const t = Date.now();
      if (t - lastPost > 120) { self.postMessage({ type: 'progress', ratio: doneBytes / totalBytes }); lastPost = t; }
    }
    self.postMessage({ type: 'done', result: agg.result() });
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};
