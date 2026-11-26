import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.mjs';
import { manifest } from '../demo/manifest.mjs';
const short = e => [e.atMs,e.track,e.type,e.from,e.to];
test('tracks have independent safe points on the same clock',()=>{
  const r=new Runtime(manifest); r.advanceTo(51);
  assert.deepEqual(r.request({face:'smile',audio:'alert'}),[]);
  assert.deepEqual(r.advanceTo(2400).map(short),[[200,'face','start','neutral','smile'],[800,'face','end','neutral','smile'],[2000,'audio','start','calm','alert'],[2400,'audio','end','calm','alert']]);
});
test('latest target wins but in-flight transition is atomic',()=>{
  const r=new Runtime(manifest); r.request({face:'smile'}); r.advanceTo(150);
  assert.deepEqual(r.request({face:'concern'}),[]); r.advanceTo(300); r.request({face:'neutral'});
  assert.deepEqual(r.advanceTo(1200).map(short),[[600,'face','end','neutral','smile'],[600,'face','start','smile','neutral'],[1200,'face','end','smile','neutral']]);
  assert.equal(r.snapshot().face.state,'neutral');
});
test('pending request can be cancelled before its safe point',()=>{
  const r=new Runtime(manifest);r.advanceTo(20);r.request({face:'smile'});r.advanceTo(100);r.request({face:'neutral'});assert.deepEqual(r.advanceTo(1000),[]);
});
test('atomic invalid request, immutable snapshot, monotonic clock',()=>{
  const r=new Runtime(manifest);const before=r.snapshot();assert.throws(()=>r.request({face:'smile',audio:'invalid'}));assert.deepEqual(r.snapshot(),before);
  r.request({face:'smile'});const snap=r.snapshot();snap.face.transition.to='bad';assert.equal(r.snapshot().face.transition.to,'smile');r.advanceTo(20);assert.throws(()=>r.advanceTo(19));assert.throws(()=>r.advanceTo(20.1));
});
test('time partitioning does not change event history or state',()=>{
  function run(times){const r=new Runtime(manifest);r.advanceTo(17);r.request({face:'smile',audio:'alert'});return [times.flatMap(t=>r.advanceTo(t)),r.snapshot()];}
  assert.deepEqual(run([2500]),run([20,199,200,201,799,800,999,1999,2000,2399,2400,2500]));
});
test('same timestamp ordering and exact-boundary requests',()=>{
  const r=new Runtime(manifest);r.advanceTo(2000);assert.deepEqual(r.request({face:'smile',audio:'alert'}).map(short),[[2000,'audio','start','calm','alert'],[2000,'face','start','neutral','smile']]);
});
test('graph routes through intermediate state; unreachable graph rejected',()=>{
  const t={id:'x',initial:'a',states:{a:{safeEveryMs:20},b:{safeEveryMs:20},c:{safeEveryMs:20}},transitions:[{from:'a',to:'b',asset:'ab',durationMs:10},{from:'b',to:'c',asset:'bc',durationMs:10},{from:'c',to:'a',asset:'ca',durationMs:10}]};
  assert.throws(()=>new Runtime({tracks:[{...t,transitions:t.transitions.slice(0,2)}]}),/unreachable/);
  const r=new Runtime({tracks:[t]});r.request({x:'c'});assert.deepEqual(r.advanceTo(20).map(short),[[10,'x','end','a','b'],[10,'x','start','b','c'],[20,'x','end','b','c']]);
});
test('zero-duration and duplicate edges are rejected',()=>{
  const t=manifest.tracks[0];assert.throws(()=>new Runtime({tracks:[{...t,transitions:[{...t.transitions[0],durationMs:0},...t.transitions.slice(1)]}]}));assert.throws(()=>new Runtime({tracks:[{...t,transitions:[...t.transitions,t.transitions[0]]}]}));
});
test('global safe points remain aligned after a nonzero transition',()=>{
  const r=new Runtime(manifest);r.advanceTo(1);r.request({audio:'alert'});r.advanceTo(2400);r.request({audio:'calm'});
  assert.equal(r.snapshot().audio.phaseMs,400);assert.deepEqual(r.advanceTo(4400).map(short),[[4000,'audio','start','alert','calm'],[4400,'audio','end','alert','calm']]);
});
