import { state, idbPut, idbDelete, uid, nextOrder } from "./state.js";
import { el, replayMotion } from "./utils.js";
import { tr, plural } from "./i18n.js";
import { renderTab } from "./library-view.js";
import { closeMenu, setOpenMenuEl } from "./menus.js";
import { promptModal } from "./modal.js";
import { openMoveItemModal, folderAndDescendantIds } from "./playlists.js";

/* ================================================================
   PLAYLIST FOLDERS
   The Playlists tab's own folder hierarchy — lets playlists (and
   other folders) be organized under unlimited levels of nesting,
   the same way a file manager nests folders. Completely separate
   from state.folders/folders.js, which groups imported SONGS by
   their real location on disk; a playlist folder only ever holds
   playlists and other playlist folders, never tracks directly.

   Each entry is {id,name,parentId,order}: parentId points at
   another state.playlistFolders entry, or is null/undefined for a
   root-level folder — the whole tree is just this one flat array
   plus that one pointer, and a playlist joins the same tree via its
   own parentId (see createPlaylistPrompt() in playlists.js). Which
   folder is currently open in the Playlists tab is tracked by
   state.playlistFolderId (null = root) — see renderPlaylistList()
   in library-view.js, which reads it to decide what to show, and
   the back button in bindings.js, which steps it up to the current
   folder's own parentId.
   ================================================================ */

// Prompts for a name and creates a new folder inside whichever
// playlist folder is currently open (root, if none).
async function createPlaylistFolderPrompt(){
  const name=await promptModal(tr("prompt.newPlaylistFolderTitle"),tr("prompt.folderNameLabel"));
  if(!name) return;
  const f={id:uid(),name,parentId:state.playlistFolderId||null,order:nextOrder()};
  state.playlistFolders.push(f);
  idbPut("playlistFolders",f);
  renderTab();
}



// Drills into a playlist folder, showing its playlists/subfolders —
// the playlist-tab equivalent of setting state.filter for a song
// list, except folders never hold tracks directly so there's no
// filter/track list involved, just a different current parent.
function openPlaylistFolder(folder){
  state.playlistFolderId=folder.id;
  renderTab();
}



// Opens the "⋮" menu for a single playlist-folder row (Rename /
// Move / Delete). Reuses the exact same ".ctx-menu" popup styling
// and single-menu-at-a-time behavior as openPlaylistMenu() in
// playlists.js. No "Forget" entry here — unlike a library folder, a
// playlist folder has no real directory on disk to forget.
function openPlaylistFolderMenu(e,folder){
  closeMenu();
  const menu=el("div","ctx-menu");

  const renameBtn=el("button","",tr("folder.rename"));
  renameBtn.addEventListener("click",()=>{ closeMenu(); renamePlaylistFolder(folder); });
  menu.appendChild(renameBtn);

  const moveBtn=el("button","",tr("menu.moveTo"));
  moveBtn.addEventListener("click",()=>{ closeMenu(); openMoveItemModal(folder,"folder"); });
  menu.appendChild(moveBtn);

  const delBtn=el("button","danger",tr("folder.delete"));
  delBtn.addEventListener("click",()=>{ closeMenu(); deletePlaylistFolder(folder); });
  menu.appendChild(delBtn);

  document.body.appendChild(menu);
  replayMotion(menu);
  const rect=e.currentTarget.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.right-150;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";
  setOpenMenuEl(menu);

  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



// Prompts for a new name and renames the folder in place.
async function renamePlaylistFolder(folder){
  const name=await promptModal(tr("prompt.renameFolderTitle"),tr("prompt.folderNameLabel"),folder.name);
  if(!name) return;
  folder.name=name;
  idbPut("playlistFolders",folder);
  renderTab();
}



// Permanently deletes a folder AND everything nested inside it, at
// any depth — every subfolder, and every playlist those subfolders
// (or this one) contain. Same "playlists themselves are deleted, but
// the songs inside them stay in the library" rule as a normal
// deletePlaylist() — this never touches state.tracks. Confirms once
// up front with a count of what's about to go, same pattern as
// deleteFolder() in folders.js.
function deletePlaylistFolder(folder){
  const ids=folderAndDescendantIds(folder.id); // includes folder.id itself
  const descendantFolderCount=ids.size-1;
  const playlistsInside=state.playlists.filter(p=>p.parentId && ids.has(p.parentId));

  const parts=[];
  if(playlistsInside.length) parts.push(plural(playlistsInside.length,"playlist"));
  if(descendantFolderCount) parts.push(plural(descendantFolderCount,"folder"));
  const label=parts.length ? tr("and its")+parts.join(tr("labelAnd")) : "";

  if(!confirm(tr("confirm.deleteNamedWithLabel",{name:folder.name,label}))) return;

  const deletedPlaylistIds=new Set(playlistsInside.map(p=>p.id));
  playlistsInside.forEach(p=>idbDelete("playlists",p.id));
  state.playlists=state.playlists.filter(p=>!deletedPlaylistIds.has(p.id));

  ids.forEach(id=>idbDelete("playlistFolders",id));
  state.playlistFolders=state.playlistFolders.filter(f=>!ids.has(f.id));

  // Currently browsing the deleted folder (or one of its now-gone
  // descendants)? Back out to wherever it used to live rather than
  // showing a broken nested view.
  if(state.playlistFolderId && ids.has(state.playlistFolderId)){
    state.playlistFolderId=folder.parentId||null;
  }
  // Same idea for a playlist song view drilled into from inside the
  // deleted subtree — same guard deletePlaylist() uses.
  if(state.filter && state.filter.type==="playlist" && deletedPlaylistIds.has(state.filter.playlistId)){
    state.filter=null;
  }

  renderTab();
}



// Total playlists nested anywhere inside a folder (direct children
// plus every subfolder's, recursively) — shown as that folder row's
// subtitle in the Playlists tab, the same role plural(tracks.length)
// plays on a library-folder row.
function countPlaylistsInFolder(folderId){
  const ids=folderAndDescendantIds(folderId);
  return state.playlists.filter(p=>p.parentId && ids.has(p.parentId)).length;
}

export { createPlaylistFolderPrompt, openPlaylistFolder, openPlaylistFolderMenu, countPlaylistsInFolder };
