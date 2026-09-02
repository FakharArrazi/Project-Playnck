import { state, audioEl, $, idbPut } from "./state.js";
import { fmtTime } from "./utils.js";
import { pruneFolder } from "./metadata.js";
import { renderTab, refreshPlayingHighlight } from "./library-view.js";
import { removeTrackData } from "./playlists.js";
import { ensureAudioGraph } from "./equalizer.js";
import { resolveNextIndex } from "./queue.js";
import { fadeAudioEl, crossfadeState, cancelCrossfade, completeCrossfadeHandoff, maybeStartCrossfade } from "./crossfade.js";
import { updateVisualizerState } from "./visualizer.js";
import { updatePlayIcons, updateNowPlayingUI } from "./now-playing-ui.js";
import { closeLyrics, syncLyrics } from "./lyrics.js";
import { resetHistoryProgress } from "./history.js";


function playTrack(track, queueTracks){
  cancelCrossfade();
  state.queue = queueTracks.map(t=>t.id);
  state.queueIndex = state.queue.indexOf(track.id);
  state.shuffleHistory = [];
  loadAndPlay(track);
}



function loadAndPlay(track){
  ensureAudioGraph();
  state.currentTrack=track;
  audioEl.src=track.fileURL;
  audioEl.play().catch(()=>{});
  updateNowPlayingUI();
  closeLyrics();
  resetPlayProgress(track.id);
  refreshPlayingHighlight();
}



function recordPlay(track){
  track.playCount=(track.playCount||0)+1;
  track.lastPlayedAt=Date.now();
  if(track.external) return;
  const storeCopy={...track};
  delete storeCopy.fileURL;
  delete storeCopy.artURL;
  idbPut("tracks",storeCopy).catch(()=>{});
}


const MIN_PLAY_SECONDS=30;
let playProgress=null;

function resetPlayProgress(trackId){
  playProgress={trackId, accumMs:0, lastTs:null, registered:false};
  resetHistoryProgress(trackId);
}

function trackPlayProgress(){
  const track=state.currentTrack;
  if(!track || !playProgress || playProgress.trackId!==track.id) return;
  if(playProgress.registered || audioEl.paused) return;

  const now=performance.now();
  if(playProgress.lastTs!=null){
    const delta=Math.min(2000, now-playProgress.lastTs);
    if(delta>0) playProgress.accumMs+=delta;
  }
  playProgress.lastTs=now;

  if(playProgress.accumMs>=MIN_PLAY_SECONDS*1000){
    playProgress.registered=true;
    recordPlay(track);
  }
}



function togglePlay(){
  if(!state.currentTrack){
    if(state.tracks.length){ playTrack(state.tracks[0], state.tracks); }
    return;
  }
  if(audioEl.paused) audioEl.play().catch(()=>{});
  else audioEl.pause();
}



let navSwipeDir=null;

function setNavSwipeDir(value){ navSwipeDir=value; return navSwipeDir; }

function nextTrack(auto){
  cancelCrossfade();
  if(!state.queue.length) return;
  if(state.repeat==="one" && auto){ audioEl.currentTime=0; audioEl.play(); return; }
  const idx=resolveNextIndex();
  if(idx===null) return;
  if(state.shuffle && state.queue.length>1) state.shuffleHistory.push(state.queueIndex);
  state.queueIndex=idx;
  const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(t){ navSwipeDir="next"; loadAndPlay(t); }
}



function prevTrack(){
  cancelCrossfade();
  if(!state.queue.length) return;
  if(audioEl.currentTime>3){ audioEl.currentTime=0; return; }

  if(state.shuffle){
    if(state.shuffleHistory.length){
      const idx=state.shuffleHistory.pop();
      state.queueIndex=idx;
      const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
      if(t){ navSwipeDir="prev"; loadAndPlay(t); }
    } else {
      audioEl.currentTime=0;
    }
    return;
  }

  let idx=state.queueIndex-1;
  if(idx<0) idx = state.repeat==="all" ? state.queue.length-1 : 0;
  state.queueIndex=idx;
  const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(t){ navSwipeDir="prev"; loadAndPlay(t); }
}



function resumeAfterRemoval(){
  if(!state.queue.length) return;

  if(state.shuffle){ nextTrack(false); return; }

  if(state.queueIndex>=state.queue.length){
    if(state.repeat==="all") state.queueIndex=0;
    else return;
  }
  const t=state.tracks.find(tt=>tt.id===state.queue[state.queueIndex]);
  if(t) loadAndPlay(t);
}



async function handleMissingTrack(track){
  if(!window.electronAPI || !window.electronAPI.checkPathsExist) return;

  const folder=state.folders.find(f=>f.id===track.folderId);
  const checkPaths=[track.filePath];
  if(folder && folder.path) checkPaths.push(folder.path);

  let existence={};
  try{ existence=await window.electronAPI.checkPathsExist(checkPaths); }
  catch(e){ console.warn("handleMissingTrack: checkPathsExist failed",e); return; }

  if(existence[track.filePath]!==false) return;

  if(folder && folder.path && existence[folder.path]===false){
    pruneFolder(folder);
  } else {
    removeTrackData(track);
  }

  renderTab();
  resumeAfterRemoval();
}
audioEl.addEventListener("timeupdate",()=>{
  const cur=audioEl.currentTime, dur=audioEl.duration||state.currentTrack&&state.currentTrack.duration||0;
  $("curTime").textContent=fmtTime(cur);
  $("durTime").textContent=fmtTime(dur);
  const pct = dur ? (cur/dur)*1000 : 0;
  const seek=$("seek");
  seek.value=pct;
  seek.style.background=`linear-gradient(to right, var(--accent1) ${pct/10}%, var(--elevated) ${pct/10}%)`;
  if(state.lyricsOpen) syncLyrics(cur);
});
audioEl.addEventListener("play",updatePlayIcons);
audioEl.addEventListener("pause",updatePlayIcons);
audioEl.addEventListener("play",updateVisualizerState);
audioEl.addEventListener("pause",updateVisualizerState);

audioEl.addEventListener("timeupdate",trackPlayProgress);
audioEl.addEventListener("pause",()=>{ if(playProgress) playProgress.lastTs=null; });
audioEl.addEventListener("ended",()=>{
  if(!playProgress || playProgress.registered) return;
  const t=state.currentTrack;
  if(!t || playProgress.trackId!==t.id) return;
  const dur=audioEl.duration;
  if(isFinite(dur) && dur>0 && dur<MIN_PLAY_SECONDS){
    playProgress.registered=true;
    recordPlay(t);
  }
});

audioEl.addEventListener("ended",()=>{ if(crossfadeState) completeCrossfadeHandoff(); else nextTrack(true); });
audioEl.addEventListener("timeupdate",maybeStartCrossfade);
audioEl.addEventListener("pause",()=>{ if(fadeAudioEl && crossfadeState) fadeAudioEl.pause(); });
audioEl.addEventListener("play",()=>{ if(fadeAudioEl && crossfadeState && fadeAudioEl.paused) fadeAudioEl.play().catch(()=>{}); });

audioEl.addEventListener("error",()=>{
  const t=state.currentTrack;
  if(!t || !t.filePath) return;
  handleMissingTrack(t);
});

$("seek").addEventListener("input",(e)=>{
  const dur=audioEl.duration||0;
  audioEl.currentTime=(e.target.value/1000)*dur;
});

function seekBy(seconds){
  if(!state.currentTrack) return;
  const dur=audioEl.duration||state.currentTrack.duration||0;
  audioEl.currentTime=Math.min(Math.max(0,audioEl.currentTime+seconds), dur||Infinity);
}

export {
  playTrack, resetPlayProgress, togglePlay, navSwipeDir, setNavSwipeDir,
  nextTrack, prevTrack, seekBy
};
