import { state, audioEl } from "./state.js";
import { ensureAudioGraph, audioCtx, connectMediaElementToEq } from "./equalizer.js";
import { resolveNextIndex } from "./queue.js";
import { resetPlayProgress, setNavSwipeDir } from "./player.js";
import { updateNowPlayingUI } from "./now-playing-ui.js";
import { closeLyrics } from "./lyrics.js";
import { refreshPlayingHighlight } from "./library-view.js";


const GAPLESS_CROSSFADE_SECONDS=3;

let crossfadeState=null;

let fadeAudioEl=null;
function getFadeAudioEl(){
  if(fadeAudioEl) return fadeAudioEl;
  fadeAudioEl=new Audio();
  fadeAudioEl.preload="auto";
  fadeAudioEl.crossOrigin="anonymous";
  fadeAudioEl.addEventListener("error",()=>{
    cancelCrossfade();
  });
  ensureAudioGraph();
  if(audioCtx) connectMediaElementToEq(fadeAudioEl);
  return fadeAudioEl;
}

function maybeStartCrossfade(){
  if(!state.gapless.enabled) return;
  if(crossfadeState) return;
  if(state.repeat==="one") return;
  const dur=audioEl.duration;
  if(!dur || !isFinite(dur) || dur<GAPLESS_CROSSFADE_SECONDS*2) return;
  if(dur-audioEl.currentTime>GAPLESS_CROSSFADE_SECONDS) return;

  const idx=resolveNextIndex();
  if(idx===null) return;
  const nextTrackObj=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(!nextTrackObj || !nextTrackObj.fileURL) return;

  startCrossfade(idx, nextTrackObj);
}

function startCrossfade(nextIndex, nextTrackObj){
  const fe=getFadeAudioEl();
  fe.src=nextTrackObj.fileURL;
  fe.currentTime=0;
  fe.volume=0;
  fe.play().catch(()=>{});

  const startVolume=audioEl.volume;
  const targetVolume=state.muted?0:state.volume;
  const startedAt=performance.now();
  const durationMs=Math.min(GAPLESS_CROSSFADE_SECONDS, Math.max(0.2, audioEl.duration-audioEl.currentTime))*1000;

  crossfadeState={nextIndex, nextTrack:nextTrackObj, rafHandle:null};

  function tick(){
    if(!crossfadeState) return;
    const p=Math.min(1, (performance.now()-startedAt)/durationMs);
    audioEl.volume=startVolume*(1-p);
    fe.volume=targetVolume*p;
    if(p<1) crossfadeState.rafHandle=requestAnimationFrame(tick);
  }
  tick();
}

function cancelCrossfade(){
  if(!crossfadeState) return;
  if(crossfadeState.rafHandle) cancelAnimationFrame(crossfadeState.rafHandle);
  if(fadeAudioEl){ fadeAudioEl.pause(); fadeAudioEl.src=""; }
  crossfadeState=null;
  audioEl.volume = state.muted?0:state.volume;
}

function completeCrossfadeHandoff(){
  const {nextIndex, nextTrack:nextTrackObj}=crossfadeState;
  const fe=fadeAudioEl;
  if(crossfadeState.rafHandle) cancelAnimationFrame(crossfadeState.rafHandle);

  if(state.shuffle && state.queue.length>1) state.shuffleHistory.push(state.queueIndex);
  state.queueIndex=nextIndex;
  state.currentTrack=nextTrackObj;
  audioEl.src=nextTrackObj.fileURL;
  audioEl.currentTime=fe.currentTime;
  audioEl.volume=state.muted?0:state.volume;
  audioEl.play().catch(()=>{});
  fe.pause();
  fe.src="";

  crossfadeState=null;
  setNavSwipeDir("next");
  updateNowPlayingUI();
  closeLyrics();
  resetPlayProgress(nextTrackObj.id);
  refreshPlayingHighlight();
}

export { crossfadeState, fadeAudioEl, maybeStartCrossfade, startCrossfade, cancelCrossfade, completeCrossfadeHandoff, getFadeAudioEl };
