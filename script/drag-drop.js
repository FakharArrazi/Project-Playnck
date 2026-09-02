import { state, $ } from "./state.js";
import { ingestFiles } from "./metadata.js";
import { playTrack } from "./player.js";

function wireDragAndDropPlay(){
  const overlay=$("dragDropOverlay");
  if(!overlay) return;

  let dragDepth=0;

  function isFileDrag(e){
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes("Files"));
  }

  window.addEventListener("dragenter",(e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    if(state.currentTab==="convert") return;
    dragDepth++;
    overlay.classList.remove("hidden");
  });

  window.addEventListener("dragover",(e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
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
    if(state.currentTab==="convert") return;
    dragDepth=0;
    overlay.classList.add("hidden");

    const files=e.dataTransfer.files;
    if(!files || !files.length) return;

    const tracks=await ingestFiles(files,null);
    if(tracks.length) playTrack(tracks[0], tracks);
  });
}

export { wireDragAndDropPlay };
