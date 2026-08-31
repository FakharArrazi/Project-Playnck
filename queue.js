import { state } from "./state.js";

// Under shuffle, resolveNextIndex() below has to pick a *random*
// index — but it's now also called speculatively, before any click,
// just to paint the carousel's "next" preview (see peekNextEntry()
// and the ALBUM CAROUSEL section further down). Without memoizing
// that pick, every extra speculative call would re-roll the dice,
// so the album the user sees sitting on the right could be a
// different one than what Next/crossfade actually lands on.
// Memoized per state.currentTrack.id — the moment the current track
// actually changes, the old pick is no longer for "what comes after
// THIS track" and naturally falls out of date on its own.
let shuffleNextPick=null; // {forId, index} | null

function resetShuffleNextPick(){ shuffleNextPick=null; }

// Figures out which queue index playback would move to next if
// nextTrack() ran right now, respecting shuffle/repeat — WITHOUT
// moving there or touching shuffleHistory. Used by nextTrack() itself
// (which commits to the result), maybeStartCrossfade() below (which
// needs to know what's coming before the current track actually
// ends, without any side effects, in case it never gets used — e.g.
// the person pauses, skips manually, or picks a different track
// before the crossfade would complete), and peekNextEntry() (which
// paints the carousel's "next" preview with this same result, so
// what's on screen always matches what a click actually does).
// Returns null when there's nowhere to go (end of a non-repeating
// queue). Doesn't handle repeat:"one" — that's a same-track loop,
// not a "next track" in the sense this function's callers care about.
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
    return state.queueIndex; // only one track in the queue — nowhere else to shuffle to
  }
  const idx=state.queueIndex+1;
  if(idx>=state.queue.length){
    if(state.repeat==="all") return 0;
    return null;
  }
  return idx;
}

// Mirror of resolveNextIndex() for the carousel's "previous" preview
// (there's no prevTrack()-side equivalent to memoize against, since
// non-shuffle "previous" is already fully deterministic and shuffle
// "previous" already reads from the deterministic shuffleHistory
// stack rather than picking randomly — see prevTrack() above).
// Returns null exactly where prevTrack() itself would just restart
// the current track rather than genuinely move to a different one
// (no shuffle history yet, or repeat is off and already at index 0):
// the carousel intentionally shows "no previous album" rather than a
// fake one in that case — see peekPrevEntry() and requirement #16 in
// the ALBUM CAROUSEL section below.
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

// Resolves resolveNextIndex()/resolvePrevIndex() all the way to the
// actual track object (or null), for the carousel to paint directly.
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
