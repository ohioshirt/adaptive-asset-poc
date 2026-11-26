// Media-independent, deterministic control plane. Time is integer milliseconds.
const positive = n => Number.isSafeInteger(n) && n > 0;
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);

function compile(track) {
  const { id, initial, states, transitions } = track;
  if (!validId(id) || !states || !Object.hasOwn(states, initial) || !Array.isArray(transitions)) throw Error('invalid track');
  const periods = new Map(Object.entries(states).map(([name, state]) => {
    if (!validId(name) || !positive(state.safeEveryMs) || !['state','global'].includes(state.safeClock ?? 'state')) throw Error(`${id}: invalid state ${name}`);
    return [name, { period:state.safeEveryMs, clock:state.safeClock ?? 'state' }];
  }));
  const edges = new Map([...periods.keys()].map(s => [s, []]));
  for (const edge of transitions) {
    const { from, to, durationMs, asset } = edge;
    if (!periods.has(from) || !periods.has(to) || from === to || !positive(durationMs) || !validId(asset)) throw Error(`${id}: invalid transition`);
    if (edges.get(from).some(e => e.to === to)) throw Error(`${id}: duplicate transition ${from}->${to}`);
    edges.get(from).push({ from, to, durationMs, asset });
  }
  for (const list of edges.values()) list.sort((a,b)=>cmp(a.to,b.to));
  // BFS: fewest edges, lexicographic tie-break. Every pair must be reachable.
  const routes = new Map();
  for (const from of periods.keys()) {
    const first = new Map([[from, null]]), queue = [from];
    for (let i=0; i<queue.length; i++) {
      const current = queue[i];
      for (const edge of edges.get(current)) if (!first.has(edge.to)) {
        first.set(edge.to, current === from ? edge : first.get(current));
        queue.push(edge.to);
      }
    }
    if (first.size !== periods.size) throw Error(`${id}: unreachable state from ${from}`);
    routes.set(from, first);
  }
  return { id, periods, routes, state: initial, target: initial, enteredAt: 0, active: null };
}

export class Runtime {
  #now = 0;
  #tracks;
  constructor(manifest) {
    if (!Array.isArray(manifest.tracks) || !manifest.tracks.length) throw Error('tracks required');
    this.#tracks = new Map();
    for (const spec of manifest.tracks) {
      const t = compile(spec);
      if (this.#tracks.has(t.id)) throw Error(`duplicate track ${t.id}`);
      this.#tracks.set(t.id, t);
    }
    this.#tracks = new Map([...this.#tracks].sort(([a],[b])=>cmp(a,b)));
  }
  get now() { return this.#now; }
  #due(t) {
    if (t.active) return t.active.endMs;
    if (t.state === t.target) return Infinity;
    const {period,clock} = t.periods.get(t.state);
    const origin = clock === 'global' ? 0 : t.enteredAt;
    return origin + Math.ceil((this.#now - origin) / period) * period;
  }
  #process(at, events) {
    for (const t of this.#tracks.values()) {
      if (this.#due(t) !== at) continue;
      if (t.active) {
        const edge = t.active;
        t.active = null;
        t.state = edge.to;
        t.enteredAt = at;
        events.push({ atMs:at, track:t.id, type:'end', ...edge });
      }
      if (!t.active && t.state !== t.target && this.#due(t) === at) {
        const edge = t.routes.get(t.state).get(t.target);
        t.active = { ...edge, startMs: at, endMs: at + edge.durationMs };
        events.push({ atMs:at, track:t.id, type:'start', ...t.active });
      }
    }
  }
  advanceTo(at) {
    if (!Number.isSafeInteger(at) || at < this.#now) throw Error('clock must be monotonic integer milliseconds');
    const events = [];
    while (true) {
      const next = Math.min(...[...this.#tracks.values()].map(t=>this.#due(t)));
      if (next > at) break;
      this.#now = next;
      this.#process(next, events);
    }
    this.#now = at;
    return events;
  }
  // Atomic request at current clock. Latest target wins; active edges finish.
  request(targets) {
    const changes = Object.entries(targets);
    for (const [id, target] of changes) if (!this.#tracks.get(id)?.periods.has(target)) throw Error(`unknown target ${id}:${target}`);
    for (const [id, target] of changes) this.#tracks.get(id).target = target;
    return this.advanceTo(this.#now);
  }
  #phase(t) {
    const {period,clock} = t.periods.get(t.state);
    return (this.#now - (clock === 'global' ? 0 : t.enteredAt)) % period;
  }
  snapshot() {
    return Object.fromEntries([...this.#tracks].map(([id,t])=>[id, {
      state:t.state, target:t.target, enteredAt:t.enteredAt,
      phaseMs:t.active ? null : this.#phase(t),
      transition:t.active ? { ...t.active, progress:(this.#now-t.active.startMs)/t.active.durationMs } : null
    }]));
  }
}
