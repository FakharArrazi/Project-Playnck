import { state } from "./state.js";
import { el, replayMotion, escapeHTML } from "./utils.js";
import { tr } from "./i18n.js";
import { currentSortKey, SORT_OPTIONS, renderTab } from "./library-view.js";
import { createPlaylistPrompt, addToPlaylist, removeFromPlaylist, isInFavorites, toggleFavorite, deleteTrack } from "./playlists.js";
import { openInfoModal } from "./side-menu.js";

let openMenuEl=null;

function setOpenMenuEl(value){ openMenuEl=value; return openMenuEl; }



function closeMenu(){ if(openMenuEl){ openMenuEl.remove(); openMenuEl=null; } }



function openTrackMenu(e,track,currentPlaylistId){
  closeMenu();
  const menu=el("div","ctx-menu");
  const favBtn=el("button","","&#9829; "+(isInFavorites(track)?tr("track.removeFromFavorites"):tr("track.addToFavorites")));
  favBtn.addEventListener("click",()=>{ toggleFavorite(track); closeMenu(); renderTab(); });
  menu.appendChild(favBtn);
  const infoBtn=el("button","","&#9432; "+tr("track.info"));
  infoBtn.addEventListener("click",()=>{ closeMenu(); openInfoModal(track); });
  menu.appendChild(infoBtn);
  menu.appendChild(el("div","divider"));
  menu.appendChild(el("div","submenu-label",tr("track.addToPlaylist")));
  state.playlists.forEach(p=>{
    if(p.id===state.favoritesId) return;
    const b=el("button","",escapeHTML(p.name));
    b.addEventListener("click",()=>{ addToPlaylist(p.id,track.id); closeMenu(); });
    menu.appendChild(b);
  });
  const newB=el("button","",tr("track.newPlaylist"));
  newB.addEventListener("click",()=>{ closeMenu(); createPlaylistPrompt(track.id); });
  menu.appendChild(newB);
  if(currentPlaylistId){
    menu.appendChild(el("div","divider"));
    const rem=el("button","",tr("track.removeFromThisPlaylist"));
    rem.addEventListener("click",()=>{ removeFromPlaylist(currentPlaylistId,track.id); closeMenu(); });
    menu.appendChild(rem);
  }
  menu.appendChild(el("div","divider"));
  const delBtn=el("button","danger",tr("track.deleteTrack"));
  delBtn.addEventListener("click",()=>{ closeMenu(); deleteTrack(track); });
  menu.appendChild(delBtn);
  document.body.appendChild(menu);
  replayMotion(menu);
  const rect=e.target.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.left-150;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";
  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



function openSortMenu(e){
  closeMenu();

  const menu=el("div","ctx-menu");
  menu.appendChild(el("div","submenu-label",tr("sort.sortSongsBy")));

  SORT_OPTIONS.forEach(opt=>{
    const isActive=state[currentSortKey()]===opt.value;
    const btn=el("button","",(isActive?"✓ ":"")+escapeHTML(tr(opt.key)));
    if(isActive) btn.classList.add("selected");
    btn.addEventListener("click",()=>{ setSortBy(opt.value); closeMenu(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  replayMotion(menu);

  const rect=e.currentTarget.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.right-190;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";

  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



function setSortBy(value){
  state[currentSortKey()]=value;
  renderTab();
}

export { openMenuEl, setOpenMenuEl, closeMenu, openTrackMenu, openSortMenu };
