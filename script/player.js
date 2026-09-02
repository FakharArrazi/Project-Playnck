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

/* ================================================================
   PLAYBACK
   Everything that actually drives the <audio> element: starting a
   track, play/pause, and moving to the next/previous track
   (respecting shuffle and repeat mode).
   ================================================================ */

// Starts playing "track", and remembers the full list it came from
// as the queue (so next/prev/shuffle know what else is playable).
function playTrack(track, queueTracks){
  cancelCrossfade(); // a fresh explicit track pick always wins over any in-flight gapless fade — see GAPLESS PLAYBACK below
  state.queue = queueTracks.map(t=>t.id);
  state.queueIndex = state.queue.indexOf(track.id);
  state.shuffleHistory = [];   // starting a fresh queue/context — old shuffle trail no longer applies
  loadAndPlay(track);
}



// Loads a track into the <audio> element and starts playback,
// updating every bit of "now playing" UI to match.
function loadAndPlay(track){
  ensureAudioGraph(); // lazy first-use init of the EQ/gapless Web Audio graph — see EQUALIZER below
  state.currentTrack=track;
  audioEl.src=track.fileURL;
  audioEl.play().catch(()=>{});
  updateNowPlayingUI();
  closeLyrics();
  resetPlayProgress(track.id); // starts the MIN_PLAY_SECONDS countdown fresh — see PLAY PROGRESS below
  refreshPlayingHighlight(); // just moves the highlight — a full renderTab() here would rebuild every row/image in the visible list on every track change
}



// Bumps a track's play count and last-played timestamp (used by the
// Home tab's "Recently Played" / "Top Songs" sections) and persists
// both onto the saved copy in IndexedDB, deliberately excluding the
// session-only fileURL/artURL blob: URLs the same way every other
// save-to-DB spot in this file does. Called from trackPlayProgress()
// below once a track has actually been listened to for long enough
// to count — never directly from loadAndPlay/completeCrossfadeHandoff
// anymore, so skipping a track after a second or two no longer bumps
// its count.
function recordPlay(track){
  track.playCount=(track.playCount||0)+1;
  track.lastPlayedAt=Date.now();
  // An unpersisted external track (see ingestFiles()) just plays —
  // simply listening to it isn't the explicit "add this to my
  // library" action the rest of this fix is trying to preserve, so
  // don't let hitting MIN_PLAY_SECONDS silently write it to disk.
  // playCount/lastPlayedAt still update in memory above; they just
  // never reach a view, since libraryTracks() leaves this track out
  // of Home's Recently Played/Top Songs anyway.
  if(track.external) return;
  const storeCopy={...track};
  delete storeCopy.fileURL;
  delete storeCopy.artURL;
  idbPut("tracks",storeCopy).catch(()=>{});
}

/* ================================================================
   PLAY PROGRESS
   A track only counts as "1 play" — bumping playCount and
   lastPlayedAt via recordPlay() above — once it's actually been
   listened to for MIN_PLAY_SECONDS. Progress is tracked as real
   wall-clock time accrued between consecutive "timeupdate" ticks
   while audioEl is actively playing (not paused), reset whenever a
   new track is loaded (see resetPlayProgress(), called from
   loadAndPlay() and completeCrossfadeHandoff()).

   Using wall-clock deltas rather than audioEl.currentTime means a
   seek can't be used to fast-forward the countdown — jumping around
   the track doesn't advance real time — and each tick's delta is
   capped so a big gap (backgrounded tab, throttled timers) can't
   silently count as listened time either.
   ================================================================ */

const MIN_PLAY_SECONDS=30;
let playProgress=null; // {trackId, accumMs, lastTs, registered}

function resetPlayProgress(trackId){
  playProgress={trackId, accumMs:0, lastTs:null, registered:false};
  resetHistoryProgress(trackId); // starts History's own, separate 5-second countdown for the same new play session — see HISTORY PROGRESS in history.js
}

function trackPlayProgress(){
  const track=state.currentTrack;
  if(!track || !playProgress || playProgress.trackId!==track.id) return;
  if(playProgress.registered || audioEl.paused) return;

  const now=performance.now();
  if(playProgress.lastTs!=null){
    const delta=Math.min(2000, now-playProgress.lastTs); // cap: only count plausible real elapsed time between ticks
    if(delta>0) playProgress.accumMs+=delta;
  }
  playProgress.lastTs=now;

  if(playProgress.accumMs>=MIN_PLAY_SECONDS*1000){
    playProgress.registered=true;
    recordPlay(track);
  }
}



// Play/pause button behavior: starts the first track if nothing
// has been played yet, otherwise just flips play/pause.
function togglePlay(){
  if(!state.currentTrack){
    if(state.tracks.length){ playTrack(state.tracks[0], state.tracks); }
    return;
  }
  if(audioEl.paused) audioEl.play().catch(()=>{});
  else audioEl.pause();
}



// Which way the cover art should swipe on the *next* updateNowPlayingUI()
// call — set right before an actual track change from nextTrack()/
// prevTrack()/completeCrossfadeHandoff() below, consumed (and reset)
// by updateNowPlayingUI() itself. Left null for track changes with no
// real "direction" (picking a song straight from a list, editing tags,
// etc.), which fall back to the plain track-change pop instead of a
// swipe — a swipe implies "next" or "previous", and those cases aren't.
let navSwipeDir=null;

function setNavSwipeDir(value){ navSwipeDir=value; return navSwipeDir; }

// Advances to the next track. "auto" is true when this was
// triggered by a track finishing on its own (vs. the user pressing
// the next button) — that distinction matters for repeat-one,
// which should only restart the same track on auto-advance, not
// when the user explicitly asks to skip.
function nextTrack(auto){
  cancelCrossfade(); // a manual/normal advance always wins over any in-flight gapless fade — see GAPLESS PLAYBACK below
  if(!state.queue.length) return;
  if(state.repeat==="one" && auto){ audioEl.currentTime=0; audioEl.play(); return; }
  const idx=resolveNextIndex();
  if(idx===null) return;
  if(state.shuffle && state.queue.length>1) state.shuffleHistory.push(state.queueIndex); // remember where we came from so prevTrack can retrace it
  state.queueIndex=idx;
  const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(t){ navSwipeDir="next"; loadAndPlay(t); }
}



// Goes to the previous track — or, if more than 3 seconds into the
// current one, just restarts it instead (the same behavior most
// music players use for the "previous" button).
//
// When shuffle is on, "previous" doesn't pick a new random track —
// it steps back through shuffleHistory, i.e. the actual sequence of
// tracks shuffle already played, so you retrace your steps instead
// of shuffling backwards into something new. If there's no history
// left (we're back at the start of this shuffle session), it just
// restarts the current track.
function prevTrack(){
  cancelCrossfade(); // see GAPLESS PLAYBACK below
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



// Picks playback back up after handleMissingTrack() (below) has just
// removed the track that was loaded — deliberately NOT the same as a
// normal nextTrack() call. nextTrack() assumes the currently-loaded
// track is still sitting in the queue and steps forward from it
// (queueIndex+1); that assumption is already broken here, since the
// track at queueIndex was just spliced out. removeTrackData() (called
// for every track this removes, including indirectly via
// pruneFolder()) keeps state.queueIndex correctly aligned as tracks
// disappear out from under it — see its own comment — so by the time
// this runs, queueIndex already points at exactly the track that
// should play next; using nextTrack()'s +1 on top of that would skip
// over it. Shuffle mode is the one case that's fine to hand off to
// nextTrack() as-is: its random-pick branch only needs *a* valid
// current index to avoid re-picking it and to push onto
// shuffleHistory, which queueIndex still is.
function resumeAfterRemoval(){
  if(!state.queue.length) return;

  if(state.shuffle){ nextTrack(false); return; }

  if(state.queueIndex>=state.queue.length){
    if(state.repeat==="all") state.queueIndex=0;
    else return; // ran off the end of the queue — same as nextTrack() does normally
  }
  const t=state.tracks.find(tt=>tt.id===state.queue[state.queueIndex]);
  if(t) loadAndPlay(t);
}



// Handles a track failing to actually load into <audio> — see the
// "error" listener on audioEl further down in the PROGRESS section.
// The usual cause on a path-backed track: the real file behind it was
// moved, renamed, or deleted outside the app since it was added, so
// the playnck-file:// protocol handler in main.js 404s and the
// browser reports that here as a bare "error" event with no further
// detail. Before touching the library this re-confirms with the main
// process that the file (and, if known, its containing folder) is
// really gone — the same check verifyLibraryOnDisk() uses on its
// periodic sweep — so a transient/codec-related failure that isn't
// actually about a missing file never causes a false cleanup.
//   - If the track's whole containing folder is gone too (moved or
//     deleted as a unit), the entire folder is pruned with it — same
//     as verifyLibraryOnDisk() (see pruneFolder() above).
//   - Otherwise just this one track is removed (removeTrackData(),
//     same as everywhere else in the app).
// Either way, playback then picks back up via resumeAfterRemoval()
// above rather than being left stuck on a dead track — this is what
// turns "clicked play, nothing happens" into "clicked play, it just
// starts the next song". Electron only; a no-op wherever
// window.electronAPI.checkPathsExist isn't available (plain web,
// where a track's bytes live in memory and can't go stale this way).
async function handleMissingTrack(track){
  if(!window.electronAPI || !window.electronAPI.checkPathsExist) return;

  const folder=state.folders.find(f=>f.id===track.folderId);
  const checkPaths=[track.filePath];
  if(folder && folder.path) checkPaths.push(folder.path);

  let existence={};
  try{ existence=await window.electronAPI.checkPathsExist(checkPaths); }
  catch(e){ console.warn("handleMissingTrack: checkPathsExist failed",e); return; }

  // Not actually missing — false alarm (some other playback error).
  // Leave the library alone.
  if(existence[track.filePath]!==false) return;

  if(folder && folder.path && existence[folder.path]===false){
    pruneFolder(folder);
  } else {
    removeTrackData(track);
  }

  renderTab();
  resumeAfterRemoval();
}
/* ================================================================
   PROGRESS
   Keeps the seek bar and time labels in sync with actual playback,
   and lets the user drag the seek bar to jump to a new position.
   ================================================================ */
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

// PLAY PROGRESS (see the function definitions above, near recordPlay):
// accrue real listening time on every tick while playing, and break
// the delta chain on pause so the paused duration is never counted
// as listened time once playback resumes.
audioEl.addEventListener("timeupdate",trackPlayProgress);
audioEl.addEventListener("pause",()=>{ if(playProgress) playProgress.lastTs=null; });
// A track shorter than MIN_PLAY_SECONDS can never accrue enough
// listening time to cross the threshold via trackPlayProgress() alone —
// if it played all the way through, that's unambiguously a play, so
// credit it here instead. Registered BEFORE the "ended" listener below
// that advances to the next track — that listener can synchronously
// reset playProgress for the next track, so checking after it fired
// would mean reading the wrong track's state.
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

// If a crossfade is already in flight when the primary track hits
// its natural end, hand off to the track that's already been fading
// in on fadeAudioEl instead of restarting it from 0 the normal way —
// see GAPLESS PLAYBACK above.
audioEl.addEventListener("ended",()=>{ if(crossfadeState) completeCrossfadeHandoff(); else nextTrack(true); });
// Gapless Playback: check on every tick whether it's time to start
// fading into the next track (see maybeStartCrossfade above), and
// keep the hidden fade partner in sync with manual pause/resume —
// otherwise a track paused mid-crossfade would keep quietly playing
// the *next* song in the background.
audioEl.addEventListener("timeupdate",maybeStartCrossfade);
audioEl.addEventListener("pause",()=>{ if(fadeAudioEl && crossfadeState) fadeAudioEl.pause(); });
audioEl.addEventListener("play",()=>{ if(fadeAudioEl && crossfadeState && fadeAudioEl.paused) fadeAudioEl.play().catch(()=>{}); });

// A track's <audio> src can fail to load if the real file behind it
// was moved, renamed, or deleted outside the app since it was added —
// see handleMissingTrack() up in the PLAYBACK section for what
// happens next. Path-backed tracks only: a blob:-backed track (plain
// web build, or a File that couldn't resolve to a real path) has its
// bytes already in memory and can't fail to load this way, so this
// is a no-op for those.
audioEl.addEventListener("error",()=>{
  const t=state.currentTrack;
  if(!t || !t.filePath) return;
  handleMissingTrack(t);
});

$("seek").addEventListener("input",(e)=>{
  const dur=audioEl.duration||0;
  audioEl.currentTime=(e.target.value/1000)*dur;
});

// Left/Right arrow keys (no Ctrl held) — see the keyboard shortcuts
// in bindEvents. Jumps the current track backward/forward by
// `seconds`, clamped so it can't go negative or past the end.
function seekBy(seconds){
  if(!state.currentTrack) return;
  const dur=audioEl.duration||state.currentTrack.duration||0;
  audioEl.currentTime=Math.min(Math.max(0,audioEl.currentTime+seconds), dur||Infinity);
}

export {
  playTrack, resetPlayProgress, togglePlay, navSwipeDir, setNavSwipeDir,
  nextTrack, prevTrack, seekBy
};
