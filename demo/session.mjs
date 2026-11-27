// Application-layer driver: stamps requests with logical time and records an observable trace.
// It does not change runtime semantics; it only decides *when* runtime.request() is called.
//
// A scripted request "at T" is applied at logical time T exactly, even if the caller's clock has
// already passed T (for example a slow frame). The logical trace is therefore a function of the
// script alone, not of how often advance() is called. What a viewer perceives is NOT covered here:
// a late frame still shows the transition late.

const nonNegativeInt = n => Number.isSafeInteger(n) && n >= 0;

// "130:tense,350:friendly" -> [{atMs:130,preset:'tense'},{atMs:350,preset:'friendly'}]
export function parseScript(text, presets) {
  if (text == null || text === '') return [];
  const script = String(text).split(',').map(entry => {
    const match = /^(\d+):([a-zA-Z0-9_-]+)$/.exec(entry);
    if (!match) throw Error(`invalid script entry "${entry}"`);
    const atMs = Number(match[1]), preset = match[2];
    if (!nonNegativeInt(atMs)) throw Error(`invalid script time "${match[1]}"`);
    if (!Object.hasOwn(presets, preset)) throw Error(`unknown preset "${preset}"`);
    return { atMs, preset };
  });
  for (let i = 1; i < script.length; i++) if (script[i].atMs < script[i - 1].atMs) throw Error('script times must be nondecreasing');
  return script;
}

export class TracedSession {
  #runtime; #presets; #script; #untilMs; #cursor = 0; #requests = []; #events = []; #final = null;
  constructor(runtime, presets, { script = [], untilMs = null } = {}) {
    if (untilMs !== null && !nonNegativeInt(untilMs)) throw Error('untilMs must be a nonnegative integer');
    if (untilMs !== null && script.some(entry => entry.atMs > untilMs)) throw Error('script entry after untilMs');
    for (const entry of script) if (!nonNegativeInt(entry.atMs) || !Object.hasOwn(presets, entry.preset)) throw Error('invalid script entry');
    this.#runtime = runtime; this.#presets = presets; this.#script = script; this.#untilMs = untilMs;
  }
  get done() { return this.#final !== null; }
  #apply(preset) {
    const targets = this.#presets[preset];
    const events = this.#runtime.request(targets);
    this.#requests.push({ atMs: this.#runtime.now, preset, targets: { ...targets } });
    return events;
  }
  // Advance to an absolute clock reading. Readings behind the logical clock are ignored (clamped).
  advance(clockMs) {
    if (this.done) return [];
    if (!Number.isFinite(clockMs)) throw Error('clock must be a finite number');
    let clock = Math.max(this.#runtime.now, Math.floor(clockMs));
    if (this.#untilMs !== null) clock = Math.min(clock, this.#untilMs);
    const events = [];
    while (this.#cursor < this.#script.length && this.#script[this.#cursor].atMs <= clock) {
      const { atMs, preset } = this.#script[this.#cursor++];
      events.push(...this.#runtime.advanceTo(atMs));
      events.push(...this.#apply(preset));
    }
    events.push(...this.#runtime.advanceTo(clock));
    this.#events.push(...events);
    if (this.#untilMs !== null && clock === this.#untilMs) this.#final = { atMs: clock, snapshot: this.#runtime.snapshot() };
    return events;
  }
  // Interactive request at the current logical clock (the caller advances first).
  request(preset) {
    if (this.done) return [];
    if (!Object.hasOwn(this.#presets, preset)) throw Error(`unknown preset "${preset}"`);
    const events = this.#apply(preset);
    this.#events.push(...events);
    return events;
  }
  // Deterministic part of the trace. `final` is null until untilMs is reached.
  logicalTrace() {
    return structuredClone({ schema: 'adaptive-asset-trace/1', untilMs: this.#untilMs, requests: this.#requests, events: this.#events, final: this.#final });
  }
}

// Reference replay: feed recorded requests to a fresh runtime with one advance per request.
export function replay(runtime, requests, untilMs) {
  const events = [];
  for (const { atMs, targets } of requests) { events.push(...runtime.advanceTo(atMs)); events.push(...runtime.request(targets)); }
  events.push(...runtime.advanceTo(untilMs));
  return { events, final: { atMs: untilMs, snapshot: runtime.snapshot() } };
}
