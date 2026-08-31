import { state, audioEl } from "./state.js";
import { ensureAudioGraph, audioCtx, connectMediaElementToEq } from "./equalizer.js";
import { resolveNextIndex } from "./queue.js";
import { resetPlayProgress, setNavSwipeDir } from "./player.js";
import { updateNowPlayingUI } from "./now-playing-ui.js";
import { closeLyrics } from "./lyrics.js";
import { refreshPlayingHighlight } from "./library-view.js";

/* ================================================================
   GAPLESS PLAYBACK
   Smooths the transition between tracks with a short automatic
   crossfade instead of the small stutter/silence that comes from
   only starting to load the next file after the current one has
   already fully ended. Implemented with a second, hidden <audio>
   element (fadeAudioEl) that starts playing the upcoming track a
   few seconds early, faded in while the primary element (audioEl)
   fades out — audioEl itself is never repurposed for a different
   track mid-fade, so everything else that watches it (the progress
   bar, lyrics sync, OS media keys in renderer-bridge.js) keeps
   working normally for the entire crossfade window, since audioEl
   is genuinely still playing the outgoing track, just at falling
   volume, right up until the handoff below.

   Deliberately NOT attempted for repeat:"one" (looping a track into
   a crossfaded copy of itself adds real edge-case complexity for
   little benefit — that mode already loops instantly, see
   nextTrack()'s own special case for it) or for tracks shorter than
   twice the crossfade window (nothing sensible to fade against that
   early in something that short).
   ================================================================ */

const GAPLESS_CROSSFADE_SECONDS=3;

let crossfadeState=null; // {nextIndex, nextTrack, rafHandle} while a crossfade is in flight, else null

let fadeAudioEl=null;  // hidden second <audio> element, used only by Gapless Playback's crossfade (see getFadeAudioEl below)
// Lazily creates the hidden crossfade-partner element, connecting it
// into the shared EQ graph exactly once (see connectMediaElementToEq
// above). Safe to call repeatedly — later calls just reuse it.
function getFadeAudioEl(){
  if(fadeAudioEl) return fadeAudioEl;
  fadeAudioEl=new Audio();
  fadeAudioEl.preload="auto";
  fadeAudioEl.crossOrigin="anonymous"; // must be set before any src is ever assigned — see the crossorigin note on #audioEl in index.html
  fadeAudioEl.addEventListener("error",()=>{
    // The upcoming file failed to load for some reason (moved/
    // deleted since it was added, etc). Cancel cleanly and let the
    // current track's own "ended" event fall back to a normal
    // nextTrack(true) — handleMissingTrack() (see PLAYBACK above)
    // will sort the library entry out at that point, same as it
    // would for any other track.
    cancelCrossfade();
  });
  ensureAudioGraph();
  if(audioCtx) connectMediaElementToEq(fadeAudioEl);
  return fadeAudioEl;
}

// Checked on every timeupdate tick of the primary element while
// Gapless Playback is on. Starts a crossfade into whatever track
// would play next once we're within GAPLESS_CROSSFADE_SECONDS of
// the current track's natural end.
function maybeStartCrossfade(){
  if(!state.gapless.enabled) return;
  if(crossfadeState) return; // already mid-crossfade for this track
  if(state.repeat==="one") return; // same-track loop — see the file header comment above
  const dur=audioEl.duration;
  if(!dur || !isFinite(dur) || dur<GAPLESS_CROSSFADE_SECONDS*2) return;
  if(dur-audioEl.currentTime>GAPLESS_CROSSFADE_SECONDS) return;

  const idx=resolveNextIndex();
  if(idx===null) return;
  const nextTrackObj=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(!nextTrackObj || !nextTrackObj.fileURL) return;

  startCrossfade(idx, nextTrackObj);
}

// Begins fading from the currently-playing track into nextTrackObj,
// resolved once here and reused as-is at handoff time — resolveNextIndex()
// is never called a second time for the same transition, since doing
// so under shuffle could pick a *different* random track than the one
// that's actually now playing quietly on fadeAudioEl.
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
    if(!crossfadeState) return; // canceled mid-fade
    const p=Math.min(1, (performance.now()-startedAt)/durationMs);
    audioEl.volume=startVolume*(1-p);
    fe.volume=targetVolume*p;
    if(p<1) crossfadeState.rafHandle=requestAnimationFrame(tick);
  }
  tick();
}

// Cancels any in-flight crossfade, restoring the primary element's
// volume to where it should actually be. Called before any manual
// track change (playTrack/nextTrack/prevTrack) and before volume/
// mute changes (applyVolume), so a fade never ends up fighting with
// something else it doesn't know about. Safe to call when no
// crossfade is running (a plain no-op) — every one of those call
// sites calls this unconditionally rather than checking first.
function cancelCrossfade(){
  if(!crossfadeState) return;
  if(crossfadeState.rafHandle) cancelAnimationFrame(crossfadeState.rafHandle);
  if(fadeAudioEl){ fadeAudioEl.pause(); fadeAudioEl.src=""; }
  crossfadeState=null;
  audioEl.volume = state.muted?0:state.volume;
}

// Called from the "ended" listener instead of nextTrack(true) when a
// crossfade is already in flight for this transition — hands
// playback over to the track that's already been playing quietly on
// fadeAudioEl for the past few seconds, carrying its position across
// instead of restarting from 0 on the primary element.
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
  setNavSwipeDir("next"); // gapless handoff is still a forward advance — swipe the same way a manual Next would
  updateNowPlayingUI();
  closeLyrics();
  resetPlayProgress(nextTrackObj.id); // same MIN_PLAY_SECONDS countdown as a normal track start — see PLAY PROGRESS above
  refreshPlayingHighlight(); // see loadAndPlay — a full renderTab() here would rebuild the whole visible list on every crossfade too
}

export { crossfadeState, fadeAudioEl, maybeStartCrossfade, startCrossfade, cancelCrossfade, completeCrossfadeHandoff, getFadeAudioEl };
