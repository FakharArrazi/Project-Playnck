import { state, $, audioEl, idbPut, idbGet } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { openModal, closeModal } from "./modal.js";

/* ================================================================
   LYRICS
   Fetches time-synced (or plain) lyrics from the free lrclib.net
   API, caches them (in memory + IndexedDB) so we never re-fetch
   the same song twice, and highlights the current line as the
   song plays.
   ================================================================ */

// Parses the ".lrc" synced-lyrics format ("[mm:ss.xx]some words")
// into an array of {time, text} objects sorted by time.
function parseLRC(lrc){
  const lines=lrc.split("\n");
  const out=[];
  const re=/\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for(const line of lines){
    const text=line.replace(re,"").trim();
    let m; re.lastIndex=0;
    let matched=false;
    while((m=re.exec(line))){
      matched=true;
      const time=parseInt(m[1])*60+parseFloat(m[2]);
      out.push({time,text});
    }
    if(!matched && text) { /* skip metadata-only lines without timestamp */ }
  }
  return out.sort((a,b)=>a.time-b.time);
}



// Removes any "(...)" parenthetical from a title — e.g. "Song Title
// (Remastered 2011)" -> "Song Title" — used as a fallback query when
// the exact title returns no matches, since bracketed extras like
// "(Live)", "(Remastered)", "(feat. X)" etc. are often not how the
// track is actually tagged on lrclib.net.
function stripParens(title){
  return title.replace(/\([^)]*\)/g,"").replace(/\s{2,}/g," ").trim();
}

// Does a single lrclib.net search for the given title/artist. Returns
// parsed {time,text} lines (synced if available, else plain), or
// null if nothing usable came back.
async function searchLyrics(title,artist){
  const url=`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const res=await fetch(url);
  const data=await res.json();
  if(Array.isArray(data)&&data.length){
    const best=data.find(d=>d.syncedLyrics)||data[0];
    if(best.syncedLyrics) return parseLRC(best.syncedLyrics);
    if(best.plainLyrics) return best.plainLyrics.split("\n").map(t=>({time:null,text:t}));
  }
  return null;
}

// Fetches (and caches) lyrics for a track. Checks the in-memory
// cache first, then IndexedDB, and only hits the network as a
// last resort. Tries the title as-is first; if that comes back
// empty, retries once with any "(...)" part stripped out of the
// title (e.g. "(Remastered 2011)", "(Live)"), since that's often
// what's tripping up the lookup. Returns null if no lyrics could
// be found either way.
//
// IMPORTANT: only a *successful* lookup (lines truthy) gets written
// into state.lyricsCache / IndexedDB. A "not found" result is never
// cached — so it's never mistaken for "already checked, nothing
// there". That means every time the user opens the lyrics pane for
// a track that previously came back empty, this runs the search
// again instead of just replaying the old miss. If it starts
// finding lyrics online later, or the lyrics get corrected on
// lrclib.net, the next click just picks that up.
async function fetchLyricsFor(track){
  if(state.lyricsCache[track.id]) return state.lyricsCache[track.id];
  const cached=await idbGet("lyrics",track.id).catch(()=>null);
  if(cached && cached.lines){
    state.lyricsCache[track.id]=cached.lines;
    state.lyricOffsets[track.id]=cached.offsetMs||0;
    return cached.lines;
  }
  let lines=null;
  try{
    lines=await searchLyrics(track.title,track.artist);
  }catch(err){
    lines=null;
  }
  if(!lines){
    const strippedTitle=stripParens(track.title);
    if(strippedTitle && strippedTitle!==track.title){
      try{
        lines=await searchLyrics(strippedTitle,track.artist);
      }catch(err){
        lines=null;
      }
    }
  }
  if(lines){
    state.lyricsCache[track.id]=lines;
    state.lyricOffsets[track.id]=0;
    idbPut("lyrics",{trackId:track.id,lines,offsetMs:0});
  }
  return lines;
}



// Hides the lyrics overlay and un-highlights the Lyrics button.
function closeLyrics(){
  state.lyricsOpen=false;
  $("lyricsPane").classList.add("hidden");
  $("lyricsBtn").classList.remove("active");
  $("artWrap").classList.remove("lyrics-active");
}



// Toggles the lyrics overlay open/closed. When opening, shows a
// loading message, fetches the lyrics, then renders either:
//   - a single empty "current phrase" element that syncLyrics()
//     fills in and updates as the song plays (synced lyrics), or
//   - the full plain text as a fallback (no timestamps to sync to)
async function toggleLyrics(){
  if(!state.currentTrack) return;
  if(state.lyricsOpen){ closeLyrics(); return; }
  state.lyricsOpen=true;
  state.lastLyricIdx=-2;               // force syncLyrics to (re)render on first tick
  $("lyricsBtn").classList.add("active");
  $("artWrap").classList.add("lyrics-active");
  const pane=$("lyricsPane");
  pane.classList.remove("hidden");
  pane.innerHTML=`<div class='lyric-status'>${escapeHTML(tr("lyrics.loading"))}</div>`;
  const lines=await fetchLyricsFor(state.currentTrack);
  if(!state.lyricsOpen) return; // closed while loading
  if(!lines || !lines.length){
    pane.innerHTML=`<div class='lyric-status'>${escapeHTML(tr("lyrics.notFoundShort"))}</div>`;
    return;
  }
  if(lines[0].time===null){
    // No per-line timestamps came back, so there's nothing to
    // sync a single phrase to — show the whole lyric text instead.
    pane.innerHTML=`<div class="lyric-plain">${escapeHTML(lines.map(l=>l.text||"").join("\n"))}</div>`;
    return;
  }
  pane.innerHTML='<div class="lyric-current"></div>';
  syncLyrics(audioEl.currentTime);
}



// Figures out which lyric line matches the current playback time
// and, if it's changed since the last tick, swaps the single
// "now singing" phrase in place (fading/lifting it out and the
// new line back in). Does nothing for plain (un-timed) lyrics,
// since there's nothing to sync to.
function syncLyrics(cur){
  const trackId=state.currentTrack&&state.currentTrack.id;
  const lines=state.lyricsCache[trackId];
  if(!lines || !lines.length || lines[0].time===null) return;
  // Manual per-track nudge from the Sync Lyrics modal, in ms:
  // positive delays the lyrics (shows each line later), negative
  // shows them earlier. Subtracting it from "cur" before matching
  // is what achieves that — a bigger offset means less time has
  // "effectively" passed, so earlier lines stay on screen longer.
  const offsetSec=(state.lyricOffsets[trackId]||0)/1000;
  const adjustedCur=cur-offsetSec;
  let activeIdx=-1;
  for(let i=0;i<lines.length;i++){ if(lines[i].time<=adjustedCur) activeIdx=i; else break; }
  if(activeIdx===state.lastLyricIdx) return; // same line as before, nothing to update
  state.lastLyricIdx=activeIdx;

  const curEl=$("lyricsPane").querySelector(".lyric-current");
  if(!curEl) return;
  const text=activeIdx>=0 ? (lines[activeIdx].text || "♪") : "";
  curEl.classList.add("swap");
  setTimeout(()=>{
    curEl.textContent=text;
    // Force a reflow so removing "swap" immediately after actually
    // re-triggers the CSS transition instead of being batched away.
    void curEl.offsetWidth;
    curEl.classList.remove("swap");
  },160);
}



// Builds the "Sync Lyrics" modal: lets the user nudge a track's
// lyric timing forward or backward, in milliseconds, until the
// highlighted line lines up with what's actually being sung.
// Positive delays the lyrics (each line shows later); negative
// shows them earlier (see syncLyrics() for how the offset is
// applied). The offset is saved per-track alongside its cached
// lyrics (idbPut("lyrics", ...)), so it's remembered every time
// this song's lyrics are shown again. Pass a specific track (e.g.
// from a song row's "⋮" menu) to sync that song; called with no
// argument (e.g. from the player panel's side menu) it falls back
// to whatever's currently playing.
async function openSyncModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingSync"))}</p>`);
    return;
  }

  openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.loading"))}</p>`);
  const lines=await fetchLyricsFor(t);
  if($("modalOverlay").classList.contains("hidden")) return; // closed while loading

  if(!lines || !lines.length){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.notFound"))}</p>`);
    return;
  }
  if(lines[0].time===null){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.notTimeSynced"))}</p>`);
    return;
  }

  const bodyHTML=`
    <div class="sync-form">
      <p class="sync-hint">${escapeHTML(tr("sync.hint"))}</p>
      <div class="sync-offset-display">
        <input type="text" id="syncOffsetInput" class="sync-offset-input" inputmode="numeric" autocomplete="off" aria-label="${escapeHTML(tr("lyrics.syncOffsetAriaLabel"))}" value="0">
        <span class="sync-offset-unit">ms</span>
      </div>
      <div class="sync-nudge-row">
        <button type="button" class="sync-nudge-btn" data-delta="-500">&minus;500</button>
        <button type="button" class="sync-nudge-btn" data-delta="-100">&minus;100</button>
        <button type="button" class="sync-nudge-btn" data-delta="-10">&minus;10</button>
        <button type="button" class="sync-nudge-btn" data-delta="10">+10</button>
        <button type="button" class="sync-nudge-btn" data-delta="100">+100</button>
        <button type="button" class="sync-nudge-btn" data-delta="500">+500</button>
      </div>
      <div class="edit-actions">
        <button type="button" class="edit-cancel-btn" id="syncResetBtn">${escapeHTML(tr("sync.resetTo0"))}</button>
        <button type="button" class="edit-save-btn" id="syncDoneBtn">${escapeHTML(tr("sync.done"))}</button>
      </div>
    </div>`;
  openModal(tr("side.syncLyrics"), bodyHTML);

  let offsetMs=state.lyricOffsets[t.id]||0;
  const inputEl=$("syncOffsetInput");
  const renderOffset=()=>{ inputEl.value=(offsetMs>0?"+":"")+offsetMs; };
  renderOffset();

  // Applies the current offsetMs immediately: saves it (in memory +
  // IndexedDB) and, if this track's lyrics pane is open right now,
  // forces syncLyrics() to recompute on the very next tick so the
  // effect is visible right away instead of waiting for the line to
  // naturally change.
  function applyOffset(){
    state.lyricOffsets[t.id]=offsetMs;
    idbPut("lyrics",{trackId:t.id, lines, offsetMs});
    if(state.currentTrack && state.currentTrack.id===t.id && state.lyricsOpen){
      state.lastLyricIdx=-2;
      syncLyrics(audioEl.currentTime);
    }
  }

  $("modalBody").querySelectorAll(".sync-nudge-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      offsetMs+=parseInt(btn.dataset.delta,10);
      renderOffset();
      applyOffset();
    });
  });

  // Free-typed offset entry. Keydown blocks anything that isn't a
  // digit, a leading "-" (negative = "show lyrics earlier"), or a
  // navigation/editing key, so bad characters never even land in
  // the field. The input handler is a second line of defense for
  // anything that slips in anyway (e.g. pasting "12a3ms"): it
  // strips everything but digits/minus and collapses stray minus
  // signs down to a single leading one. The value is only parsed
  // into offsetMs (and applied/saved) once the user commits — on
  // Enter or on blur — same moment a nudge button would apply it.
  const numericKeys=new Set(["Backspace","Delete","ArrowLeft","ArrowRight","Tab","Enter","Home","End"]);
  inputEl.addEventListener("keydown",(e)=>{
    if(numericKeys.has(e.key)) return;
    if(e.key==="-"){
      if(inputEl.selectionStart===0 && !inputEl.value.includes("-")) return;
      e.preventDefault();
      return;
    }
    if(!/^[0-9]$/.test(e.key)) e.preventDefault();
  });
  inputEl.addEventListener("input",()=>{
    let v=inputEl.value.replace(/[^0-9-]/g,"");
    v=v.replace(/(?!^)-/g,"");
    inputEl.value=v;
  });
  function commitOffsetInput(){
    let n=parseInt(inputEl.value,10);
    if(isNaN(n)) n=0;
    offsetMs=n;
    renderOffset();
    applyOffset();
  }
  inputEl.addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); inputEl.blur(); } });
  inputEl.addEventListener("blur",commitOffsetInput);

  $("syncResetBtn").addEventListener("click",()=>{
    offsetMs=0;
    renderOffset();
    applyOffset();
  });

  $("syncDoneBtn").addEventListener("click",closeModal);
}

export { closeLyrics, toggleLyrics, syncLyrics, openSyncModal };
