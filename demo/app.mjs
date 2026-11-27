import { Runtime } from '../src/runtime.mjs';
import { manifest, presets } from './manifest.mjs';
import { TracedSession, parseScript } from './session.mjs';
const $ = id => document.getElementById(id);
// Optional replay parameters (all absent in normal interactive use):
//   script=130:tense,350:friendly  requests stamped at exact logical times
//   until=4700                     freeze the session at this logical time and finalize the trace
//   maxFps=10                      skip animation frames so ticks are at least 1000/maxFps ms apart
//   autostart=silent               start on the wall clock without a click (audio needs a user gesture)
//   report=label                   POST the finished trace to /__report on the serving origin
const params = new URLSearchParams(location.search);
const intParam = (name, min) => { if(!params.has(name)) return null; const n=Number(params.get(name)); if(!Number.isSafeInteger(n)||n<min) throw Error(`invalid ${name}`); return n; };
let config, session;
const runtime = new Runtime(manifest);
try {
  config = { script: params.get('script') ?? '', untilMs: intParam('until',0), maxFps: intParam('maxFps',1), autostart: params.get('autostart'), report: params.get('report') };
  session = new TracedSession(runtime, presets, { script: parseScript(config.script, presets), untilMs: config.untilMs });
} catch (e) { $('error').textContent = `パラメータ不正: ${e.message}`; throw e; }
const canvas = $('face'), ctx = canvas.getContext('2d');
const images = new Map();
const history=[];
// Wall-clock observations. Unlike the logical trace these legitimately differ between runs.
const playback = { clock:null, ticks:0, skippedFrames:0, tickDeltasMs:[], startLagMs:[], faceSamples:new Set(), finishedAtClockMs:null };
const MAX_SAMPLES=36000; // about ten minutes of 60 fps ticks; later samples are not recorded
let lastFace=null;
let audio, audioOrigin, wallOrigin, gains, starting=false, running=false, lastTickAt=null, reported=false;
const faceTrack=manifest.tracks.find(t=>t.id==='face');
const assets=[...Object.keys(faceTrack.states),...faceTrack.transitions.map(t=>t.asset)];
const stems=['calm','alert'];
function loadImage(id){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{images.set(id,im);resolve();};im.onerror=()=>reject(Error(`image ${id} failed`));im.src=`./assets/${id}.png`;});}
function record(events){for(const e of events)history.push(`${String(e.atMs).padStart(6)}ms  ${e.track.padEnd(6)} ${e.type.padEnd(5)} ${e.from} → ${e.to}`);if(events.length){$('log').textContent=history.slice(-40).join('\n');$('log').scrollTop=$('log').scrollHeight;}}
function renderFace(s){
  const t=s.transition, key=t?t.asset:s.state;
  const index=t?Math.min(12,Math.floor(t.progress*12)):0;
  ctx.clearRect(0,0,192,192);ctx.drawImage(images.get(key),index*192,0,192,192,0,0,192,192);
  lastFace={key,index,nowMs:runtime.now};if(running||session.done)playback.faceSamples.add(`${key}:${index}`);
}
function renderAudio(s){
  if(!audio)return;
  const t=s.transition;
  for(const stem of stems){const value=t?(stem===t.from?1-t.progress:stem===t.to?t.progress:0):Number(stem===s.state);gains[stem].gain.setTargetAtTime(value,audio.currentTime,0.015);}
}
function render(){const snap=runtime.snapshot();renderFace(snap.face);renderAudio(snap.audio);
  for(const id of ['face','audio']){const s=snap[id],t=s.transition; $(`${id}-state`).textContent=`${t?`${t.from} → ${t.to}`:s.state} | target: ${s.target}`;$(`${id}-progress`).value=t?t.progress:s.phaseMs/manifest.tracks.find(t=>t.id===id).states[s.state].safeEveryMs;}
  $('clock').textContent=`論理時刻: ${(runtime.now/1000).toFixed(3)}s | ${audio?'audio clock':'monotonic wall clock'}${session.done?' | 終了':''}`;
}
const readClock=()=>audio?(audio.currentTime-audioOrigin)*1000:performance.now()-wallOrigin;
function advance(){const clock=readClock(),events=session.advance(clock);for(const e of events)if(e.type==='start'&&playback.startLagMs.length<MAX_SAMPLES)playback.startLagMs.push(Math.round(clock-e.atMs));record(events);return clock;}
function tick(frameAt){if(!running)return;
  if(config.maxFps&&lastTickAt!==null&&frameAt-lastTickAt<1000/config.maxFps-1){playback.skippedFrames++;requestAnimationFrame(tick);return;}
  if(lastTickAt!==null&&playback.tickDeltasMs.length<MAX_SAMPLES)playback.tickDeltasMs.push(frameAt-lastTickAt);
  lastTickAt=frameAt;playback.ticks++;
  const clock=advance();render();
  if(session.done){running=false;playback.finishedAtClockMs=Math.round(clock);finish();return;}
  requestAnimationFrame(tick);
}
const percentile=(sorted,p)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)]:null;
function stats(values){const sorted=[...values].sort((a,b)=>a-b),round=v=>v===null?null:Math.round(v*10)/10;return {count:sorted.length,p50:round(percentile(sorted,.5)),p95:round(percentile(sorted,.95)),max:round(sorted.at(-1)??null)};}
function trace(){return {
  logical:session.logicalTrace(),
  config:{script:config.script,untilMs:config.untilMs,maxFps:config.maxFps,autostart:config.autostart},
  playback:{clock:playback.clock,ticks:playback.ticks,skippedFrames:playback.skippedFrames,tickDeltaMs:stats(playback.tickDeltasMs),startLagMs:stats(playback.startLagMs),faceSamples:[...playback.faceSamples],finishedAtClockMs:playback.finishedAtClockMs,audioState:audio?.state??null,audioSampleRate:audio?.sampleRate??null},
  env:{userAgent:navigator.userAgent,devicePixelRatio,visibility:document.visibilityState}
};}
function finish(){document.querySelectorAll('[data-preset]').forEach(b=>b.disabled=true);render();
  if(config.report&&!reported){reported=true;fetch(`/__report?label=${encodeURIComponent(config.report)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(trace())}).then(r=>r.json()).then(({next})=>{if(next)location.href=next;}).catch(()=>{});}
}
window.__adaptiveAsset={trace,get lastFace(){return lastFace;},get done(){return session.done;},get running(){return running;}};
async function start(withAudio){if(starting||running||session.done)return;starting=true;$('start').disabled=$('silent').disabled=true;
  try{
    if(withAudio){audio=new AudioContext();await audio.resume();gains={};
      const buffers=await Promise.all(stems.map(async id=>{const response=await fetch(`./assets/${id}.wav`);if(!response.ok)throw Error(`audio ${id} failed`);return audio.decodeAudioData(await response.arrayBuffer());}));
      audioOrigin=audio.currentTime+.05;
      stems.forEach((id,i)=>{const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=buffers[i];source.loop=true;gain.gain.value=id==='calm'?1:0;source.connect(gain).connect(audio.destination);source.start(audioOrigin);gains[id]=gain;});
    }else wallOrigin=performance.now();
    playback.clock=withAudio?'audio':'wall';
    running=true;document.querySelectorAll('[data-preset]').forEach(b=>b.disabled=false);$('save').disabled=false;requestAnimationFrame(tick);
  }catch(e){$('error').textContent=`開始失敗: ${e.message}`;if(audio){await audio.close().catch(()=>{});audio=null;}$('start').disabled=$('silent').disabled=false;}finally{starting=false;}
}
$('start').onclick=()=>start(true);$('silent').onclick=()=>start(false);
$('presets').addEventListener('click',e=>{const id=e.target.dataset.preset;if(!running||!id)return;advance();record(session.request(id));document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===id)));render();});
$('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(trace(),null,2)],{type:'application/json'}));a.download=`adaptive-asset-trace-${runtime.now}ms.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);};
$('bg').onchange=e=>{$('scene').style.background={blue:'linear-gradient(135deg,#435e79,#192b44)',warm:'linear-gradient(135deg,#a7684b,#4d2638)',check:'repeating-conic-gradient(#9b9b9b 0% 25%,#ddd 0% 50%) 0 / 24px 24px'}[e.target.value];};
if(params.has('bg')){$('bg').value=params.get('bg');$('bg').onchange({target:$('bg')});}
Promise.all(assets.map(loadImage)).then(()=>{renderFace(runtime.snapshot().face);$('clock').textContent='開始を選択';$('start').disabled=$('silent').disabled=false;if(config.autostart==='silent')start(false);}).catch(e=>$('error').textContent=e.message);
