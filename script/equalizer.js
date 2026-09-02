import { state, audioEl, idbPut } from "./state.js";


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
const EQ_PRESETS={
  flat:        [0,0,0,0,0,0,0,0,0,0],
  bassBoost:   [6,5,4,2,0,0,0,0,0,0],
  trebleBoost: [0,0,0,0,0,0,2,4,5,6],
  vocalBoost:  [-2,-2,-1,1,3,3,2,0,-1,-2]
};

let audioCtx=null;
let eqFilters=null;
let eqInputNode=null;
let analyserNode=null;

function formatEqFreq(hz){
  return hz>=1000 ? (hz/1000)+"k" : String(hz);
}

function ensureAudioGraph(){
  if(audioCtx) return;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx) return;

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

  analyserNode=audioCtx.createAnalyser();
  analyserNode.fftSize=64;
  analyserNode.smoothingTimeConstant=0.75;
  eqOutput.connect(analyserNode);

  applyEqGains();
  connectMediaElementToEq(audioEl);
}

function connectMediaElementToEq(mediaEl){
  const source=audioCtx.createMediaElementSource(mediaEl);
  source.connect(eqInputNode);
}

function applyEqGains(){
  if(!eqFilters) return;
  eqFilters.forEach((f,i)=>{
    f.gain.value = state.eq.enabled ? (state.eq.gains[i]||0) : 0;
  });
}

function saveEqSettings(){
  idbPut("settings",{key:"equalizer", value:{enabled:state.eq.enabled, gains:state.eq.gains}}).catch(()=>{});
}

export { EQ_BANDS, EQ_PRESETS, audioCtx, analyserNode, formatEqFreq, ensureAudioGraph, connectMediaElementToEq, applyEqGains, saveEqSettings };
