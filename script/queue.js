import { state } from "./state.js";

let shuffleNextPick=null;

function resetShuffleNextPick(){ shuffleNextPick=null; }

function resolveNextIndex(){
  if(!state.queue.length) return null;
  if(state.shuffle){
    if(state.queue.length>1){
      const forId=state.currentTrack?state.currentTrack.id:null;
      if(shuffleNextPick && shuffleNextPick.forId===forId) return shuffleNextPick.index;
      let r; do{ r=Math.floor(Math.random()*state.queue.length); }while(r===state.queueIndex);
      shuffleNextPick={forId, index:r};
      return r;
    }
    return state.queueIndex;
  }
  const idx=state.queueIndex+1;
  if(idx>=state.queue.length){
    if(state.repeat==="all") return 0;
    return null;
  }
  return idx;
}

function resolvePrevIndex(){
  if(!state.queue.length) return null;
  if(state.shuffle){
    if(!state.shuffleHistory.length) return null;
    return state.shuffleHistory[state.shuffleHistory.length-1];
  }
  const idx=state.queueIndex-1;
  if(idx<0){
    if(state.repeat==="all") return state.queue.length-1;
    return null;
  }
  return idx;
}

function peekNextEntry(){
  if(!state.currentTrack || !state.queue.length) return null;
  const idx=resolveNextIndex();
  if(idx===null) return null;
  const track=state.tracks.find(tt=>tt.id===state.queue[idx]);
  return track ? {index:idx, track} : null;
}
function peekPrevEntry(){
  if(!state.currentTrack || !state.queue.length) return null;
  const idx=resolvePrevIndex();
  if(idx===null) return null;
  const track=state.tracks.find(tt=>tt.id===state.queue[idx]);
  return track ? {index:idx, track} : null;
}

export { resolveNextIndex, resolvePrevIndex, peekNextEntry, peekPrevEntry, resetShuffleNextPick };
