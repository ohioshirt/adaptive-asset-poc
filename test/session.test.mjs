import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.mjs';
import { manifest, presets } from '../demo/manifest.mjs';
import { baseline } from '../demo/scenario.mjs';
import { TracedSession, parseScript, replay } from '../demo/session.mjs';

const short = e => [e.atMs, e.track, e.type, e.from, e.to];
const session = (options = {}) => new TracedSession(new Runtime(manifest), presets, options);
const baselineSession = () => session({ script: parseScript(baseline.script, presets), untilMs: baseline.untilMs });
function run(readings) { const s = baselineSession(); for (const t of readings) s.advance(t); return s; }
const every = stepMs => { const out = []; for (let t = stepMs; t < baseline.untilMs + stepMs; t += stepMs) out.push(t); return out; };

// Derived by hand from docs/design.md: face safe points every 200 ms on the state clock, audio every
// 2000 ms on the global clock, in-flight edges atomic, same-timestamp order by track id then end < start.
const expectedEvents = [
  [200, 'face', 'start', 'neutral', 'concern'], [800, 'face', 'end', 'neutral', 'concern'],
  [800, 'face', 'start', 'concern', 'smile'], [1400, 'face', 'end', 'concern', 'smile'],
  [2000, 'audio', 'start', 'calm', 'alert'], [2000, 'face', 'start', 'smile', 'concern'],
  [2400, 'audio', 'end', 'calm', 'alert'], [2600, 'face', 'end', 'smile', 'concern'],
  // 3000: the pending neutral target is already due at this safe point, so its edge starts before the
  // request stamped 3000 is applied ("after earlier advanceTo events"); smile is reached via neutral.
  [3000, 'face', 'start', 'concern', 'neutral'], [3600, 'face', 'end', 'concern', 'neutral'],
  [3600, 'face', 'start', 'neutral', 'smile'], [4000, 'audio', 'start', 'alert', 'calm'],
  [4200, 'face', 'end', 'neutral', 'smile'], [4400, 'audio', 'end', 'alert', 'calm'],
];

test('parseScript accepts ordered entries and rejects malformed, unknown or unordered ones', () => {
  assert.deepEqual(parseScript('', presets), []);
  assert.deepEqual(parseScript(null, presets), []);
  assert.deepEqual(parseScript('0:tense,0:neutral,40:friendly', presets), [{ atMs: 0, preset: 'tense' }, { atMs: 0, preset: 'neutral' }, { atMs: 40, preset: 'friendly' }]);
  assert.throws(() => parseScript('10:tense,', presets), /invalid script entry/);
  assert.throws(() => parseScript('1.5:tense', presets), /invalid script entry/);
  assert.throws(() => parseScript('-1:tense', presets), /invalid script entry/);
  assert.throws(() => parseScript('10:angry', presets), /unknown preset/);
  assert.throws(() => parseScript('10:toString', presets), /unknown preset/);
  assert.throws(() => parseScript('20:tense,10:neutral', presets), /nondecreasing/);
  assert.throws(() => parseScript('99999999999999999999:tense', presets), /invalid script time/);
});

test('baseline scenario produces the hand-derived event history and request stamps', () => {
  const trace = run([baseline.untilMs]).logicalTrace();
  assert.deepEqual(trace.events.map(short), expectedEvents);
  assert.deepEqual(trace.requests, [
    { atMs: 130, preset: 'tense', targets: { face: 'concern', audio: 'alert' } },
    { atMs: 350, preset: 'friendly', targets: { face: 'smile', audio: 'calm' } },
    { atMs: 2000, preset: 'tense', targets: { face: 'concern', audio: 'alert' } },
    { atMs: 2900, preset: 'neutral', targets: { face: 'neutral', audio: 'calm' } },
    { atMs: 3000, preset: 'friendly', targets: { face: 'smile', audio: 'calm' } },
  ]);
  assert.equal(trace.final.atMs, 4700);
  assert.deepEqual(trace.final.snapshot.face, { state: 'smile', target: 'smile', enteredAt: 4200, phaseMs: 100, transition: null });
  assert.deepEqual(trace.final.snapshot.audio, { state: 'calm', target: 'calm', enteredAt: 4400, phaseMs: 700, transition: null });
});

test('logical trace is independent of how the clock is partitioned into frames', () => {
  const reference = run([baseline.untilMs]).logicalTrace();
  const partitions = {
    '60 fps': every(1000 / 60), '10 fps': every(100), '4 fps': every(250), '1 ms': every(1),
    'late and irregular': [1, 129.9, 130, 349, 351, 799, 801, 1999.99, 2000.2, 2899, 2999, 3001, 3999, 4699, 9000],
    'one long stall': [100, 4650, 4800],
  };
  for (const [name, readings] of Object.entries(partitions)) assert.deepEqual(run(readings).logicalTrace(), reference, name);
});

test('reference replay of the recorded requests reproduces events and final state', () => {
  const trace = run(every(1000 / 60)).logicalTrace();
  const reference = replay(new Runtime(manifest), trace.requests, trace.untilMs);
  assert.deepEqual(trace.events, reference.events);
  assert.deepEqual(trace.final, reference.final);
});

test('untilMs freezes the session exactly at the boundary, not before', () => {
  const s = baselineSession();
  s.advance(baseline.untilMs - 1);
  assert.equal(s.done, false);
  assert.equal(s.logicalTrace().final, null);
  s.advance(baseline.untilMs + 500);
  assert.equal(s.done, true);
  const frozen = s.logicalTrace();
  assert.equal(frozen.final.atMs, baseline.untilMs);
  assert.deepEqual(s.advance(baseline.untilMs + 5000), []);
  assert.deepEqual(s.request('tense'), []);
  assert.deepEqual(s.logicalTrace(), frozen);
});

test('clock readings behind the logical clock are ignored; non-finite readings are rejected', () => {
  const s = session();
  s.advance(500); s.request('friendly'); s.advance(100);
  assert.deepEqual(s.logicalTrace().requests.map(r => r.atMs), [500]);
  assert.deepEqual(s.advance(1300).map(short), [[600, 'face', 'start', 'neutral', 'smile'], [1200, 'face', 'end', 'neutral', 'smile']]);
  assert.throws(() => s.advance(NaN), /finite/);
});

test('interactive requests are stamped with the current logical clock and validated', () => {
  const s = session();
  s.advance(51.9);
  assert.deepEqual(s.request('tense'), []);
  assert.throws(() => s.request('angry'), /unknown preset/);
  assert.deepEqual(s.logicalTrace().requests, [{ atMs: 51, preset: 'tense', targets: { face: 'concern', audio: 'alert' } }]);
  assert.equal(s.done, false);
});

test('scripted and interactive requests at the same clock keep call order', () => {
  const s = session({ script: parseScript('200:tense', presets) });
  s.advance(200); s.request('friendly'); s.advance(900);
  const trace = s.logicalTrace();
  assert.deepEqual(trace.requests.map(r => [r.atMs, r.preset]), [[200, 'tense'], [200, 'friendly']]);
  assert.deepEqual(trace.events.map(short), [[200, 'face', 'start', 'neutral', 'concern'], [800, 'face', 'end', 'neutral', 'concern'], [800, 'face', 'start', 'concern', 'smile']]);
});

test('invalid session options are rejected', () => {
  assert.throws(() => session({ untilMs: 1.5 }), /untilMs/);
  assert.throws(() => session({ untilMs: -1 }), /untilMs/);
  assert.throws(() => session({ script: parseScript('500:tense', presets), untilMs: 499 }), /after untilMs/);
  assert.throws(() => session({ script: [{ atMs: 10, preset: 'angry' }] }), /invalid script entry/);
  assert.throws(() => session({ script: [{ atMs: 1.5, preset: 'tense' }] }), /invalid script entry/);
});

test('a scripted request stamped exactly at untilMs is applied before the session freezes', () => {
  const s = session({ script: parseScript('400:tense', presets), untilMs: 400 });
  s.advance(1000);
  const trace = s.logicalTrace();
  assert.deepEqual(trace.requests, [{ atMs: 400, preset: 'tense', targets: { face: 'concern', audio: 'alert' } }]);
  assert.deepEqual(trace.events.map(short), [[400, 'face', 'start', 'neutral', 'concern']]);
  assert.equal(trace.final.atMs, 400);
  assert.equal(trace.final.snapshot.face.transition.to, 'concern');
  assert.equal(trace.final.snapshot.audio.target, 'alert');
});

test('a script cannot be replayed onto a runtime whose clock is already past it', () => {
  const runtime = new Runtime(manifest); runtime.advanceTo(300);
  const s = new TracedSession(runtime, presets, { script: parseScript('100:tense', presets) });
  assert.throws(() => s.advance(400), /monotonic/);
});
