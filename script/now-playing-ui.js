import { state, $, audioEl } from "./state.js";
import { tr } from "./i18n.js";
import { el, replayMotion, fallbackArt } from "./utils.js";
import { peekNextEntry, peekPrevEntry } from "./queue.js";
import { getTrackArtURL } from "./init.js";
import { navSwipeDir, setNavSwipeDir, nextTrack } from "./player.js";
import { isInFavorites } from "./playlists.js";

function cycleRepeatMode(){
  if(state.repeat==="off") state.repeat="all";
  else if(state.repeat==="all") state.repeat="one";
  else state.repeat="off";

  const btn=$("repeatBtn");
  btn.classList.toggle("active", state.repeat!=="off");
  btn.title = state.repeat==="one" ? tr("player.repeatOne") : state.repeat==="all" ? tr("player.repeatAll") : tr("player.repeat");

  updateRepeatBadge();
  refreshNextPreview();
}



let carouselSlots=null;

function initCarouselSlots(){
  if(carouselSlots) return carouselSlots;
  const nodes=Array.from(document.querySelectorAll("#artCarousel .art-slot"));
  carouselSlots=nodes.map(el=>({
    el,
    img: el.querySelector(".art-slot-img"),
    ph: el.querySelector(".art-placeholder"),
    role: el.dataset.role
  }));
  return carouselSlots;
}

function slotWithRole(role){ return carouselSlots.find(s=>s.role===role); }

function paintCarouselSlot(slot, entry, hideWhenEmpty){
  const track=entry && entry.track;
  if(!track){
    slot.el.classList.toggle("art-slot-empty", !!hideWhenEmpty);
    slot.img.classList.add("hidden");
    slot.img.removeAttribute("src");
    slot.ph.classList.remove("hidden");
    return;
  }
  slot.el.classList.remove("art-slot-empty");
  const artURL=getTrackArtURL(track);
  if(artURL){
    slot.img.src=artURL;
    slot.img.classList.remove("hidden");
    slot.ph.classList.add("hidden");
  } else {
    slot.img.classList.add("hidden");
    slot.img.removeAttribute("src");
    slot.ph.classList.remove("hidden");
  }
}

function recycleSlotInstant(slot, role, entry){
  slot.el.classList.add("art-slot-instant");
  slot.role=role;
  slot.el.dataset.role=role;
  paintCarouselSlot(slot, entry, true);
  void slot.el.offsetWidth;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ slot.el.classList.remove("art-slot-instant"); });
  });
}

function syncCarouselStatic(){
  initCarouselSlots();
  const current=slotWithRole("current") || carouselSlots[0];
  const others=carouselSlots.filter(s=>s!==current);
  const prev=others[0], next=others[1];

  const currentEntry=state.currentTrack ? {track:state.currentTrack} : null;
  const prevEntry=peekPrevEntry();
  const nextEntry=peekNextEntry();

  [current,prev,next].forEach(s=>s.el.classList.add("art-slot-instant"));
  current.role="current"; current.el.dataset.role="current";
  prev.role="prev";       prev.el.dataset.role="prev";
  next.role="next";       next.el.dataset.role="next";
  paintCarouselSlot(current, currentEntry, false);
  paintCarouselSlot(prev, prevEntry, true);
  paintCarouselSlot(next, nextEntry, true);
  void current.el.offsetWidth;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ [current,prev,next].forEach(s=>s.el.classList.remove("art-slot-instant")); });
  });
}

function refreshNextPreview(){
  initCarouselSlots();
  const prev=slotWithRole("prev"), next=slotWithRole("next");
  [prev,next].forEach(s=>{
    if(!s) return;
    s.el.classList.add("art-slot-instant");
  });
  if(prev) paintCarouselSlot(prev, peekPrevEntry(), true);
  if(next) paintCarouselSlot(next, peekNextEntry(), true);
  if(prev) void prev.el.offsetWidth;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ [prev,next].forEach(s=>{ if(s) s.el.classList.remove("art-slot-instant"); }); });
  });
}

function rotateCarousel(dir){
  initCarouselSlots();
  if(!slotWithRole("current")){ syncCarouselStatic(); return; }

  if(dir==="next"){
    const oldPrev=slotWithRole("prev"), oldCurrent=slotWithRole("current"), oldNext=slotWithRole("next");
    oldCurrent.role="prev"; oldCurrent.el.dataset.role="prev";
    oldNext.role="current"; oldNext.el.dataset.role="current";
    recycleSlotInstant(oldPrev, "next", peekNextEntry());
  } else {
    const oldPrev=slotWithRole("prev"), oldCurrent=slotWithRole("current"), oldNext=slotWithRole("next");
    oldCurrent.role="next"; oldCurrent.el.dataset.role="next";
    oldPrev.role="current"; oldPrev.el.dataset.role="current";
    recycleSlotInstant(oldNext, "prev", peekPrevEntry());
  }
}



function updateNowPlayingUI(){
  const t=state.currentTrack;
  if(!t) return;
  $("trackTitle").textContent=t.title;
  $("trackArtist").textContent=t.artist;
  $("trackAlbum").textContent=t.album;
  $("miniTitle").textContent=t.title;
  $("miniArtist").textContent=t.artist;

  const dir=navSwipeDir;
  setNavSwipeDir(null);

  const artURL=getTrackArtURL(t);
  $("miniArt").src = artURL || fallbackArt();

  if(dir==="next" || dir==="prev"){
    rotateCarousel(dir);
  } else {
    syncCarouselStatic();
    replayMotion($("artWrap"),"track-change",360);
  }

  updateLoveButton();
  $("miniBar").classList.toggle("has-track", !!state.currentTrack);
  replayMotion(document.querySelector(".track-meta"),"track-change",300);
  replayMotion($("miniBar"),"track-change",260);
}



function updateLoveButton(){
  const active = state.currentTrack && isInFavorites(state.currentTrack);
  $("loveBtn").classList.toggle("active",!!active);
}



function edgeLen(a,b){ return Math.hypot(b[0]-a[0], b[1]-a[1]); }

function roundedQuad(pts, r){
  const n=pts.length;
  const inPts=[], outPts=[];
  for(let i=0;i<n;i++){
    const prev=pts[(i-1+n)%n], curr=pts[i], next=pts[(i+1)%n];
    const lenPrev=edgeLen(prev,curr), lenNext=edgeLen(curr,next);
    const rIn = lenPrev<1e-6 ? 0 : Math.min(r, lenPrev/2);
    const rOut = lenNext<1e-6 ? 0 : Math.min(r, lenNext/2);
    const dirPrev = lenPrev<1e-6 ? [0,0] : [(curr[0]-prev[0])/lenPrev, (curr[1]-prev[1])/lenPrev];
    const dirNext = lenNext<1e-6 ? [0,0] : [(next[0]-curr[0])/lenNext, (next[1]-curr[1])/lenNext];
    inPts.push([curr[0]-dirPrev[0]*rIn, curr[1]-dirPrev[1]*rIn]);
    outPts.push([curr[0]+dirNext[0]*rOut, curr[1]+dirNext[1]*rOut]);
  }
  const f=v=>Math.round(v*100)/100;
  let d=`M${f(inPts[0][0])},${f(inPts[0][1])} `;
  for(let i=0;i<n;i++){
    d+=`Q${f(pts[i][0])},${f(pts[i][1])} ${f(outPts[i][0])},${f(outPts[i][1])} `;
    if(i<n-1){ const nxt=inPts[i+1]; d+=`L${f(nxt[0])},${f(nxt[1])} `; }
  }
  return d+'Z';
}

function buildD(quadA, quadB, r){ return roundedQuad(quadA,r)+' '+roundedQuad(quadB,r); }

function scaleD(d, k){
  return d.replace(/-?\d+(\.\d+)?/g, m => (parseFloat(m)*k).toFixed(4));
}

const PLAY_GLYPH_R = 6;

const pauseGlyphD = buildD(
  [[30,24],[30,76],[42,76],[42,24]],
  [[58,24],[58,76],[70,76],[70,24]],
  PLAY_GLYPH_R
);

const playGlyphD = buildD(
  [[30,24],[30,76],[76,50],[76,50]],
  [[76,50],[76,50],[76,50],[76,50]],
  PLAY_GLYPH_R
);

function setPlayGlyph(d){
  $("glassClipPath").setAttribute("d", scaleD(d, 0.01));
  $("rimGlow").setAttribute("d", d);
  $("rimCrisp").setAttribute("d", d);
}

setPlayGlyph(playGlyphD);



function updatePlayIcons(){
  const playing = !audioEl.paused && !audioEl.ended;

  setPlayGlyph(playing ? pauseGlyphD : playGlyphD);

  const playBtn=$("playBtn");
  playBtn.setAttribute("aria-pressed", String(playing));
  playBtn.setAttribute("aria-label", playing ? tr("player.pause") : tr("player.play"));

  const glassWrap=$("glassWrap");
  glassWrap.classList.remove("is-morphing");
  void glassWrap.offsetWidth;
  glassWrap.classList.add("is-morphing");

  $("miniPlayIcon").innerHTML = playing
    ? "<rect x='6' y='4' width='4' height='16'/><rect x='14' y='4' width='4' height='16'/>"
    : "<polygon points='6 3 20 12 6 21'/>";
}



function updateRepeatBadge(){
  const badge=$("repeatBadge");
  if(state.repeat==="all"){ badge.textContent="A"; badge.classList.add("show"); }
  else if(state.repeat==="one"){ badge.textContent="1"; badge.classList.add("show"); }
  else { badge.textContent=""; badge.classList.remove("show"); }
  if(badge.classList.contains("show")) replayMotion(badge,"badge-pop",380);
}

export {
  cycleRepeatMode, refreshNextPreview, updateNowPlayingUI, updateLoveButton,
  updatePlayIcons, updateRepeatBadge
};
