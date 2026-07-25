// ================================================================
// renderer-bridge.js — Electron RENDERER-side glue
// ----------------------------------------------------------------
// script.js is kept untouched on purpose, so it stays usable as-is
// for a plain web build, an Android wrapper, etc. Everything that
// only makes sense on desktop/Electron lives here instead, reaching
// in from the outside rather than editing script.js's internals:
//
//   1. OS/keyboard media keys (play/pause/next/prev), via the
//      standard Media Session API, driven by observing the DOM that
//      script.js already updates and by clicking script.js's own
//      transport buttons — the same thing a real click does.
//
//   2. "Delete track" / "Delete folder" (and bulk-select delete)
//      actually moving the file to the OS Recycle Bin / Trash,
//      instead of just removing it from the library.
//
// Include this via <script src="renderer-bridge.js"></script> right
// after script.js in index.html. On a non-Electron build, just
// don't include this file — everything below is a no-op without
// window.electronAPI, aside from the media-key wiring, which is
// harmless anywhere.
// ================================================================

(function(){
"use strict";

wireMediaKeys();

if(window.electronAPI){
  wireDeleteToTrash();
}



// ================================================================
// MEDIA KEYS
// Standard Media Session API — works the same in any Chromium-based
// shell, Electron included, so it's not gated behind
// window.electronAPI. Entirely DOM-driven: no access to script.js's
// internal state, queue, or functions.
// ================================================================
function wireMediaKeys(){
  if(!("mediaSession" in navigator)) return;

  const audioEl=document.getElementById("audioEl");
  const titleEl=document.getElementById("trackTitle");
  const artistEl=document.getElementById("trackArtist");
  const artImg=document.getElementById("artImg");
  if(!audioEl || !titleEl) return;

  // Keep the OS's play/pause indicator in sync with real playback.
  audioEl.addEventListener("play",()=>{ navigator.mediaSession.playbackState="playing"; });
  audioEl.addEventListener("pause",()=>{ navigator.mediaSession.playbackState="paused"; });

  // Play/pause can act directly on the <audio> element. Next/prev
  // can't — the actual "what track comes next" logic (shuffle,
  // repeat, queue) lives inside script.js's closure with no way to
  // call in from outside, so instead this clicks the exact same
  // buttons a user would, which are already wired to that logic.
  navigator.mediaSession.setActionHandler("play",()=>{ if(audioEl.paused) audioEl.play().catch(()=>{}); });
  navigator.mediaSession.setActionHandler("pause",()=>{ if(!audioEl.paused) audioEl.pause(); });
  navigator.mediaSession.setActionHandler("previoustrack",()=>{ const b=document.getElementById("prevBtn"); if(b) b.click(); });
  navigator.mediaSession.setActionHandler("nexttrack",()=>{ const b=document.getElementById("nextBtn"); if(b) b.click(); });

  // script.js doesn't fire a "track changed" event, so instead of
  // adding one this just watches the same elements script.js already
  // updates on every track change and mirrors them into Media
  // Session metadata whenever they change.
  function updateMetadata(){
    const title=titleEl.textContent || "Unknown title";
    const artist=artistEl ? artistEl.textContent : "";
    const hasArt=artImg && !artImg.classList.contains("hidden") && artImg.src;
    navigator.mediaSession.metadata=new MediaMetadata({
      title:title,
      artist:artist,
      artwork: hasArt ? [{src:artImg.src, sizes:"512x512", type:"image/png"}] : []
    });
  }

  updateMetadata();
  new MutationObserver(updateMetadata).observe(titleEl,{childList:true,characterData:true,subtree:true});
  if(artistEl) new MutationObserver(updateMetadata).observe(artistEl,{childList:true,characterData:true,subtree:true});
  if(artImg) new MutationObserver(updateMetadata).observe(artImg,{attributes:true,attributeFilter:["src","class"]});
}



// ================================================================
// DELETE -> TRASH
// Electron only (needs window.electronAPI.trashFile, added in
// preload.js, which calls shell.trashItem in main.js).
//
// Listens for script.js's "playnck:tracks-deleted" event (a small,
// generic, platform-agnostic hook — see notifyTracksDeleted() in
// script.js) and sends each listed file to the Recycle Bin/Trash.
//
// IMPORTANT: only ever fired from the genuine "Delete" paths
// (deleteTrack, deleteFolder, bulk delete) — never from "Forget
// folder", which stays library-only on purpose. Listening for this
// specific event (rather than patching IDBObjectStore.prototype
// .delete globally, which was tried before) is what lets this tell
// "Delete" and "Forget" apart, since both end up calling the same
// idbDelete("tracks", id) under the hood.
// ================================================================
function wireDeleteToTrash(){
  if(!window.electronAPI || !window.electronAPI.trashFile) return;

  document.addEventListener("playnck:tracks-deleted",(e)=>{
    const paths=(e.detail && e.detail.paths) || [];
    paths.forEach(p=>{
      window.electronAPI.trashFile(p).then(result=>{
        if(!result || !result.trashed){
          console.warn("Couldn't move file to Recycle Bin:",p,result && result.reason);
        }
      }).catch(err=>console.warn("trashFile call failed:",err));
    });
  });
}

})();
