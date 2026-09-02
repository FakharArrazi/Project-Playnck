import { state, $, audioEl, idbPut, uid } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, fallbackArt } from "./utils.js";
import { openModal } from "./modal.js";
import { getTrackArtURL } from "./init.js";
import { playTrack } from "./player.js";

/* ================================================================
   HISTORY
   A read-only log of what's actually been listened to, reachable
   from the "☰" side menu (menuHistoryBtn) alongside Info/Edit/Sync
   Lyrics/Sleep Timer. Deliberately separate from playCount/
   lastPlayedAt (see recordPlay() in player.js), which Home's
   "Recently Played"/"Top Songs" sections use: those keep just one
   running total/last-played moment per track, while this keeps
   every individual listen as its own dated entry, using a much
   shorter 5-second bar to count as "played" than that mechanism's
   30 seconds — see HISTORY PROGRESS below.

   Persisted under a "playHistory" key in the same "settings"
   key/value IndexedDB store every other simple setting already
   uses (see DB LAYER in state.js) — no new object store, and
   nothing here touches the "tracks" store or any track's own
   playCount/lastPlayedAt fields.
   ================================================================ */

const HISTORY_MIN_SECONDS=5;
const HISTORY_RETENTION_DAYS=10;

// Removes any entry older than HISTORY_RETENTION_DAYS from
// state.playHistory (and persists the trim, if it actually removed
// anything) — called on every app start (see init.js) and again
// every time the History view is opened, per "cleanup should happen
// when the application starts and/or whenever history is accessed".
// Also run after every new entry is recorded below, so a long-running
// session can't quietly accumulate entries past the retention window
// in between restarts/menu opens.
function pruneHistoryEntries(){
  const cutoff=Date.now()-HISTORY_RETENTION_DAYS*24*60*60*1000;
  const before=state.playHistory.length;
  state.playHistory=state.playHistory.filter(entry=>entry.playedAt>=cutoff);
  if(state.playHistory.length!==before) persistHistory();
}

function persistHistory(){
  idbPut("settings",{key:"playHistory", value:state.playHistory}).catch(()=>{});
}

/* ================================================================
   HISTORY PROGRESS
   Records a track once it's actually been playing for more than
   HISTORY_MIN_SECONDS — mirrors PLAY PROGRESS in player.js exactly
   (wall-clock time accrued between "timeupdate" ticks while
   actively playing, reset whenever a new track is loaded, capped
   per-tick so a backgrounded/throttled tab can't fake progress) but
   as its own independent tracker with its own 5-second bar, so
   nothing here changes when or whether the existing 30-second
   playCount/"Recently Played" mechanism fires.

   Using wall-clock deltas rather than audioEl.currentTime means a
   seek can't be used to fast-forward the countdown, exactly as for
   the existing mechanism.

   resetHistoryProgress() is called from player.js's own
   resetPlayProgress() — the single existing place a new play
   session already begins (loadAndPlay() and the gapless crossfade
   handoff in crossfade.js both call it) — so both trackers always
   agree on when a session starts, including the existing quirk
   that a repeat-one restart (which re-seeks to 0 without calling
   loadAndPlay/resetPlayProgress) doesn't count as a new session for
   either one.
   ================================================================ */
let historyProgress=null; // {trackId, accumMs, lastTs, registered}

function resetHistoryProgress(trackId){
  historyProgress={trackId, accumMs:0, lastTs:null, registered:false};
}

function trackHistoryProgress(){
  const track=state.currentTrack;
  if(!track || !historyProgress || historyProgress.trackId!==track.id) return;
  if(historyProgress.registered || audioEl.paused) return;

  const now=performance.now();
  if(historyProgress.lastTs!=null){
    const delta=Math.min(2000, now-historyProgress.lastTs); // cap: only count plausible real elapsed time between ticks
    if(delta>0) historyProgress.accumMs+=delta;
  }
  historyProgress.lastTs=now;

  if(historyProgress.accumMs>=HISTORY_MIN_SECONDS*1000){
    historyProgress.registered=true; // never record twice for the same play session
    recordHistoryEntry(track);
  }
}

audioEl.addEventListener("timeupdate",trackHistoryProgress);
audioEl.addEventListener("pause",()=>{ if(historyProgress) historyProgress.lastTs=null; });

// Adds one entry to the front of state.playHistory (newest first)
// and persists it. Snapshots title/artist/album onto the entry
// itself — rather than just a trackId to look up later — so the
// entry still displays correctly even if the track is later retagged
// or removed from the library entirely; artwork, which is too heavy
// to duplicate per play, is instead resolved live at render time
// from the track if it's still around (see historyRowHTML below).
function recordHistoryEntry(track){
  state.playHistory.unshift({
    id:uid(),
    trackId:track.id,
    title:track.title,
    artist:track.artist,
    album:track.album,
    playedAt:Date.now()
  });
  pruneHistoryEntries();
  persistHistory();
}

/* ================================================================
   HISTORY VIEW
   Rows are clickable: clicking one plays that entry's track through
   the exact same playTrack() path every other song row in the app
   uses (see PLAYBACK in player.js), with a single-track queue of
   just that track — the same [track] queue bindings.js's "Open
   With" handler and drag-drop.js use for a standalone play with no
   broader list context, since a History row isn't part of any
   browsable list/queue either. See bindHistoryRowClicks() below.
   ================================================================ */

// "Today"/"Yesterday" for the last two calendar days (in the
// viewer's local time), then a plain "Month Day" (or "Month Day,
// Year" if it lands in an earlier year than today — the only way
// that can happen inside a 10-day retention window is a play just
// before a Dec 31 → Jan 1 rollover).
function dayLabelFor(ts){
  const d=new Date(ts), now=new Date();
  const startOfDay=(dt)=>new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()).getTime();
  const diffDays=Math.round((startOfDay(now)-startOfDay(d))/86400000);
  if(diffDays===0) return tr("history.today");
  if(diffDays===1) return tr("history.yesterday");
  const opts=(d.getFullYear()===now.getFullYear()) ? {month:"long",day:"numeric"} : {month:"long",day:"numeric",year:"numeric"};
  return d.toLocaleDateString(undefined,opts);
}

// Splits already newest-first entries into [{label,entries}]
// day-buckets, in the same order they were given.
function groupHistoryByDay(sortedEntries){
  const groups=[];
  let lastLabel=null, currentGroup=null;
  sortedEntries.forEach(entry=>{
    const label=dayLabelFor(entry.playedAt);
    if(label!==lastLabel){
      currentGroup={label, entries:[]};
      groups.push(currentGroup);
      lastLabel=label;
    }
    currentGroup.entries.push(entry);
  });
  return groups;
}

// One history row: artwork (resolved live off the original track if
// it's still in the library, otherwise the generic placeholder),
// title/artist/album exactly as they were when this was played, and
// the time played. Carries data-track-id so bindHistoryRowClicks()
// below can find it and know which track to play — nothing else
// about layout/styling changes based on that.
function historyRowHTML(entry){
  const track=state.tracks.find(t=>t.id===entry.trackId);
  const artURL=(track && getTrackArtURL(track)) || fallbackArt();
  const sub=entry.album ? `${entry.artist} • ${entry.album}` : entry.artist;
  const time=new Date(entry.playedAt).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  return `<div class="history-row" data-track-id="${escapeHTML(entry.trackId)}">
    <img class="thumb" src="${artURL}" loading="lazy" decoding="async" alt="">
    <div class="info">
      <div class="title">${escapeHTML(entry.title)}</div>
      <div class="sub">${escapeHTML(sub)}</div>
    </div>
    <span class="history-time">${escapeHTML(time)}</span>
  </div>`;
}

// Wires up every rendered history row's click, once, right after
// openHistoryModal() below fills #modalBody with the HTML from
// historyRowHTML() above. Looks the clicked row's trackId back up in
// state.tracks and plays it via the same playTrack() used everywhere
// else; a track that's since been removed from the library has
// nothing to play, so that row is silently ignored.
function bindHistoryRowClicks(){
  $("modalBody").querySelectorAll(".history-row[data-track-id]").forEach(row=>{
    row.addEventListener("click",()=>{
      const track=state.tracks.find(t=>t.id===row.dataset.trackId);
      if(track) playTrack(track,[track]);
    });
  });
}

// Opens the shared modal with everything played in the last
// HISTORY_RETENTION_DAYS days, most recent first, grouped by day.
function openHistoryModal(){
  pruneHistoryEntries(); // "whenever history is accessed" — see pruneHistoryEntries() above

  if(!state.playHistory.length){
    openModal(tr("history.title"), `<p class="info-empty">${escapeHTML(tr("empty.noListeningHistory"))}</p>`);
    return;
  }

  const sorted=[...state.playHistory].sort((a,b)=>b.playedAt-a.playedAt);
  const bodyHTML="<div class='history-list'>"+groupHistoryByDay(sorted).map(group=>
    `<div class="history-group">
      <div class="home-section-title">${escapeHTML(group.label)}</div>
      ${group.entries.map(historyRowHTML).join("")}
    </div>`
  ).join("")+"</div>";

  openModal(tr("history.title"), bodyHTML);
  bindHistoryRowClicks();
}

export { openHistoryModal, resetHistoryProgress, pruneHistoryEntries };
