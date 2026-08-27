// ================================================================
// player-marquee.js — PLAYER PANEL now-playing text marquee
// ----------------------------------------------------------------
// script.js is kept untouched on purpose (same reasoning as
// renderer-bridge.js): this reaches in from the outside instead of
// editing script.js's internals.
//
// What this does, and ONLY this:
//   In the Player Panel's now-playing block (#trackTitle,
//   #trackArtist, #trackAlbum), whenever one of those lines is too
//   long to fit on one line, it smoothly slides left to reveal the
//   rest, pauses, slides back to the start, pauses, and repeats —
//   forever, on one line, with the full text always readable and
//   never permanently cut off. Text that already fits is left
//   completely alone: static, centered, exactly like before.
//
// Deliberately NOT touched: the song list, sidebar, search results,
// playlists, library views, the mobile mini-player, or anything
// else — this only ever looks at .t-title/.t-artist/.t-album
// *inside* #playerPanel.
//
// How it stays in sync with script.js without any changes there:
// script.js just does `el.textContent = "..."` on trackTitle/
// trackArtist/trackAlbum whenever the song changes (see
// updateNowPlayingUI() / applyNowPlayingPlaceholder()). A
// MutationObserver on those three elements catches that the same
// way renderer-bridge.js already does for the OS media-key
// metadata, so this file re-measures every time their text
// actually changes. A ResizeObserver on #playerPanel (plus a
// window "resize" fallback) re-measures whenever the panel's width
// changes, so a window resize or the sidebar collapsing is picked
// up too. If the new text fits, the animation stops immediately
// and the line goes back to plain static (centered) text.
//
// Include this via <script src="player-marquee.js"></script>
// anywhere after script.js in index.html.
// ================================================================

(function(){
"use strict";

const LINE_SELECTOR = "#playerPanel .track-meta .t-title, #playerPanel .track-meta .t-artist, #playerPanel .track-meta .t-album";

const START_PAUSE_MS = 900;   // hold fully at the start before scrolling out
const END_PAUSE_MS   = 900;   // hold fully scrolled before coming back
const SCROLL_SPEED   = 34;    // px/second — one shared speed, so long and short overflows feel consistent
const MIN_SCROLL_MS  = 2200;  // floor so a barely-overflowing line doesn't dart back and forth too fast

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// el -> { inner, anim, lastText }
const lines = new Map();

// One shared observer for all three lines. It's disconnected and
// immediately re-attached around the one DOM change this file ever
// makes itself (rebuildWrapper, below), so it only ever fires for
// text changes that genuinely came from script.js — never an echo
// of its own wrapping — no feedback loop, no extra churn.
const textObserver = new MutationObserver(handleTextMutations);

function init(){
  const els = document.querySelectorAll(LINE_SELECTOR);
  if(!els.length) return; // this build/screen doesn't have a Player Panel

  els.forEach(el=>{
    el.classList.add("marquee-line"); // permanent: this is what stops it from ever wrapping to a 2nd line
    lines.set(el, { inner:null, anim:null, lastText:null });
    rebuildWrapper(el, el.textContent);
  });
  observeAll();
  refreshAll();

  const panel = document.getElementById("playerPanel");
  if(window.ResizeObserver && panel){
    new ResizeObserver(scheduleRefresh).observe(panel);
  }
  window.addEventListener("resize", scheduleRefresh);
  if(reduceMotionQuery.addEventListener) reduceMotionQuery.addEventListener("change", refreshAll);
}

function observeAll(){
  lines.forEach((_entry, el)=>{
    textObserver.observe(el, { childList:true, characterData:true, subtree:true });
  });
}

function handleTextMutations(mutationList){
  const touched = new Set();
  mutationList.forEach(m=>{
    const node = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    const line = node && node.closest ? node.closest(".t-title, .t-artist, .t-album") : null;
    if(line && lines.has(line)) touched.add(line);
  });
  touched.forEach(el=>{
    const entry = lines.get(el);
    const text = el.textContent;
    if(text === entry.lastText) return; // nothing actually changed
    rebuildWrapper(el, text);
    measure(el);
  });
}

// Tears down whatever's currently inside `el` and rebuilds it as a
// single inner <span class="marquee-track"> holding `text` — the
// piece that actually gets slid back and forth. Observation is
// paused for this one synchronous step so the rebuild itself can
// never trigger handleTextMutations.
function rebuildWrapper(el, text){
  const entry = lines.get(el);
  if(entry.anim){ entry.anim.cancel(); entry.anim = null; }

  textObserver.disconnect();
  el.textContent = "";
  const inner = document.createElement("span");
  inner.className = "marquee-track";
  inner.textContent = text;
  el.appendChild(inner);
  observeAll();

  entry.inner = inner;
  entry.lastText = text;
  el.classList.remove("marquee-active");
}

let refreshQueued = false;
function scheduleRefresh(){
  if(refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(()=>{ refreshQueued = false; refreshAll(); });
}

function refreshAll(){
  lines.forEach((_entry, el)=>measure(el));
}

function measure(el){
  const entry = lines.get(el);
  if(!entry || !entry.inner) return;

  // Cancel any in-flight animation before measuring — scrollWidth
  // would be meaningless mid-translate.
  if(entry.anim){ entry.anim.cancel(); entry.anim = null; }
  entry.inner.style.transform = "translateX(0)";

  // el.scrollWidth reports the full, unclipped content width even
  // though el itself is overflow:hidden — the standard way to
  // detect "this doesn't fit" without affecting what's on screen.
  const overflow = Math.ceil(el.scrollWidth - el.clientWidth);

  if(overflow > 1 && el.clientWidth > 0 && !reduceMotionQuery.matches){
    el.classList.add("marquee-active");
    playScroll(entry, overflow);
  } else {
    el.classList.remove("marquee-active");
  }
}

// Slide left, pause, slide back, pause, repeat — timed in real
// milliseconds rather than fixed keyframe percentages, so the
// pause is always ~900ms regardless of how far a given line has to
// travel.
function playScroll(entry, distance){
  const travel = Math.max(MIN_SCROLL_MS, (distance / SCROLL_SPEED) * 1000);
  const total = START_PAUSE_MS + travel + END_PAUSE_MS + travel;
  const o1 = START_PAUSE_MS / total;               // start of the "scroll out" segment
  const o2 = (START_PAUSE_MS + travel) / total;     // fully scrolled — start of the "end pause"
  const o3 = (START_PAUSE_MS + travel + END_PAUSE_MS) / total; // start of the "scroll back" segment

  entry.anim = entry.inner.animate([
    { transform:"translateX(0)",              offset:0 },
    { transform:"translateX(0)",              offset:o1, easing:"ease-in-out" },
    { transform:`translateX(-${distance}px)`, offset:o2 },
    { transform:`translateX(-${distance}px)`, offset:o3, easing:"ease-in-out" },
    { transform:"translateX(0)",              offset:1 }
  ], { duration: total, iterations: Infinity });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
