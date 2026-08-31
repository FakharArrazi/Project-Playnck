import { state } from "./state.js";
import { el, replayMotion, escapeHTML } from "./utils.js";
import { tr } from "./i18n.js";
import { currentSortKey, SORT_OPTIONS, renderTab } from "./library-view.js";
import { createPlaylistPrompt, addToPlaylist, removeFromPlaylist, isInFavorites, toggleFavorite, deleteTrack } from "./playlists.js";
import { openInfoModal } from "./side-menu.js";

/* ================================================================
   CONTEXT MENU & SORT MENU
   Both the per-song "⋮" menu and the new sort-button menu are
   small floating ".ctx-menu" popups built fresh each time they're
   opened and thrown away when closed. openMenuEl always points at
   whichever one is currently on screen (or null), so opening a
   new one automatically closes any other that was already open.
   ================================================================ */
let openMenuEl=null;

function setOpenMenuEl(value){ openMenuEl=value; return openMenuEl; }



// Removes whichever floating menu is currently open, if any.
function closeMenu(){ if(openMenuEl){ openMenuEl.remove(); openMenuEl=null; } }



// Opens the "⋮" menu for a single song row: add/remove favorite,
// view track/file info, add to any playlist (or a brand new one),
// — only when this row is being shown inside a playlist — remove
// it from that playlist, and finally delete the track from the
// library entirely. Edit and Sync Lyrics are deliberately NOT here —
// they only act on whatever's currently playing (openEditModal()/
// openSyncModal() with no argument), so they live exclusively in the
// now-playing panel's top-right ☰ side menu instead (see
// menuEditBtn/menuSyncBtn wiring further down).
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
    // Favorites is skipped here on purpose — it's already covered
    // by the "Add/Remove Favorites" button right above, so listing
    // it again under "Add to playlist" would just be a duplicate.
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



// Opens the new sort-order menu, anchored under the sort icon
// button. Reuses the exact same ".ctx-menu" styling and single-
// menu-at-a-time behavior as openTrackMenu() above. Uses
// e.currentTarget (not e.target) because a click could land on
// the button's nested <svg>/<line> icon rather than the button
// itself — currentTarget is always the button the listener is on.
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

  // Right-align the menu under the button so it never spills past
  // the edge of the sidebar.
  const rect=e.currentTarget.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.right-190;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";

  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



// Changes the active sort order (album-specific or general —
// see currentSortKey()) and immediately re-renders the current list
// so the new order is visible right away.
function setSortBy(value){
  state[currentSortKey()]=value;
  renderTab();
}

export { openMenuEl, setOpenMenuEl, closeMenu, openTrackMenu, openSortMenu };
