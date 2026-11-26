// Browser smoke test for the M0 baseline. No npm dependencies, secrets or network access beyond 127.0.0.1.
//
//   node smoke/browser-smoke.mjs                 headless Chrome via CDP (default, used in CI)
//   SMOKE_BROWSER=firefox|safari|manual ...      any browser: the pages report back over HTTP
//   SMOKE_HEADLESS=0                             show the Chrome window
//   SMOKE_OUT=dir                                artifact directory (default artifacts/browser-smoke/<browser>)
//   SMOKE_REQUIRE_WEBM=0|1                       fail when alpha WebM playback fails (default 1 for chrome, else 0)
//   CHROME_BIN / FIREFOX_BIN, SMOKE_CHROME_ARGS  binary overrides and extra Chrome flags
//
// What it asserts: the logical trace produced in the browser equals a reference replay computed in
// Node at every tick rate; the tick rates really differed; every transition put atlas frames on the
// canvas. On Chrome it also pixel-checks the canvas against the frame the app selected, drives one
// real click on a preset, and runs the scenario on the audio clock. Separately it records (and for
// Chrome requires) that the alpha VP9 WebM files decode with alpha and match their own atlas.
// It does not assess perceived quality, audible output, or whether the app selects the right frame.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../src/runtime.mjs';
import { manifest, presets } from '../demo/manifest.mjs';
import { baseline } from '../demo/scenario.mjs';
import { parseScript, replay } from '../demo/session.mjs';
import { Cdp, launchChrome, openPage } from './cdp.mjs';
import { startServer } from './server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = process.env.SMOKE_BROWSER ?? 'chrome';
const headless = process.env.SMOKE_HEADLESS !== '0';
const outDir = resolve(process.env.SMOKE_OUT ?? join(root, 'artifacts', 'browser-smoke', browser));
const requireWebm = (process.env.SMOKE_REQUIRE_WEBM ?? (browser === 'chrome' ? '1' : '0')) === '1';
const RUN_TIMEOUT_MS = baseline.untilMs + 25000;

// Frame-rate variants of the same scripted requests. maxFps:null means every animation frame.
const wallRuns = [{ label: 'wall-native', maxFps: null }, { label: 'wall-10fps', maxFps: 10 }, { label: 'wall-4fps', maxFps: 4 }];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const short = e => `${e.atMs} ${e.track} ${e.type} ${e.from}->${e.to}`;

// Reference computed in Node from the script itself (not from what the browser recorded).
const script = parseScript(baseline.script, presets);
const referenceRequests = script.map(({ atMs, preset }) => ({ atMs, preset, targets: { ...presets[preset] } }));
const reference = { schema: 'adaptive-asset-trace/1', untilMs: baseline.untilMs, requests: referenceRequests, ...replay(new Runtime(manifest), referenceRequests, baseline.untilMs) };

const referenceAssets = [...new Set(reference.events.filter(e => e.track === 'face' && e.type === 'start').map(e => e.asset))];
const MIN_NATIVE_FRAMES = 6; // of 12 per 600 ms clip; uncapped runs on a slow machine may miss some

function demoUrl(origin, { label, maxFps, autostart = true, bg }) {
  const q = new URLSearchParams({ script: baseline.script, until: String(baseline.untilMs), report: label });
  if (autostart) q.set('autostart', 'silent');
  if (maxFps) q.set('maxFps', String(maxFps));
  if (bg) q.set('bg', bg);
  return `${origin}/demo/?${q}`;
}
const probeUrl = origin => `${origin}/demo/webm-probe.html?report=webm-probe`;

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); console.log(`ok   ${name}`); }
  catch (e) { checks.push({ name, ok: false, message: e.message.split('\n').slice(0, 12).join('\n') }); console.log(`FAIL ${name}\n     ${e.message.split('\n').slice(0, 12).join('\n     ')}`); }
}

function checkTrace(label, trace, { clock, maxFps }) {
  check(`${label}: logical trace equals the Node reference replay`, () => assert.deepEqual(trace.logical, reference));
  check(`${label}: clock source is ${clock}`, () => assert.equal(trace.playback.clock, clock));
  check(`${label}: page reported itself visible when it finished`, () => assert.equal(trace.env.visibility, 'visible'));
  // Rendering evidence: every transition in the reference must have put atlas frames on the canvas.
  check(`${label}: every transition drew at least ${maxFps ? 1 : MIN_NATIVE_FRAMES} distinct atlas frame(s)`, () => {
    for (const asset of referenceAssets) {
      const indexes = trace.playback.faceSamples.filter(s => s.startsWith(`${asset}:`));
      assert.ok(indexes.length >= (maxFps ? 1 : MIN_NATIVE_FRAMES), `${asset}: ${indexes.length} distinct frames`);
    }
  });
  if (maxFps) check(`${label}: ticks were really limited to about ${maxFps} per second`, () => {
    assert.ok(trace.playback.tickDeltaMs.p50 >= 900 / maxFps, `p50 tick interval ${trace.playback.tickDeltaMs.p50} ms`);
    assert.ok(trace.playback.skippedFrames > 0, 'no animation frames were skipped');
  });
}

// Compare the canvas with the atlas frame the app says it drew, inside one page task so both agree.
// A channel may differ by 1: once a canvas has been read back, Chrome re-reads it through a different
// path and the unpremultiplied values round differently (measured: 57 values off by 1, none by more).
const canvasCheck = `(async()=>{
  const {key,index}=window.__adaptiveAsset.lastFace;
  const im=new Image();im.src='./assets/'+key+'.png';await im.decode();
  const c=document.createElement('canvas');c.width=c.height=192;const x=c.getContext('2d');
  const face=window.__adaptiveAsset.lastFace;
  x.drawImage(im,face.index*192,0,192,192,0,0,192,192);
  const want=x.getImageData(0,0,192,192).data,got=document.getElementById('face').getContext('2d').getImageData(0,0,192,192).data;
  let differing=0,offByOne=0,opaque=0;for(let i=0;i<want.length;i+=4){if(got[i+3]===255)opaque++;const d=Math.max(Math.abs(want[i]-got[i]),Math.abs(want[i+1]-got[i+1]),Math.abs(want[i+2]-got[i+2]),Math.abs(want[i+3]-got[i+3]));if(d>1)differing++;else if(d===1)offByOne++;}
  return {key:face.key,index:face.index,keyChangedWhileLoading:face.key!==key,differingPixels:differing,offByOnePixels:offByOne,opaquePixels:opaque,cornerAlpha:got[3],label:document.getElementById('face-state').textContent};})()`;

async function runChrome(server, results) {
  const extraArgs = (process.env.SMOKE_CHROME_ARGS ?? '').split(' ').filter(Boolean);
  const chrome = await launchChrome({ headless, extraArgs });
  let cdp, page;
  // A failing step is recorded and the remaining steps still run.
  const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: completed`, () => { throw e; }); } };
  try {
    cdp = await Cdp.connect(chrome.wsUrl);
    const version = await cdp.send('Browser.getVersion');
    results.browser = { name: 'chrome', product: version.product, userAgent: version.userAgent, headless, binary: chrome.binary, extraArgs };
    console.log(`browser: ${version.product}${headless ? ' (headless)' : ''}`);
    page = await openPage(cdp);

    for (const run of wallRuns) await step(run.label, async () => {
      await page.navigate(demoUrl(server.origin, run));
      results.traces[run.label] = await server.report(run.label, RUN_TIMEOUT_MS);
      checkTrace(run.label, results.traces[run.label], { clock: 'wall', maxFps: run.maxFps });
    });

    // Audio clock: needs a trusted click, so this variant exists only on the CDP path.
    await step('audio-native', async () => {
      await page.navigate(demoUrl(server.origin, { label: 'audio-native', autostart: false }));
      await page.waitFor(`!document.getElementById('start').disabled`, 10000);
      await page.click('#start');
      results.traces['audio-native'] = await server.report('audio-native', RUN_TIMEOUT_MS);
      checkTrace('audio-native', results.traces['audio-native'], { clock: 'audio', maxFps: null });
      check('audio-native: AudioContext reported running (says nothing about audible output)', () => assert.equal(results.traces['audio-native'].playback.audioState, 'running'));
    });

    // Visual run (not timed): pixel checks and screenshots mid-transition and at the end.
    await step('visual', async () => {
      await page.navigate(demoUrl(server.origin, { label: 'visual', bg: 'check' }));
      await page.waitFor(`document.getElementById('face-state').textContent.includes('→')`, 10000, 10);
      const transitionAssets = new Set(manifest.tracks.find(t => t.id === 'face').transitions.map(t => t.asset));
      // The clock keeps running, so sample a few times and keep the samples taken inside a transition.
      const samples = [];
      for (let i = 0; i < 8; i++) samples.push(await page.evaluate(canvasCheck));
      await writeFile(join(outDir, 'demo-mid-transition.png'), await page.screenshot());
      results.midTransition = samples;
      const inFlight = samples.filter(s => transitionAssets.has(s.key) && !s.keyChangedWhileLoading);
      check('visual: canvas shows the transition atlas frame the app selected, pixel for pixel (±1 rounding)', () => {
        assert.ok(inFlight.length > 0, `no sample landed inside a transition: ${JSON.stringify(samples.map(s => s.key))}`);
        for (const s of inFlight) { assert.equal(s.differingPixels, 0, `${s.key}:${s.index}`); assert.equal(s.cornerAlpha, 0); assert.ok(s.label.includes('→'), s.label); }
        assert.ok(inFlight.some(s => s.index > 0), 'only frame 0 was ever sampled');
      });
      results.traces.visual = await server.report('visual', RUN_TIMEOUT_MS);
      await page.waitFor(`window.__adaptiveAsset.done && !window.__adaptiveAsset.running`, 5000);
      await writeFile(join(outDir, 'demo-final.png'), await page.screenshot());
      check('visual: logical trace equals the Node reference replay', () => assert.deepEqual(results.traces.visual.logical, reference));
      const finalState = reference.final.snapshot.face.state;
      results.finalPose = await page.evaluate(canvasCheck);
      check(`visual: canvas ends on the stable ${finalState}.png pose (±1 rounding), on a transparent canvas`, () => {
        assert.equal(results.finalPose.key, finalState);
        assert.equal(results.finalPose.differingPixels, 0);
        assert.equal(results.finalPose.cornerAlpha, 0);
        assert.ok(results.finalPose.opaquePixels > 1000, `only ${results.finalPose.opaquePixels} opaque pixels`);
      });
    });

    // Interactive path: a real click on a preset button, stamped by the click handler's clock.
    await step('interactive', async () => {
      const untilMs = 2500;
      await page.navigate(`${server.origin}/demo/?${new URLSearchParams({ autostart: 'silent', until: String(untilMs), report: 'interactive' })}`);
      await page.waitFor(`window.__adaptiveAsset.running`, 10000, 10);
      await page.click('[data-preset="friendly"]');
      const trace = results.traces.interactive = await server.report('interactive', untilMs + 25000);
      check('interactive: one clicked request was recorded with its targets', () => {
        assert.equal(trace.logical.requests.length, 1);
        const [request] = trace.logical.requests;
        assert.equal(request.preset, 'friendly'); assert.deepEqual(request.targets, presets.friendly);
        assert.ok(Number.isSafeInteger(request.atMs) && request.atMs >= 0 && request.atMs < untilMs - 1000, `stamped at ${request.atMs}`);
      });
      check('interactive: events and final state equal a Node replay of the recorded request', () => {
        const replayed = replay(new Runtime(manifest), trace.logical.requests, untilMs);
        assert.deepEqual(trace.logical.events, replayed.events); assert.deepEqual(trace.logical.final, replayed.final);
        assert.deepEqual(trace.logical.events.map(e => `${e.type} ${e.from}->${e.to}`), ['start neutral->smile', 'end neutral->smile']);
        assert.equal(trace.logical.final.snapshot.face.state, 'smile');
      });
    });

    await step('webm-probe', async () => {
      await page.navigate(probeUrl(server.origin));
      results.webmProbe = await server.report('webm-probe', RUN_TIMEOUT_MS);
      await new Promise(r => setTimeout(r, 300));
      await writeFile(join(outDir, 'webm-probe.png'), await page.screenshot());
    });
  } finally {
    if (page) { results.pageProblems = page.problems; check('no page exceptions or console errors', () => assert.deepEqual(page.problems, [])); }
    cdp?.close(); await chrome.close();
  }
}

// Any other browser: open one URL; each page reports and is told where to go next.
async function runGeneric(server, results) {
  const labels = [...wallRuns.map(r => r.label), 'webm-probe'];
  const urls = [...wallRuns.map(r => demoUrl(server.origin, r)), probeUrl(server.origin)];
  server.chain(label => urls[labels.indexOf(label) + 1] ?? null);
  let cleanup = async () => {};
  if (browser === 'firefox') {
    const binary = process.env.FIREFOX_BIN || ['/Applications/Firefox.app/Contents/MacOS/firefox', '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox', '/usr/bin/firefox'].find(existsSync);
    if (!binary) throw Error('Firefox not found; set FIREFOX_BIN');
    const profile = await mkdtemp(join(os.tmpdir(), 'aar-smoke-firefox-'));
    const proc = spawn(binary, ['-no-remote', '-profile', profile, ...(headless ? ['-headless'] : []), urls[0]], { stdio: 'ignore' });
    results.browser = { name: 'firefox', binary, headless };
    cleanup = async () => { if (proc.exitCode === null) { const exited = new Promise(r => proc.once('exit', r)); proc.kill('SIGTERM'); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); } await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}); };
  } else if (browser === 'safari') {
    spawn('open', ['-a', 'Safari', urls[0]], { stdio: 'ignore' });
    results.browser = { name: 'safari', headless: false };
  } else if (browser === 'manual') {
    console.log(`Open this URL in the browser under test and keep the tab visible:\n  ${urls[0]}`);
    results.browser = { name: 'manual', headless: false };
  } else throw Error(`unknown SMOKE_BROWSER "${browser}"`);
  try {
    const first = browser === 'manual' ? 10 * 60000 : RUN_TIMEOUT_MS + 30000;
    for (const [i, run] of wallRuns.entries()) {
      results.traces[run.label] = await server.report(run.label, i === 0 ? first : RUN_TIMEOUT_MS);
      results.browser.userAgent = results.traces[run.label].env.userAgent;
      checkTrace(run.label, results.traces[run.label], { clock: 'wall', maxFps: run.maxFps });
    }
    results.webmProbe = await server.report('webm-probe', RUN_TIMEOUT_MS + 60000);
  } finally { await cleanup(); }
}

async function main() {
  if (browser === 'chrome' && typeof WebSocket !== 'function') { console.error(`The Chrome smoke test needs Node 22+ (global WebSocket); this is ${process.version}.`); process.exit(1); }
  await mkdir(outDir, { recursive: true });
  const server = await startServer(root);
  const cpus = os.cpus();
  const results = {
    schema: 'adaptive-asset-smoke/1', startedAt: new Date().toISOString(),
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: cpus[0]?.model ?? null, cores: cpus.length, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, ci: Boolean(process.env.CI) },
    scenario: baseline, referenceHash: hash(reference), referenceEvents: reference.events.map(short), traces: {}, webmProbe: null, checks,
  };
  let failure = null;
  try {
    if (browser === 'chrome') await runChrome(server, results); else await runGeneric(server, results);

    const scripted = Object.entries(results.traces).filter(([label]) => label !== 'interactive');
    results.traceHashes = Object.fromEntries(scripted.map(([label, t]) => [label, hash(t.logical)]));
    check('tick counts fall as the tick cap tightens (the runs really differed)', () => {
      const [a, b, c] = wallRuns.map(r => results.traces[r.label]?.playback.ticks);
      assert.ok(a > b && b > c, `ticks ${a}, ${b}, ${c}`);
    });

    const probe = results.webmProbe;
    if (!probe) throw Error('no WebM probe result');
    results.webmSummary = { ok: probe.ok, canPlayType: probe.canPlayType, clips: probe.clips.map(({ frames, ...rest }) => rest) };
    const probeCheck = () => assert.ok(probe.ok, `clips failing: ${probe.clips.filter(c => !c.ok).map(c => `${c.asset} (${c.error ?? (!c.alphaPreserved ? 'alpha lost' : !c.contentMatches ? 'content mismatch' : 'other')})`).join(', ')}`);
    if (requireWebm) check('webm-probe: all six alpha VP9 clips decode with alpha preserved and frames matching their own atlas', probeCheck);
    else console.log(`note webm-probe recorded, not required: ok=${probe.ok}`);
  } catch (e) { failure = e; console.log(`ERROR ${e.message}`); }
  finally { await server.close(); }

  results.finishedAt = new Date().toISOString();
  results.passed = !failure && checks.every(c => c.ok);
  if (failure) results.error = failure.message;
  for (const [label, trace] of Object.entries(results.traces)) await writeFile(join(outDir, `trace-${label}.json`), JSON.stringify(trace, null, 2) + '\n');
  if (results.webmProbe) await writeFile(join(outDir, 'webm-probe.json'), JSON.stringify(results.webmProbe, null, 2) + '\n');
  const { traces, webmProbe, ...summary } = results;
  summary.playback = Object.fromEntries(Object.entries(traces).map(([label, t]) => [label, { ...t.playback, faceSamples: t.playback.faceSamples.length }]));
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log(`\nlogical trace sha256: ${results.referenceHash}`);
  console.table(Object.fromEntries(Object.entries(summary.playback).map(([label, p]) => [label, { clock: p.clock, ticks: p.ticks, 'tick p50 ms': p.tickDeltaMs.p50, 'tick p95 ms': p.tickDeltaMs.p95, 'start lag p50 ms': p.startLagMs.p50, 'start lag p95 ms': p.startLagMs.p95, 'face samples': p.faceSamples }])));
  if (summary.webmSummary) console.table(Object.fromEntries(summary.webmSummary.clips.map(c => [c.asset, { ok: c.ok, 'duration s': c.durationS, presented: c.presentedFrames, sampled: c.framesObserved, alpha: c.alphaPreserved, content: c.contentMatches, 'max feature diff': c.maxFeatureDiff, 'max color diff': c.maxColorDiff, 'max alpha diff': c.maxAlphaDiff, error: c.error ?? '' }])));
  console.log(`artifacts: ${relative(process.cwd(), outDir) || '.'}`);
  console.log(results.passed ? `PASS ${checks.length} checks` : `FAIL ${checks.filter(c => !c.ok).length} of ${checks.length} checks${failure ? ' (aborted)' : ''}`);
  process.exit(results.passed ? 0 : 1);
}
main();
