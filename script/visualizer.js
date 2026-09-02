import { state, $, audioEl, idbPut } from "./state.js";
import { analyserNode, ensureAudioGraph } from "./equalizer.js";


let visualizerRafHandle=null;
let visualizerFreqData=null;

function saveVisualizerSettings(){
  idbPut("settings",{key:"visualizer", value:{enabled:state.visualizer.enabled, intensity:state.visualizer.intensity}}).catch(()=>{});
}

function updateVisualizerState(){
  const canvas=$("visualizerCanvas");
  if(!canvas) return;
  canvas.classList.toggle("hidden", !state.visualizer.enabled);

  const shouldRun = state.visualizer.enabled && !audioEl.paused && !!state.currentTrack;
  if(shouldRun && !visualizerRafHandle){
    ensureAudioGraph();
    sizeVisualizerCanvas(canvas);
    visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame);
  } else if(!shouldRun && visualizerRafHandle){
    cancelAnimationFrame(visualizerRafHandle);
    visualizerRafHandle=null;
  }
}

function sizeVisualizerCanvas(canvas){
  const dpr=window.devicePixelRatio||1;
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(1,Math.round(rect.width*dpr));
  canvas.height=Math.max(1,Math.round(rect.height*dpr));
}

function drawVisualizerFrame(){
  const canvas=$("visualizerCanvas");
  if(!canvas || !analyserNode || !state.visualizer.enabled || audioEl.paused){
    visualizerRafHandle=null;
    return;
  }

  if(!visualizerFreqData || visualizerFreqData.length!==analyserNode.frequencyBinCount){
    visualizerFreqData=new Uint8Array(analyserNode.frequencyBinCount);
  }
  analyserNode.getByteFrequencyData(visualizerFreqData);

  const ctx=canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);
  if(w<=0||h<=0){ visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame); return; }

  const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue("--accent1-rgb")||"").trim() || "138,92,246";
  const barCount=Math.min(28, analyserNode.frequencyBinCount);
  const gap=w*0.012;
  const barWidth=(w-gap*(barCount-1))/barCount;

  for(let i=0;i<barCount;i++){
    const v=visualizerFreqData[i+2]/255;
    const barH=Math.max(h*0.05, Math.min(h*0.6, v*h*0.6));
    const x=i*(barWidth+gap);
    const y=h-barH;
    const r=Math.min(barWidth/2,4*(window.devicePixelRatio||1));
    const alpha=Math.max(0,Math.min(1,(0.12+v*0.22)*state.visualizer.intensity));
    ctx.fillStyle=`rgba(${accentRgb},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x,h);
    ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r);
    ctx.lineTo(x+barWidth-r,y);
    ctx.arcTo(x+barWidth,y,x+barWidth,y+r,r);
    ctx.lineTo(x+barWidth,h);
    ctx.closePath();
    ctx.fill();
  }

  visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame);
}

window.addEventListener("resize",()=>{
  if(!visualizerRafHandle) return;
  const canvas=$("visualizerCanvas");
  if(canvas) sizeVisualizerCanvas(canvas);
});

export { saveVisualizerSettings, updateVisualizerState };
