// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket (Node 22+). No dependencies.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
export function findChrome() {
  const binary = process.env.CHROME_BIN || CANDIDATES.find(existsSync);
  if (!binary) throw Error('Chrome not found; set CHROME_BIN');
  return binary;
}

export async function launchChrome({ binary = findChrome(), headless = true, extraArgs = [] } = {}) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'aar-smoke-chrome-'));
  const args = [
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--window-size=900,1000', ...(headless ? ['--headless=new'] : []), ...extraArgs, 'about:blank',
  ];
  const proc = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const close = async () => {
    if (proc.exitCode === null && proc.signalCode === null) { const exited = new Promise(resolve => proc.once('exit', resolve)); proc.kill('SIGTERM'); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); }
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  };
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(Error(`Chrome did not expose DevTools within 20 s\n${stderr}`)), 20000);
    proc.stderr.on('data', chunk => { stderr += chunk; const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr); if (m) { clearTimeout(timer); resolve(m[1]); } });
    proc.once('exit', code => { clearTimeout(timer); reject(Error(`Chrome exited early (${code})\n${stderr}`)); });
    proc.once('error', e => { clearTimeout(timer); reject(e); });
  }).catch(async e => { await close(); throw e; });
  return { wsUrl, binary, args, close };
}

export class Cdp {
  #ws; #id = 0; #pending = new Map(); #listeners = new Set();
  static connect(wsUrl) {
    if (typeof WebSocket !== 'function') throw Error('global WebSocket is required (Node 22+)');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl), cdp = new Cdp(ws);
      ws.addEventListener('open', () => resolve(cdp), { once: true });
      ws.addEventListener('error', () => reject(Error('CDP websocket error')), { once: true });
    });
  }
  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.#pending.get(message.id); this.#pending.delete(message.id);
        if (!entry) return;
        if (message.error) entry.reject(Error(`${entry.method}: ${message.error.message}`)); else entry.resolve(message.result);
      } else for (const listener of this.#listeners) listener(message);
    });
    ws.addEventListener('close', () => { for (const entry of this.#pending.values()) entry.reject(Error(`${entry.method}: connection closed`)); this.#pending.clear(); });
  }
  send(method, params = {}, sessionId) {
    // A closed socket swallows send() silently; fail fast so callers' timeouts are not bypassed.
    if (this.#ws.readyState !== WebSocket.OPEN) return Promise.reject(Error(`${method}: connection closed`));
    const id = ++this.#id;
    return new Promise((resolve, reject) => { this.#pending.set(id, { resolve, reject, method }); this.#ws.send(JSON.stringify({ id, method, params, sessionId })); });
  }
  on(listener) { this.#listeners.add(listener); }
  close() { this.#ws.close(); }
}

// One page target with helpers. Page errors and console errors are collected for the caller to assert on.
export async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const problems = [];
  cdp.on(message => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') problems.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') problems.push(`console.error: ${message.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') problems.push(`log: ${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
  });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.bringToFront');
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw Error(`evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  return {
    problems, evaluate,
    async navigate(url) { const { errorText } = await send('Page.navigate', { url }); if (errorText) throw Error(`navigation to ${url} failed: ${errorText}`); },
    async waitFor(expression, timeoutMs, intervalMs = 50) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        let failure = null;
        const value = await evaluate(expression).catch(e => { failure = e; return null; });
        if (value) return value;
        if (failure && /connection closed/.test(failure.message)) throw failure;
        if (Date.now() > deadline) throw Error(`timed out waiting for ${expression}`);
        await new Promise(r => setTimeout(r, intervalMs));
      }
    },
    // A real, trusted mouse click (needed to unlock AudioContext under the autoplay policy).
    async click(selector) {
      const box = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    },
    async screenshot() { const { data } = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(data, 'base64'); },
  };
}
