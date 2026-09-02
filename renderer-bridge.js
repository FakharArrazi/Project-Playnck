
(function(){
"use strict";

wireMediaKeys();

if(window.electronAPI){
  wireDeleteToTrash();
}



function wireMediaKeys(){
  if(!("mediaSession" in navigator)) return;

  const audioEl=document.getElementById("audioEl");
  const titleEl=document.getElementById("trackTitle");
  const artistEl=document.getElementById("trackArtist");
  const artImg=document.querySelector('.art-slot[data-role="current"] .art-slot-img');
  if(!audioEl || !titleEl) return;

  audioEl.addEventListener("play",()=>{ navigator.mediaSession.playbackState="playing"; });
  audioEl.addEventListener("pause",()=>{ navigator.mediaSession.playbackState="paused"; });

  navigator.mediaSession.setActionHandler("play",()=>{ if(audioEl.paused) audioEl.play().catch(()=>{}); });
  navigator.mediaSession.setActionHandler("pause",()=>{ if(!audioEl.paused) audioEl.pause(); });
  navigator.mediaSession.setActionHandler("previoustrack",()=>{ const b=document.getElementById("prevBtn"); if(b) b.click(); });
  navigator.mediaSession.setActionHandler("nexttrack",()=>{ const b=document.getElementById("nextBtn"); if(b) b.click(); });

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
