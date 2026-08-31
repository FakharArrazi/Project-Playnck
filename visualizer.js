import { state, $, audioEl, idbPut } from "./state.js";
import { analyserNode, ensureAudioGraph } from "./equalizer.js";

/* ================================================================
   VISUALIZER
   A subtle, audio-reactive layer of bars pinned to the absolute
   bottom edge of the player panel (see #visualizerCanvas in
   index.html and .visualizer-canvas in styles.css) — not a separate
   view, just a quiet background wash that pulses with whatever's
   actually playing. Reads off the same AnalyserNode tapped into the
   shared EQ graph (see ensureAudioGraph above), so it reflects the
   real, post-EQ signal — including whichever element is contributing
   sound mid-crossfade during a Gapless Playback transition.

   The render loop only ever runs while there's something worth
   drawing — the toggle is on in Settings > Player AND a track is
   actually playing — and stops itself the instant either stops
   being true, rather than looping in the background for no reason.
   ================================================================ */

let visualizerRafHandle=null;
let visualizerFreqData=null; // reused Uint8Array sized to analyserNode.frequencyBinCount

// Persists both the on/off toggle and the opacity/intensity slider
// together, so neither setting can drift out of sync in storage.
function saveVisualizerSettings(){
  idbPut("settings",{key:"visualizer", value:{enabled:state.visualizer.enabled, intensity:state.visualizer.intensity}}).catch(()=>{});
}

// Starts or stops the render loop to match reality. Called from the
// Settings > Player toggle and from audioEl's play/pause listeners
// below — cheap and idempotent, safe to call as often as needed.
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

// Matches the canvas's pixel buffer to its actual on-screen size,
// including devicePixelRatio so bars stay crisp on hi-DPI displays.
// Called once whenever the loop (re)starts and on window resize —
// the row's size only changes then, not on every animation tick.
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
    return; // loop stops here — updateVisualizerState() restarts it once conditions are true again
  }

  if(!visualizerFreqData || visualizerFreqData.length!==analyserNode.frequencyBinCount){
    visualizerFreqData=new Uint8Array(analyserNode.frequencyBinCount);
  }
  analyserNode.getByteFrequencyData(visualizerFreqData);

  const ctx=canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);
  if(w<=0||h<=0){ visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame); return; }

  // Reads the app's own theme accent color rather than a fixed one,
  // so this matches whatever's picked in Settings > Theme.
  const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue("--accent1-rgb")||"").trim() || "138,92,246";
  const barCount=Math.min(28, analyserNode.frequencyBinCount);
  const gap=w*0.012;
  const barWidth=(w-gap*(barCount-1))/barCount;

  for(let i=0;i<barCount;i++){
    // Skip the first couple of bins — mostly sub-bass/DC offset that
    // tends to sit near-maxed regardless of the song, which would
    // otherwise make the left edge look stuck instead of reactive.
    const v=visualizerFreqData[i+2]/255;
    const barH=Math.max(h*0.05, Math.min(h*0.6, v*h*0.6)); // capped — a wash behind the buttons, never fills the row
    const x=i*(barWidth+gap);
    const y=h-barH;
    const r=Math.min(barWidth/2,4*(window.devicePixelRatio||1));
    // Base alpha stays the same subtle 0.12–0.34 wash; the Settings > Player
    // opacity slider (state.visualizer.intensity, 0–2) scales it up or down
    // from there — 1 is the original look, 2 pushes bars toward fully solid.
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
