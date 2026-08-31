import { $ } from "./state.js";

/* ================================================================
   FORMAT HELPERS
   Small pure functions that turn raw numbers into display strings.
   ================================================================ */

// Formats seconds as "m:ss", e.g. 65 -> "1:05".
function fmtTime(sec){
  if(!isFinite(sec)||sec<0) sec=0;
  const m=Math.floor(sec/60), s=Math.floor(sec%60);
  return m+":"+String(s).padStart(2,"0");
}



// Formats a byte count as a human-readable size, e.g. 4200000 ->
// "4.0 MB". Used by the new Info modal to show a track's file size.
function formatBytes(bytes){
  if(bytes===null || bytes===undefined) return "Unknown";
  if(bytes<1024) return bytes+" B";
  const units=["KB","MB","GB"];
  let val=bytes, i=-1;
  do{ val/=1024; i++; }while(val>=1024 && i<units.length-1);
  return val.toFixed(1)+" "+units[i];
}



// Estimates a simple average bitrate from file size and duration,
// e.g. a 4MB file that's 2 minutes long -> "273 kb/s". This is an
// approximation (file size includes container/tag overhead), which
// is why it's labeled as an average rather than an exact figure.
function formatBitrate(bytes, seconds){
  if(!bytes || !seconds || !isFinite(seconds) || seconds<=0) return "Unknown";
  const kbps=Math.round((bytes*8)/seconds/1000);
  return kbps+" kb/s";
}



/* ================================================================
   RENDER
   Everything involved in drawing the sidebar's list area. renderTab()
   is the single entry point — it looks at state.currentTab (or
   state.filter, if the user has drilled into an album/artist/
   playlist/folder) and delegates to the right render* function.
   ================================================================ */

// Tiny helper for building a DOM element with a class and
// (optionally) some inner HTML in one line, used everywhere below
// instead of the more verbose createElement/className/innerHTML
// dance.
function el(tag,cls,html){ const e=document.createElement(tag); if(cls)e.className=cls; if(html!==undefined)e.innerHTML=html; return e; }

// Replays a composited enter animation without changing an element's
// resting appearance. Kept separate from the Play/Pause morph on purpose.
function replayMotion(element,className="motion-in",duration=320){
  if(!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove(className);
  requestAnimationFrame(()=>{
    element.classList.add(className);
    setTimeout(()=>element.classList.remove(className),duration);
  });
}

// Shared tactile "press" feedback for the transport row (shuffle/
// prev/next/repeat, desktop + mini-player) — a soft accent ripple
// behind the icon, plus an optional per-button flourish class on the
// icon itself (e.g. "skip-kick", "shuffle-spin"). Deliberately never
// called on #playBtn, which keeps its own liquid-glass morph as-is.
// Shared tactile "press" feedback for the transport row (shuffle/
// prev/next/repeat, desktop + mini-player) — a ripple behind the
// icon (circular by default, or "ctrl-streak" for a directional
// glow that shoots toward the skip direction on Prev/Next), plus an
// optional per-button flourish class on the icon itself (e.g.
// "skip-kick", "shuffle-spin", "repeat-flip"). Deliberately never
// called on #playBtn, which keeps its own liquid-glass morph as-is.
function pulseCtrlBtn(btnId,svgClass,svgDuration=420,pingClass="ctrl-ping"){
  const btn=$(btnId);
  if(!btn) return;
  replayMotion(btn,pingClass,480);
  if(!svgClass) return;
  const icon=btn.querySelector("svg");
  if(icon) replayMotion(icon,svgClass,svgDuration);
}

function showWithMotion(element){
  element.classList.remove("hidden","motion-out");
  replayMotion(element);
}

function hideWithMotion(element,duration=180){
  if(element.classList.contains("hidden")) return;
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){
    element.classList.add("hidden");
    return;
  }
  element.classList.remove("motion-in");
  element.classList.add("motion-out");
  setTimeout(()=>{
    if(element.classList.contains("motion-out")) element.classList.add("hidden");
  },duration);
}

// Wraps fn so rapid repeated calls (e.g. every keystroke) only run it
// once, ms after the last call — used to keep fast typing from
// triggering a full list rebuild on every single character.
function debounce(fn,ms){
  let handle=null;
  return (...args)=>{
    clearTimeout(handle);
    handle=setTimeout(()=>fn(...args),ms);
  };
}
// Escapes user-provided text (titles, artist names, etc.) before
// it's inserted as innerHTML, so a song literally titled e.g.
// "<b>hi</b>" can't inject markup into the page.
function escapeHTML(s){ const d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }

// A generic placeholder cover-art image (a simple circle icon),
// shown whenever a track/album/artist has no real artwork.
function fallbackArt(){
  return "data:image/svg+xml;utf8,"+encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='#1c1c25'/><circle cx='50' cy='50' r='18' fill='none' stroke='#5c5c66' stroke-width='2'/></svg>"
  );
}

export { fmtTime, formatBytes, formatBitrate, el, replayMotion, pulseCtrlBtn, showWithMotion, hideWithMotion, debounce, escapeHTML, fallbackArt };
