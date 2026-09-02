import { state, idbPut, idbDelete, uid, nextOrder } from "./state.js";
import { el, replayMotion } from "./utils.js";
import { tr, plural } from "./i18n.js";
import { renderTab } from "./library-view.js";
import { closeMenu, setOpenMenuEl } from "./menus.js";
import { promptModal } from "./modal.js";
import { openMoveItemModal, folderAndDescendantIds } from "./playlists.js";


async function createPlaylistFolderPrompt(){
  const name=await promptModal(tr("prompt.newPlaylistFolderTitle"),tr("prompt.folderNameLabel"));
  if(!name) return;
  const f={id:uid(),name,parentId:state.playlistFolderId||null,order:nextOrder()};
  state.playlistFolders.push(f);
  idbPut("playlistFolders",f);
  renderTab();
}



function openPlaylistFolder(folder){
  state.playlistFolderId=folder.id;
  renderTab();
}



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



async function renamePlaylistFolder(folder){
  const name=await promptModal(tr("prompt.renameFolderTitle"),tr("prompt.folderNameLabel"),folder.name);
  if(!name) return;
  folder.name=name;
  idbPut("playlistFolders",folder);
  renderTab();
}



function deletePlaylistFolder(folder){
  const ids=folderAndDescendantIds(folder.id);
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

  if(state.playlistFolderId && ids.has(state.playlistFolderId)){
    state.playlistFolderId=folder.parentId||null;
  }
  if(state.filter && state.filter.type==="playlist" && deletedPlaylistIds.has(state.filter.playlistId)){
    state.filter=null;
  }

  renderTab();
}



function countPlaylistsInFolder(folderId){
  const ids=folderAndDescendantIds(folderId);
  return state.playlists.filter(p=>p.parentId && ids.has(p.parentId)).length;
}

export { createPlaylistFolderPrompt, openPlaylistFolder, openPlaylistFolderMenu, countPlaylistsInFolder };
