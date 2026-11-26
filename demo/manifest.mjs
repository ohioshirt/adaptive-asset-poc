const faceStates = ['neutral','smile','concern'];
export const manifest = { tracks: [
  { id:'face', initial:'neutral', states:Object.fromEntries(faceStates.map(s=>[s,{safeEveryMs:200}])),
    transitions:faceStates.flatMap(from=>faceStates.filter(to=>to!==from).map(to=>({from,to,durationMs:600,asset:`${from}_${to}`}))) },
  { id:'audio', initial:'calm', states:{calm:{safeEveryMs:2000,safeClock:'global'},alert:{safeEveryMs:2000,safeClock:'global'}},
    transitions:[{from:'calm',to:'alert',durationMs:400,asset:'calm_alert'},{from:'alert',to:'calm',durationMs:400,asset:'alert_calm'}] }
] };
export const presets = { neutral:{face:'neutral',audio:'calm'}, friendly:{face:'smile',audio:'calm'}, tense:{face:'concern',audio:'alert'} };
