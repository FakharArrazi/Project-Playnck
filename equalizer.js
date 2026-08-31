import { state, audioEl, idbPut } from "./state.js";

/* ================================================================
   EQUALIZER
   A 10-band graphic EQ sitting between the <audio> element(s) and
   the speakers, via the Web Audio API. Both audioEl (the primary
   element) and fadeAudioEl (the hidden second element Gapless
   Playback's crossfade uses — see below) are routed through the
   exact same filter chain, so EQ applies consistently no matter
   which one is currently producing sound, including during a
   crossfade where both are briefly audible at once.

   Built lazily — on first real playback, or the first time the
   person touches an EQ control, whichever comes first — rather than
   at startup: creating an AudioContext before any user gesture has
   happened leaves it stuck "suspended" under the browser's autoplay
   policy, and there's no reason to pay for any of this for someone
   who never opens Settings > Audio.

   "Off" doesn't disconnect anything — every band's gain is just set
   to 0 dB (a true pass-through). That's simpler than physically
   rewiring the graph, and can't glitch whatever's currently playing
   the way disconnecting/reconnecting live nodes could.
   ================================================================ */

const EQ_BANDS=[
  {freq:32,    type:"lowshelf"},
  {freq:64,    type:"peaking"},
  {freq:125,   type:"peaking"},
  {freq:250,   type:"peaking"},
  {freq:500,   type:"peaking"},
  {freq:1000,  type:"peaking"},
  {freq:2000,  type:"peaking"},
  {freq:4000,  type:"peaking"},
  {freq:8000,  type:"peaking"},
  {freq:16000, type:"highshelf"}
];
// A few reasonable starting points shown as one-click buttons in
// Settings > Audio, on top of the 10 sliders for manual adjustment.
// Each array is one gain in dB (-12..12) per EQ_BANDS entry, in order.
const EQ_PRESETS={
  flat:        [0,0,0,0,0,0,0,0,0,0],
  bassBoost:   [6,5,4,2,0,0,0,0,0,0],
  trebleBoost: [0,0,0,0,0,0,2,4,5,6],
  vocalBoost:  [-2,-2,-1,1,3,3,2,0,-1,-2]
};

let audioCtx=null;
let eqFilters=null;    // array of EQ_BANDS.length BiquadFilterNodes, wired in series
let eqInputNode=null;  // the first filter — anything that wants EQ applied connects its source here
let analyserNode=null; // passive tap for the Visualizer — see ensureAudioGraph and the VISUALIZER section below

// "1000" -> "1k", "125" -> "125" — just for the band labels in Settings.
function formatEqFreq(hz){
  return hz>=1000 ? (hz/1000)+"k" : String(hz);
}

// Builds the Web Audio graph the first time it's actually needed
// (see the file header comment above for why this is lazy). Safe to
// call any number of times from anywhere — every call after the
// first is a no-op.
function ensureAudioGraph(){
  if(audioCtx) return;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx) return; // very old/unusual environment — EQ/gapless quietly do nothing rather than throwing

  audioCtx=new Ctx();
  if(audioCtx.state==="suspended") audioCtx.resume().catch(()=>{});

  eqFilters=EQ_BANDS.map(band=>{
    const f=audioCtx.createBiquadFilter();
    f.type=band.type;
    f.frequency.value=band.freq;
    if(band.type==="peaking") f.Q.value=1;
    f.gain.value=0;
    return f;
  });
  for(let i=0;i<eqFilters.length-1;i++) eqFilters[i].connect(eqFilters[i+1]);
  const eqOutput=eqFilters[eqFilters.length-1];
  eqOutput.connect(audioCtx.destination);
  eqInputNode=eqFilters[0];

  // Visualizer tap: a passive listener on the exact same post-EQ
  // signal everyone actually hears — including whichever element is
  // contributing sound mid-crossfade during a Gapless Playback
  // transition, since both merge into eqOutput already. Doesn't need
  // a downstream .connect() of its own; getByteFrequencyData() below
  // just reads whatever's currently flowing through it.
  analyserNode=audioCtx.createAnalyser();
  analyserNode.fftSize=64; // coarse on purpose — a handful of chunky bars, not a fine spectrum
  analyserNode.smoothingTimeConstant=0.75; // heavier smoothing so the bars ease rather than flicker
  eqOutput.connect(analyserNode);

  applyEqGains();
  connectMediaElementToEq(audioEl);
}

// Routes one <audio> element's output through the shared EQ filter
// chain instead of straight to the speakers. A given element can
// only ever have createMediaElementSource() called on it once for
// its whole lifetime (a hard Web Audio API rule), so this is only
// ever called once per element: once for audioEl (from
// ensureAudioGraph just above) and once for fadeAudioEl, the first
// time Gapless Playback actually needs it (see getFadeAudioEl
// further below).
function connectMediaElementToEq(mediaEl){
  const source=audioCtx.createMediaElementSource(mediaEl);
  source.connect(eqInputNode);
}

// Pushes state.eq onto the real filter nodes — 0 dB (flat/pass-
// through) on every band while state.eq.enabled is false, regardless
// of what's saved in state.eq.gains, so switching the toggle off is
// a true bypass without needing to touch the graph's wiring itself.
function applyEqGains(){
  if(!eqFilters) return;
  eqFilters.forEach((f,i)=>{
    f.gain.value = state.eq.enabled ? (state.eq.gains[i]||0) : 0;
  });
}

// Persists state.eq (on/off + all 10 gains) to IndexedDB — the same
// "settings" key/value store already used for theme/volume/language.
function saveEqSettings(){
  idbPut("settings",{key:"equalizer", value:{enabled:state.eq.enabled, gains:state.eq.gains}}).catch(()=>{});
}

export { EQ_BANDS, EQ_PRESETS, audioCtx, analyserNode, formatEqFreq, ensureAudioGraph, connectMediaElementToEq, applyEqGains, saveEqSettings };
