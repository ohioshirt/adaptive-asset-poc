import { Runtime } from '../src/runtime.mjs';
import { manifest, presets } from './manifest.mjs';
const $ = id => document.getElementById(id);
const runtime = new Runtime(manifest);
const canvas = $('face'), ctx = canvas.getContext('2d');
const images = new Map();
const history=[];
let audio, audioOrigin, wallOrigin, gains, lastClock=0, starting=false, running=false;
const faceTrack=manifest.tracks.find(t=>t.id==='face');
const assets=[...Object.keys(faceTrack.states),...faceTrack.transitions.map(t=>t.asset)];
const stems=['calm','alert'];
function loadImage(id){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{images.set(id,im);resolve();};im.onerror=()=>reject(Error(`image ${id} failed`));im.src=`./assets/${id}.png`;});}
function record(events){for(const e of events)history.push(`${String(e.atMs).padStart(6)}ms  ${e.track.padEnd(6)} ${e.type.padEnd(5)} ${e.from} → ${e.to}`);if(events.length){$('log').textContent=history.slice(-40).join('\n');$('log').scrollTop=$('log').scrollHeight;}}
function renderFace(s){
  const t=s.transition, key=t?t.asset:s.state;
  const index=t?Math.min(12,Math.floor(t.progress*12)):0;
  ctx.clearRect(0,0,192,192);ctx.drawImage(images.get(key),index*192,0,192,192,0,0,192,192);
}
function renderAudio(s){
  if(!audio)return;
  const t=s.transition;
  for(const stem of stems){const value=t?(stem===t.from?1-t.progress:stem===t.to?t.progress:0):Number(stem===s.state);gains[stem].gain.setTargetAtTime(value,audio.currentTime,0.015);}
}
function render(){const snap=runtime.snapshot();renderFace(snap.face);renderAudio(snap.audio);
  for(const id of ['face','audio']){const s=snap[id],t=s.transition; $(`${id}-state`).textContent=`${t?`${t.from} → ${t.to}`:s.state} | target: ${s.target}`;$(`${id}-progress`).value=t?t.progress:s.phaseMs/manifest.tracks.find(t=>t.id===id).states[s.state].safeEveryMs;}
  $('clock').textContent=`論理時刻: ${(runtime.now/1000).toFixed(3)}s | ${audio?'audio clock':'monotonic wall clock'}`;
}
function advance(){const elapsed=audio?(audio.currentTime-audioOrigin)*1000:performance.now()-wallOrigin;lastClock=Math.max(lastClock,Math.floor(elapsed));record(runtime.advanceTo(lastClock));}
function tick(){if(!running)return;advance();render();requestAnimationFrame(tick);}
async function start(withAudio){if(starting||running)return;starting=true;$('start').disabled=$('silent').disabled=true;
  try{
    if(withAudio){audio=new AudioContext();await audio.resume();gains={};
      const buffers=await Promise.all(stems.map(async id=>{const response=await fetch(`./assets/${id}.wav`);if(!response.ok)throw Error(`audio ${id} failed`);return audio.decodeAudioData(await response.arrayBuffer());}));
      audioOrigin=audio.currentTime+.05;
      stems.forEach((id,i)=>{const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=buffers[i];source.loop=true;gain.gain.value=id==='calm'?1:0;source.connect(gain).connect(audio.destination);source.start(audioOrigin);gains[id]=gain;});
    }else wallOrigin=performance.now();
    running=true;document.querySelectorAll('[data-preset]').forEach(b=>b.disabled=false);tick();
  }catch(e){$('error').textContent=`開始失敗: ${e.message}`;if(audio){await audio.close().catch(()=>{});audio=null;}$('start').disabled=$('silent').disabled=false;}finally{starting=false;}
}
$('start').onclick=()=>start(true);$('silent').onclick=()=>start(false);
$('presets').addEventListener('click',e=>{const id=e.target.dataset.preset;if(!running||!id)return;advance();record(runtime.request(presets[id]));document.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===id)));render();});
$('bg').onchange=e=>{$('scene').style.background={blue:'linear-gradient(135deg,#435e79,#192b44)',warm:'linear-gradient(135deg,#a7684b,#4d2638)',check:'repeating-conic-gradient(#9b9b9b 0% 25%,#ddd 0% 50%) 0 / 24px 24px'}[e.target.value];};
Promise.all(assets.map(loadImage)).then(()=>{renderFace(runtime.snapshot().face);$('clock').textContent='開始を選択';$('start').disabled=$('silent').disabled=false;}).catch(e=>$('error').textContent=e.message);
