
(function(){
"use strict";

const LINE_SELECTOR = "#playerPanel .track-meta .t-title, #playerPanel .track-meta .t-artist, #playerPanel .track-meta .t-album";

const START_PAUSE_MS = 900;
const END_PAUSE_MS   = 900;
const SCROLL_SPEED   = 34;
const MIN_SCROLL_MS  = 2200;

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const lines = new Map();

const textObserver = new MutationObserver(handleTextMutations);

function init(){
  const els = document.querySelectorAll(LINE_SELECTOR);
  if(!els.length) return;

  els.forEach(el=>{
    el.classList.add("marquee-line");
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
    if(text === entry.lastText) return;
    rebuildWrapper(el, text);
    measure(el);
  });
}

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

  if(entry.anim){ entry.anim.cancel(); entry.anim = null; }
  entry.inner.style.transform = "translateX(0)";

  const overflow = Math.ceil(el.scrollWidth - el.clientWidth);

  if(overflow > 1 && el.clientWidth > 0 && !reduceMotionQuery.matches){
    el.classList.add("marquee-active");
    playScroll(entry, overflow);
  } else {
    el.classList.remove("marquee-active");
  }
}

function playScroll(entry, distance){
  const travel = Math.max(MIN_SCROLL_MS, (distance / SCROLL_SPEED) * 1000);
  const total = START_PAUSE_MS + travel + END_PAUSE_MS + travel;
  const o1 = START_PAUSE_MS / total;
  const o2 = (START_PAUSE_MS + travel) / total;
  const o3 = (START_PAUSE_MS + travel + END_PAUSE_MS) / total;

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
