import { state, $ } from "./state.js";
import { ingestFiles } from "./metadata.js";
import { playTrack } from "./player.js";

/* ================================================================
   DRAG & DROP TO PLAY
   Dropping audio file(s) anywhere on the app window adds them to
   the library the same way "Add Songs" does (skipping any that are
   already there — see the duplicate guard in ingestFiles above) and
   immediately starts playing the first one, queued together with
   the rest in drop order. Purely window-level: no dedicated drop
   zone element, since the whole app should accept a drop.
   ================================================================ */
function wireDragAndDropPlay(){
  const overlay=$("dragDropOverlay");
  if(!overlay) return;

  // dragenter/dragleave both fire once per element boundary crossed,
  // including every child under the pointer — not just once for the
  // whole window. A plain depth counter is the standard fix: only
  // hide the overlay once it's back down to zero, i.e. the pointer
  // has actually left the window rather than just passed over a
  // child element on its way across it.
  let dragDepth=0;

  // Only react to an actual OS file drag (dataTransfer.types
  // includes "Files") — text/link drags from elsewhere in the page,
  // if any exist elsewhere later, are left alone.
  function isFileDrag(e){
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes("Files"));
  }

  window.addEventListener("dragenter",(e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    // The Convert tab has its own drop zone with its own visual
    // feedback (see renderConvertAddFilesSection() further down) —
    // stepping aside here (no overlay, no depth tracking) is what
    // stops this window-level handler from also firing on a file
    // dropped there and importing it into the library, which is
    // exactly what the Convert tab must never do.
    if(state.currentTab==="convert") return;
    dragDepth++;
    overlay.classList.remove("hidden");
  });

  window.addEventListener("dragover",(e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault(); // required regardless of tab — without this the browser/Electron just navigates to/opens the file itself instead of firing "drop"
  });

  window.addEventListener("dragleave",(e)=>{
    if(!isFileDrag(e)) return;
    if(state.currentTab==="convert") return;
    dragDepth=Math.max(0,dragDepth-1);
    if(dragDepth===0) overlay.classList.add("hidden");
  });

  window.addEventListener("drop", async (e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    // See the dragenter comment above — the Convert tab's own drop
    // zone handles this drop entirely on its own.
    if(state.currentTab==="convert") return;
    dragDepth=0;
    overlay.classList.add("hidden");

    const files=e.dataTransfer.files;
    if(!files || !files.length) return;

    // ingestFiles() already filters down to real audio files, skips
    // anything already in the library (returning the existing track
    // instead of a duplicate), and hands back one track record per
    // dropped file in order — exactly what's needed to build a
    // queue and start playback the same way clicking a song row does.
    const tracks=await ingestFiles(files,null);
    if(tracks.length) playTrack(tracks[0], tracks);
  });
}

export { wireDragAndDropPlay };
