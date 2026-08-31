import { state, $, audioEl } from "./state.js";
import { tr } from "./i18n.js";
import { el, replayMotion, fallbackArt } from "./utils.js";
import { peekNextEntry, peekPrevEntry } from "./queue.js";
import { getTrackArtURL } from "./init.js";
import { navSwipeDir, setNavSwipeDir, nextTrack } from "./player.js";
import { isInFavorites } from "./playlists.js";

// Cycles the repeat button through its three modes in order:
// off -> all -> one -> off -> ... and updates both the button's
// active/title state and the new small "A"/"1" badge on it.
function cycleRepeatMode(){
  if(state.repeat==="off") state.repeat="all";
  else if(state.repeat==="all") state.repeat="one";
  else state.repeat="off";

  const btn=$("repeatBtn");
  btn.classList.toggle("active", state.repeat!=="off");
  btn.title = state.repeat==="one" ? tr("player.repeatOne") : state.repeat==="all" ? tr("player.repeatAll") : tr("player.repeat");

  updateRepeatBadge();
  refreshNextPreview(); // repeat mode can change what resolveNextIndex() returns at the end of the queue
}



/* ================================================================
   ALBUM CAROUSEL
   Drives the three persistent ".art-slot" elements in #artCarousel
   (see index.html) that replace the old single cover image. Exactly
   three DOM slots exist for the app's entire lifetime — nothing is
   ever cloned or thrown away (see requirement #18: no ghost-card
   system) — and at any moment each one is doing one of three jobs,
   tracked via its .role property (kept in sync with its data-role
   attribute, which is what styles.css's COVER ART CAROUSEL rules
   actually animate):

     "prev"    — the track that was just playing
     "current" — the track playing right now (full size/opacity)
     "next"    — the track that would start if Next were pressed

   Rotating which physical slot holds which role (rotateCarousel(),
   below) — rather than swapping one slot's image — is what lets the
   album already visible on the right glide into the center instead
   of popping in as a freshly-loaded image, per this file's core
   requirement. peekNextEntry()/peekPrevEntry() (see just above
   nextTrack()) are what let this paint the next/previous slots
   *before* the user ever clicks anything.
   ================================================================ */
let carouselSlots=null; // [{el,img,ph,role}, ...] — populated once, lazily

function initCarouselSlots(){
  if(carouselSlots) return carouselSlots;
  const nodes=Array.from(document.querySelectorAll("#artCarousel .art-slot"));
  carouselSlots=nodes.map(el=>({
    el,
    img: el.querySelector(".art-slot-img"),
    ph: el.querySelector(".art-placeholder"),
    role: el.dataset.role // "prev" | "current" | "next", matches the HTML's initial data-role
  }));
  return carouselSlots;
}

function slotWithRole(role){ return carouselSlots.find(s=>s.role===role); }

// Paints a single slot's img/placeholder to match `entry`
// ({index,track} from peekNextEntry()/peekPrevEntry(), or null).
// hideWhenEmpty controls what an empty result looks like: the
// "current" slot falls back to the app's generic placeholder icon
// (matching the player's original no-track-loaded look), while the
// previous/next slots instead disappear entirely — see requirement
// #16, no fake album at the start/end of the queue.
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
  // Requirement #15: a real track with no embedded art still uses
  // the app's existing fallback icon rather than an empty hole.
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

// Instantly (no transition) reassigns a slot to a new role and
// repaints it — used only for the "recycle" half of rotateCarousel():
// an old previous/next slot that's no longer relevant silently
// becomes the new next/previous, in place, rather than visibly
// sliding all the way across the carousel to get there.
function recycleSlotInstant(slot, role, entry){
  slot.el.classList.add("art-slot-instant");
  slot.role=role;
  slot.el.dataset.role=role;
  paintCarouselSlot(slot, entry, true);
  void slot.el.offsetWidth; // commit transition:none before the next frame, so nothing tweens
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ slot.el.classList.remove("art-slot-instant"); });
  });
}

// Non-directional (re)sync: repaints all three slots straight to
// their resting content with no slide, for anything that isn't a
// genuine Next/Previous — first paint, picking a track directly from
// a list, a tag edit refreshing the currently-playing track's art,
// etc. (navSwipeDir stays null in all of those — see just above
// nextTrack()).
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

// Repaints ONLY the prev/next preview slots to match whatever
// resolveNextIndex()/resolvePrevIndex() would return right now — no
// slide, and the "current" slot is untouched. This is the single
// place responsible for keeping the background "next" artwork in
// sync with anything that changes what the next track actually is
// WITHOUT the current track itself changing: toggling Shuffle,
// cycling Repeat, or the live queue being edited (e.g. deleting the
// track that was the shuffle pick). A genuine track change (Next/
// Previous/picking a song) already goes through rotateCarousel()/
// syncCarouselStatic() via updateNowPlayingUI() and doesn't need this.
//
// Root cause this exists to fix: resolveNextIndex() already
// recalculates correctly the moment it's called (it reads
// state.shuffle/state.repeat/state.queue live, so it's never itself
// "wrong") — but nothing was re-invoking it to repaint the carousel
// when Shuffle/Repeat changed with no accompanying track change, so
// the "next" slot kept showing whatever artwork the LAST recalculation
// had painted (e.g. the shuffle pick from before Shuffle was turned
// off). The fix is to call this wherever that could happen, not to
// give the artwork its own separate state to patch up.
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

// The actual carousel rotation: current->prev, next->current, and
// the old prev is recycled into the new next (mirrored for "prev").
// Reads/writes carouselSlots' .role purely in JS, synchronously, so
// repeated rapid calls (fast repeated Next/Previous presses — see
// requirement #17) always rotate from whatever the *logical* state
// currently is, regardless of whether an earlier rotation's CSS
// transition has visually finished yet.
function rotateCarousel(dir){
  initCarouselSlots();
  if(!slotWithRole("current")){ syncCarouselStatic(); return; }

  if(dir==="next"){
    const oldPrev=slotWithRole("prev"), oldCurrent=slotWithRole("current"), oldNext=slotWithRole("next");
    // The art already showing in oldCurrent/oldNext is already
    // correct for their new roles — see the file header comment
    // above — so only their role/position changes; nothing is
    // repainted, which is what makes the next album glide into the
    // center instead of being swapped in.
    oldCurrent.role="prev"; oldCurrent.el.dataset.role="prev";
    oldNext.role="current"; oldNext.el.dataset.role="current";
    // state.currentTrack/queueIndex have already been advanced by
    // nextTrack()/completeCrossfadeHandoff() by the time this runs
    // (updateNowPlayingUI() below is called after that), so this is
    // "next after the new current" — exactly the new next slot.
    recycleSlotInstant(oldPrev, "next", peekNextEntry());
  } else {
    const oldPrev=slotWithRole("prev"), oldCurrent=slotWithRole("current"), oldNext=slotWithRole("next");
    oldCurrent.role="next"; oldCurrent.el.dataset.role="next";
    oldPrev.role="current"; oldPrev.el.dataset.role="current";
    recycleSlotInstant(oldNext, "prev", peekPrevEntry());
  }
}



// Refreshes every piece of "now playing" UI (title/artist/album,
// mini-player, cover art carousel) to match state.currentTrack.
function updateNowPlayingUI(){
  const t=state.currentTrack;
  if(!t) return;
  $("trackTitle").textContent=t.title;
  $("trackArtist").textContent=t.artist;
  $("trackAlbum").textContent=t.album;
  $("miniTitle").textContent=t.title;
  $("miniArtist").textContent=t.artist;

  // Consume navSwipeDir (set by nextTrack()/prevTrack()/the gapless
  // handoff — see just above nextTrack()) up front: only THIS update
  // gets to use it, so a later unrelated refresh doesn't replay a
  // stale rotation.
  const dir=navSwipeDir;
  setNavSwipeDir(null);

  const artURL=getTrackArtURL(t);
  $("miniArt").src = artURL || fallbackArt();

  // Requirement #14: keep the artwork move and the title/artist/
  // album text change perfectly in sync — both happen right here,
  // synchronously, in the same tick, so there's never a moment with
  // new text over old art (or vice versa). A real Next/Previous
  // rotates the existing prev/current/next slots into their new
  // roles (see rotateCarousel() above); anything else just repaints
  // all three fresh with no slide (syncCarouselStatic()).
  if(dir==="next" || dir==="prev"){
    rotateCarousel(dir);
  } else {
    syncCarouselStatic();
    replayMotion($("artWrap"),"track-change",360);
  }

  updateLoveButton();
  // Was: $("miniBar").style.display = state.currentTrack ? "flex" : "none";
  // An inline style has higher specificity than the CSS breakpoint rule
  // that's supposed to gate the mini-player bar to narrow/mobile widths
  // (see ".mini-bar" in styles.css), so setting it directly here forced
  // the bar to render at ANY viewport width, including desktop, where
  // .mini-bar has no position/size rules of its own (those only exist
  // inside the mobile media query). With no CSS width/height on desktop,
  // #miniArt rendered at its native image resolution as a normal-flow
  // block sitting right after the app content, silently inflating
  // <body>/<html>'s scrollable height — which is what "jump to current
  // track" (scrollToNowPlaying(), via scrollIntoView()) then partially
  // scrolled into view, looking like a giant album-art escaping from
  // the bottom of the player. Using a class instead lets CSS be the
  // single source of truth for both "is there a track" AND "are we at
  // a width where the mini-bar should show" — see ".mini-bar.has-track"
  // in styles.css.
  $("miniBar").classList.toggle("has-track", !!state.currentTrack);
  replayMotion(document.querySelector(".track-meta"),"track-change",300);
  replayMotion($("miniBar"),"track-change",260);
}



// Syncs the heart/"Love" button's active state with whether the
// current track is in Favorites.
function updateLoveButton(){
  const active = state.currentTrack && isInFavorites(state.currentTrack);
  $("loveBtn").classList.toggle("active",!!active);
}



/* ----------------------------------------------------------------
   LIQUID GLASS PLAY / PAUSE MORPH
   Builds two "rounded quad" glyphs — two bars for pause, a triangle
   for play — that share the exact same path command structure
   (M, Q,L,Q,L,Q,L,Q, Z) so they interpolate cleanly into each other,
   then morphs between them from updatePlayIcons() below whenever
   playback actually starts/stops.
   ---------------------------------------------------------------- */
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

// Rescales every number in a `d` string by k. Used to turn the glyphs'
// 0-100 design coordinates into the 0-1 fractional range an
// objectBoundingBox clipPath expects, so the glass clip always matches
// #playBtn's actual rendered size.
function scaleD(d, k){
  return d.replace(/-?\d+(\.\d+)?/g, m => (parseFloat(m)*k).toFixed(4));
}

const PLAY_GLYPH_R = 6;

// pause: two bars
const pauseGlyphD = buildD(
  [[30,24],[30,76],[42,76],[42,24]],
  [[58,24],[58,76],[70,76],[70,24]],
  PLAY_GLYPH_R
);

// play: left bar's outer corners collapse into a triangle tip — both
// converge on the *same* point (76,50) so the rounding on the top and
// bottom edges leading into the tip stays mirrored. The right bar
// collapses entirely into that same invisible point.
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

// initial paint — matches #playBtn's default "Play" state on load
setPlayGlyph(playGlyphD);



// Morphs the big liquid-glass button between "pause" and "play" glyphs,
// and swaps the mini-player's simple icon, to match whether audio is
// actually playing right now.
function updatePlayIcons(){
  const playing = !audioEl.paused && !audioEl.ended;

  setPlayGlyph(playing ? pauseGlyphD : playGlyphD);

  const playBtn=$("playBtn");
  playBtn.setAttribute("aria-pressed", String(playing));
  playBtn.setAttribute("aria-label", playing ? tr("player.pause") : tr("player.play"));

  const glassWrap=$("glassWrap");
  glassWrap.classList.remove("is-morphing");
  void glassWrap.offsetWidth; // restart the squish animation
  glassWrap.classList.add("is-morphing");

  $("miniPlayIcon").innerHTML = playing
    ? "<rect x='6' y='4' width='4' height='16'/><rect x='14' y='4' width='4' height='16'/>"
    : "<polygon points='6 3 20 12 6 21'/>";
}



// Shows/hides and sets the text of the new little "A"/"1" badge
// on the repeat button based on the current repeat mode. "A" means
// repeat-all is active; "1" means only the current song repeats;
// no badge at all means repeat is off.
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
