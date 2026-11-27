// Minimal static file server for the smoke test. Serves demo/ and src/ on 127.0.0.1 and
// accepts POST /__report?label=... so that any browser can hand its result back without an
// automation protocol. No dependencies.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webm': 'video/webm', '.wav': 'audio/wav' };
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const SERVED = ['demo', 'src'];

export async function startServer(root) {
  const waiting = new Map(), received = new Map();
  let nextUrl = () => null;
  const server = createServer(async (req, res) => {
    try {
      if (process.env.SMOKE_DEBUG) console.log(`[server] ${req.method} ${req.url}`);
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__report') {
        if (req.method !== 'POST') { res.writeHead(405).end(); return; }
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > MAX_REPORT_BYTES) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const label = url.searchParams.get('label') ?? '', body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (waiting.has(label)) { waiting.get(label)(body); waiting.delete(label); } else received.set(label, body);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ next: nextUrl(label) }));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      let path = normalize(decodeURIComponent(url.pathname));
      if (path.endsWith(sep)) path += 'index.html';
      const file = join(root, path);
      // Only the demo and the runtime it imports are served, never the rest of the checkout.
      if (!SERVED.some(dir => file.startsWith(join(root, dir) + sep))) { res.writeHead(403).end(); return; }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) { res.writeHead(404).end('not found'); return; }
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
      // Byte ranges: some browsers refuse to play media from servers that ignore Range.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) { res.writeHead(416, { 'content-range': `bytes */${info.size}` }).end(); return; }
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
        if (req.method === 'HEAD') res.end(); else createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': info.size });
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    } catch (e) { if (!res.headersSent) res.writeHead(400); res.end(String(e.message)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    // Resolves with the body of the report posted under `label`.
    report(label, timeoutMs) {
      if (received.has(label)) { const body = received.get(label); received.delete(label); return Promise.resolve(body); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(label); reject(Error(`no report "${label}" within ${timeoutMs} ms`)); }, timeoutMs);
        waiting.set(label, body => { clearTimeout(timer); resolve(body); });
      });
    },
    // The page navigates itself to the returned URL after reporting (used to chain runs in one tab).
    chain(fn) { nextUrl = fn; },
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
