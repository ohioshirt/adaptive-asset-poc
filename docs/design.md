# Design: media-independent transition contracts

## Hypothesis

A shared orchestration layer can represent temporal state, safe switching and intent for different media without conflating rendering algorithms. Asset authors (including AI agents) can supply transition clips, while the runtime executes contracts deterministically.

## Separation

1. Semantic intent: `friendly`, `tense`, etc. Maps to per-track desired states.
2. Control plane: validates graph, plans a path, schedules safe points, emits transition start/end.
3. Media adapter: consumes snapshot/events, chooses a clip and handles media-specific composition.
4. Asset provider and validator (future): generate/import media, check continuity, compatibility and availability before runtime publication.

A transition includes `from`, `to`, `durationMs`, `asset`. A stable state has a `safeEveryMs` and optional `safeClock` (`state` or `global`). Graph edges must have positive integer duration and unique endpoint pairs; graphs must be strongly connected in this PoC. `state` means last completed edge's end is phase zero. `global` means zero is runtime epoch, useful for musical grids. Runtime routes by minimum hop count, lexicographic target tie-break. This is deterministic, not a guarantee of optimal perceived latency.

## Semantics

- Time is monotonically increasing integer milliseconds. `advanceTo` advances to an absolute timestamp and drains due events. Requests are applied at the current clock, after earlier `advanceTo` events, with equality at the current safe point allowed.
- `request({track: target, ...})` is atomic with respect to validation. Each track retains only its latest desired state. An in-flight edge is noninterruptible. Pending work can be canceled if a new target equals the stable state.
- Edges complete exactly once at `startMs + durationMs`, after which the runtime may immediately begin another edge if eligible. Simultaneous events are ordered by track ID, and within a track end precedes start. The logical scheduler is independent of tick frequency given the same timed requests.
- A request stamped exactly on a safe point does not override an edge that is already due at that instant: `advanceTo(t)` starts the due edge first and the request is applied after it. Example (baseline scenario): face is `concern` with a pending `neutral` target, safe point at 3000; a `smile` request stamped 3000 arrives after `concern → neutral` has started, so `smile` is reached through `neutral`.
- The runtime has no notion of input time. The application layer decides the timestamp of a request. The demo stamps a click with the clock read in that click handler; `demo/session.mjs` can instead replay scripted requests at exact logical times, which makes the logical trace independent of frame rate. Neither makes the perceived result frame-rate independent: a late frame shows the transition late and may skip its first samples.
- Stable state means last completed state, not necessarily current visual appearance during a transition. A snapshot exposes in-flight edge and progress separately.
- A stable target is eventually reached if requests stop and clock advances, under valid finite graphs, durations and practical bounded integer time. For any fixed path, a conservative wait bound includes residual in-flight edge time plus each edge duration and the source state's safe-period bound. This is a design argument, not a formal proof or a cross-media deadline guarantee.

## Limitations / important failure modes

- Independent tracks do not guarantee cross-track visual or semantic compatibility. A face clip may depend on head pose; audio may depend on speech. Future arbitration should use explicit capabilities, constraints, resource ownership and synchronization groups rather than a Cartesian product of every track.
- Safe points are regular grids only; marker lists, phase mappings and quantization rules are absent. Multi-hop routing does not optimize wait time or visual quality. Cross-track transactions, priorities, preemption and streaming assets are absent.
- Browser uses PNG atlases, 20 fps source samples; the equivalent WebM encodes 12 frames/600ms, while the exact endpoint is a separate stable PNG. Browser playback compatibility is not assumed; `demo/webm-probe.html` measures it per browser (decode, alpha, frame content) without driving the clips from the runtime. See `docs/experiments/m0-baseline.md` for which browsers were measured. The clip endpoint pose does not by itself guarantee velocity or lighting continuity in generated content.
- Audio loops share an audio-clock epoch, but the demonstration adjusts gains on animation frames with 15ms smoothing; this is not sample-accurate scheduling. Tab throttling can delay/skip perceived rendering without changing logical transitions. Production adapters should pre-schedule audio-clock events and define seek, stall and resync semantics.
- No claim of generality for static resources or resource-specific mixing: static assets need no graph. Images, music, animation and physics retain their own adapter contracts.

## Next experiment: replace synthetic face with generated RGBA video

Keep runtime and intent contract fixed. Use a character-neutral asset first, then optionally integrate existing character artwork subject to licensing/consent. Generate neutral → 45° → neutral clips and neutral → smile → neutral. Establish canonical endpoint frames, alpha convention, duration, scale and anchor positions. Run a native video/PNG frame fallback and a Godot adapter.

Acceptance criteria (proposed, not verified):

- A single API controls two media tracks; no hard-coded clip choice in application logic.
- Deterministic event history across tick partitions for identical request timing.
- A transition always ends at a compatible declared pose; test endpoint similarity, landmarks, silhouette, color/scale alignment and temporal jitter. Add human review of contact/occlusion and character identity; metrics alone are insufficient.
- Foreground composites onto at least three backgrounds without obvious halos, holes or unstable matte. Check straight/premultiplied alpha and color space explicitly.
- Report p50/p95 input-to-visible-transition latency, dropped frames and peak memory at target hardware; decide limits before comparison. Demonstrate rapid input changes without invalid intermediate states.
- Compare generated clips with rigtext for the same motions, rating quality, production effort, latency, reuse and controllability; keep alternatives if each is useful.

Do not expand to a universal game engine before demonstrating that this layer pays for itself in at least two real adapters.
