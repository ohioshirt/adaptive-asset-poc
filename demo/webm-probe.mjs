// Playback probe: does THIS browser actually decode the bundled alpha VP9 WebM clips, and does the
// alpha channel survive? It is deliberately not driven by the runtime and is not a media adapter.
// It measures decode facts only; it says nothing about perceived quality or runtime-driven sync.
import { manifest } from './manifest.mjs';

const SIZE = 192, SOURCE_FPS = 20, CLIP_FRAMES = 12, TIMEOUT_MS = 8000;
// Frame callbacks are best effort, so only require evidence of motion; the observed count is reported.
const MIN_DISTINCT_FRAMES = 3;
// Eyebrows and mouth: the only region where the synthetic poses differ.
const FEATURE_REGION = [55, 55, 137, 135];
// Error budget for the lossy VP9 encode, as mean absolute difference (0..255) against the PNG atlas.
// Set from measured maxima with margin (see docs/experiments/m0-baseline.md); not a quality metric.
const MAX_FEATURE_DIFF = 3, MAX_COLOR_DIFF = 3, MAX_ALPHA_DIFF = 1;
const params = new URLSearchParams(location.search);
const face = manifest.tracks.find(t => t.id === 'face');
const clips = face.transitions.map(t => ({ asset: t.asset, declaredDurationMs: t.durationMs, to: t.to }));
const work = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE }).getContext('2d', { willReadFrequently: true });
const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

function loadImage(src) { return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(Error(`image ${src} failed`)); im.src = src; }); }
function pixels(source, sx = 0) { work.clearRect(0, 0, SIZE, SIZE); work.drawImage(source, sx, 0, SIZE, SIZE, 0, 0, SIZE, SIZE); return work.getImageData(0, 0, SIZE, SIZE).data; }
function alphaStats(data) {
  let transparent = 0, opaque = 0;
  for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) transparent++; else if (data[i] === 255) opaque++; }
  const n = data.length / 4;
  return { cornerAlpha: data[(2 * SIZE + 2) * 4 + 3], centerAlpha: data[(90 * SIZE + 96) * 4 + 3], transparentFraction: round(transparent / n, 4), opaqueFraction: round(opaque / n, 4) };
}
// Mean absolute difference on premultiplied RGB and on alpha, 0..255, over the whole frame or a region.
function difference(a, b, [x0, y0, x1, y1] = [0, 0, SIZE, SIZE]) {
  let color = 0, alpha = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * SIZE + x) * 4, aa = a[i + 3], ba = b[i + 3];
    alpha += Math.abs(aa - ba);
    for (let c = 0; c < 3; c++) color += Math.abs(a[i + c] * aa - b[i + c] * ba) / 255;
  }
  const n = (x1 - x0) * (y1 - y0);
  return { color: color / (n * 3), alpha: alpha / n };
}

async function probe(clip, cell, atlasPixels) {
  const result = { asset: clip.asset, declaredDurationMs: clip.declaredDurationMs, loaded: false, ended: false, error: null, durationS: null, width: null, height: null, frames: [] };
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.width = video.height = SIZE;
  cell.querySelector('.video').append(video);
  const useFrameCallback = 'requestVideoFrameCallback' in video;
  result.frameClock = useFrameCallback ? 'requestVideoFrameCallback' : 'requestAnimationFrame';
  let probing = true;
  const sample = (mediaTime, presentedFrames = null) => {
    if (!probing || video.readyState < 2) return;
    const index = Math.max(0, Math.min(CLIP_FRAMES - 1, Math.round(mediaTime * SOURCE_FPS)));
    const data = pixels(video);
    const stats = alphaStats(data);
    // Identify the decoded frame by content, in the region where the poses differ: the nearest frame
    // of this clip's own atlas, and the nearest frame of any clip's atlas. The frame drawn can be a
    // neighbour of the one the callback announced, so the index is matched rather than assumed.
    let own = null, any = null;
    for (const [asset, frames] of atlasPixels) for (let i = 0; i < CLIP_FRAMES; i++) {
      const candidate = { asset, index: i, diff: difference(data, frames[i], FEATURE_REGION).color };
      if (!any || candidate.diff < any.diff) any = candidate;
      if (asset === clip.asset && (!own || candidate.diff < own.diff)) own = candidate;
    }
    const reference = atlasPixels.get(clip.asset)[own.index], whole = difference(data, reference);
    result.frames.push({ mediaTimeS: round(mediaTime, 4), presentedFrames, atlasIndex: index, matchedIndex: own.index, featureDiff: round(own.diff), ownIsNearest: own.diff <= any.diff, nearestOther: own.diff <= any.diff ? null : { asset: any.asset, index: any.index, diff: round(any.diff) },
      ...stats, atlasTransparentFraction: alphaStats(reference).transparentFraction, diff: { color: round(whole.color), alpha: round(whole.alpha) } });
  };
  await new Promise(resolve => {
    const timer = setTimeout(() => { result.error ??= 'timeout'; resolve(); }, TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    video.addEventListener('error', () => { result.error = `MediaError ${video.error?.code}: ${video.error?.message ?? ''}`.trim(); done(); });
    video.addEventListener('ended', () => { result.ended = true; done(); });
    video.addEventListener('loadeddata', () => {
      result.loaded = true; result.durationS = round(video.duration, 4); result.width = video.videoWidth; result.height = video.videoHeight;
      if (useFrameCallback) { const onFrame = (_now, meta) => { sample(meta.mediaTime, meta.presentedFrames); if (probing) video.requestVideoFrameCallback(onFrame); }; video.requestVideoFrameCallback(onFrame); }
      else { let last = -1; const poll = () => { if (video.currentTime !== last) { last = video.currentTime; sample(last); } if (probing) requestAnimationFrame(poll); }; requestAnimationFrame(poll); }
      video.play().catch(e => { result.error = `play() rejected: ${e.name}`; done(); });
    }, { once: true });
    video.src = `./assets/${clip.asset}.webm`;
  });
  probing = false;
  const frames = result.frames;
  // presentedFrames counts frames the compositor showed; the callback is best effort and may miss some.
  result.presentedFrames = frames.at(-1)?.presentedFrames ?? null;
  result.framesObserved = frames.length;
  result.distinctAtlasIndexes = [...new Set(frames.map(f => f.atlasIndex))].sort((a, b) => a - b);
  // Alpha survives only if the transparent margin is still transparent and the matte area matches the PNG.
  result.alphaPreserved = frames.length > 0 && frames.every(f => f.cornerAlpha === 0 && f.centerAlpha === 255 && Math.abs(f.transparentFraction - f.atlasTransparentFraction) <= 0.02);
  result.maxColorDiff = frames.length ? Math.max(...frames.map(f => f.diff.color)) : null;
  result.maxAlphaDiff = frames.length ? Math.max(...frames.map(f => f.diff.alpha)) : null;
  result.maxFeatureDiff = frames.length ? Math.max(...frames.map(f => f.featureDiff)) : null;
  result.maxIndexOffset = frames.length ? Math.max(...frames.map(f => Math.abs(f.matchedIndex - f.atlasIndex))) : null;
  // Content matches only if every decoded frame is closest to this clip's own atlas (no other clip's
  // frame is nearer), lands within one frame of the expected position, and stays within the lossy-codec
  // error budget. This catches a wrong or reversed clip and broken colour, not perceptual quality.
  result.contentMatches = frames.length > 0 && frames.every(f => f.ownIsNearest && Math.abs(f.matchedIndex - f.atlasIndex) <= 1 && f.featureDiff <= MAX_FEATURE_DIFF && f.diff.color <= MAX_COLOR_DIFF && f.diff.alpha <= MAX_ALPHA_DIFF);
  result.durationMatches = result.durationS !== null && Math.abs(result.durationS * 1000 - clip.declaredDurationMs) <= 50;
  result.ok = result.loaded && result.ended && !result.error && result.alphaPreserved && result.contentMatches && result.durationMatches && result.distinctAtlasIndexes.length >= MIN_DISTINCT_FRAMES;
  cell.querySelector('.verdict').textContent = result.ok ? `OK: ${result.framesObserved} frames, alpha kept` : `NG: ${result.error ?? (!result.loaded ? 'not loaded' : !result.alphaPreserved ? 'alpha lost' : !result.contentMatches ? 'content mismatch' : !result.durationMatches ? 'duration mismatch' : 'too few frames')}`;
  cell.dataset.ok = String(result.ok);
  return result;
}

async function main() {
  const grid = document.getElementById('grid');
  const support = document.createElement('video');
  const report = { schema: 'adaptive-asset-webm-probe/1', userAgent: navigator.userAgent, canPlayType: { vp9: support.canPlayType('video/webm; codecs="vp9"'), webm: support.canPlayType('video/webm') }, visibility: document.visibilityState, clips: [] };
  const atlasPixels = new Map();
  for (const clip of clips) { const atlas = await loadImage(`./assets/${clip.asset}.png`); atlasPixels.set(clip.asset, Array.from({ length: CLIP_FRAMES }, (_, i) => pixels(atlas, i * SIZE))); }
  for (const clip of clips) {
    const cell = document.createElement('figure');
    cell.innerHTML = `<div class="pair"><div class="video"></div><img alt="" width="${SIZE}" height="${SIZE}" src="./assets/${clip.to}.png"></div><figcaption><b>${clip.asset}.webm</b> / ${clip.to}.png<br><span class="verdict">probing…</span></figcaption>`;
    grid.append(cell);
    try { report.clips.push(await probe(clip, cell, atlasPixels)); }
    catch (e) { report.clips.push({ asset: clip.asset, ok: false, error: String(e.message ?? e), frames: [] }); cell.querySelector('.verdict').textContent = `NG: ${e.message}`; }
  }
  report.ok = report.clips.every(c => c.ok);
  // Loop for visual inspection only after every clip was measured alone.
  for (const video of grid.querySelectorAll('video')) if (video.readyState >= 2 && !video.error) { video.loop = true; video.play().catch(() => {}); }
  document.getElementById('summary').textContent = `${report.ok ? 'すべてのクリップをアルファ付きでデコードできた' : 'デコードできない、またはアルファが失われたクリップがある'}\n${JSON.stringify({ userAgent: report.userAgent, canPlayType: report.canPlayType, clips: report.clips.map(({ frames, ...rest }) => rest) }, null, 2)}`;
  window.__webmProbe = report;
  if (params.has('report')) fetch(`/__report?label=${encodeURIComponent(params.get('report'))}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) }).then(r => r.json()).then(({ next }) => { if (next) location.href = next; }).catch(() => {});
}
main();
