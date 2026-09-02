import { state, $, idbPut, idbDelete, audioEl, uid, nextOrder, selectToggle } from "./state.js";
import { tr, plural, SELECT_TYPE_PLURAL_KEY } from "./i18n.js";
import { escapeHTML, el, replayMotion, debounce } from "./utils.js";
import { renderTab, computeAlbums, computeArtists, matchQuery } from "./library-view.js";
import { closeMenu, setOpenMenuEl } from "./menus.js";
import { libraryTracks } from "./metadata.js";
import { openModal, closeModal, promptModal } from "./modal.js";
import { resetShuffleNextPick } from "./queue.js";
import { refreshNextPreview, updateNowPlayingUI, updateLoveButton } from "./now-playing-ui.js";


async function createPlaylistPrompt(trackIdToAdd){
  const name=await promptModal(tr("prompt.newPlaylistTitle"),tr("prompt.playlistNameLabel"));
  if(!name) return;
  const p={id:uid(),name,trackIds:trackIdToAdd?[trackIdToAdd]:[],parentId:state.playlistFolderId||null,order:nextOrder()};
  state.playlists.push(p);
  idbPut("playlists",p);
  renderTab();
}



function openPlaylistMenu(e,playlist){
  closeMenu();
  const menu=el("div","ctx-menu");

  const renameBtn=el("button","",tr("playlist.rename"));
  renameBtn.addEventListener("click",()=>{ closeMenu(); renamePlaylist(playlist); });
  menu.appendChild(renameBtn);

  const moveBtn=el("button","",tr("menu.moveTo"));
  moveBtn.addEventListener("click",()=>{ closeMenu(); openMoveItemModal(playlist,"playlist"); });
  menu.appendChild(moveBtn);

  const exportBtn=el("button","",tr("playlist.export"));
  exportBtn.addEventListener("click",()=>{ closeMenu(); exportPlaylistAsM3U(playlist); });
  menu.appendChild(exportBtn);

  const delBtn=el("button","danger",tr("playlist.delete"));
  delBtn.addEventListener("click",()=>{ closeMenu(); deletePlaylist(playlist); });
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



async function renamePlaylist(playlist){
  const name=await promptModal(tr("prompt.renamePlaylistTitle"),tr("prompt.playlistNameLabel"),playlist.name);
  if(!name) return;
  playlist.name=name;
  idbPut("playlists",playlist);
  renderTab();
}



function deletePlaylist(playlist){
  if(!confirm(tr("confirm.deleteNamed",{name:playlist.name}))) return;
  state.playlists=state.playlists.filter(p=>p.id!==playlist.id);
  idbDelete("playlists",playlist.id);
  if(state.filter&&state.filter.type==="playlist"&&state.filter.playlistId===playlist.id){
    state.filter=null;
  }
  renderTab();
}



function folderAndDescendantIds(folderId){
  const ids=new Set([folderId]);
  let grew=true;
  while(grew){
    grew=false;
    state.playlistFolders.forEach(f=>{
      const parentId=f.parentId||null;
      if(parentId && ids.has(parentId) && !ids.has(f.id)){
        ids.add(f.id);
        grew=true;
      }
    });
  }
  return ids;
}



function playlistFolderPath(folder){
  const parts=[folder.name];
  let cur=folder;
  while(cur.parentId){
    const parent=state.playlistFolders.find(f=>f.id===cur.parentId);
    if(!parent) break;
    parts.unshift(parent.name);
    cur=parent;
  }
  return parts.join(" / ");
}



function openMoveItemModal(item,kind){
  const excludedIds = kind==="folder" ? folderAndDescendantIds(item.id) : new Set();
  const destinations=state.playlistFolders.filter(f=>!excludedIds.has(f.id));

  const rows=[{id:"",label:tr("playlistFolders.rootLevel")}]
    .concat(destinations.map(f=>({id:f.id,label:playlistFolderPath(f)})));

  const bodyHTML="<div class='add-music-list' id='moveItemList'>"+rows.map(r=>`
    <div class="add-music-row" data-dest-id="${escapeHTML(r.id)}">
      <div class="amr-text"><div class="amr-title">${escapeHTML(r.label)}</div></div>
      <button class="amr-add-btn">${escapeHTML(tr("btn.moveHere"))}</button>
    </div>`).join("")+"</div>";

  openModal(tr("modal.moveToNamed",{name:item.name}), bodyHTML);

  $("moveItemList").querySelectorAll(".add-music-row").forEach(row=>{
    const destId=row.dataset.destId||null;
    row.querySelector(".amr-add-btn").addEventListener("click",()=>{
      item.parentId=destId;
      idbPut(kind==="folder" ? "playlistFolders" : "playlists", item);
      closeModal();
      renderTab();
    });
  });
}



async function exportPlaylistAsM3U(playlist){
  if(!(window.electronAPI && window.electronAPI.saveTextFile)){
    alert(tr("playlist.exportUnavailable"));
    return;
  }

  const tracks=playlist.trackIds.map(id=>state.tracks.find(t=>t.id===id)).filter(Boolean);
  const withPaths=tracks.filter(t=>t.filePath);
  const skipped=tracks.length-withPaths.length;

  const lines=["#EXTM3U"];
  withPaths.forEach(t=>{
    const secs=t.duration?Math.round(t.duration):-1;
    lines.push(`#EXTINF:${secs},${t.artist||"Unknown Artist"} - ${t.title||"Unknown Title"}`);
    lines.push(t.filePath);
  });

  const safeName=(playlist.name||"playlist").replace(/[\\/:*?"<>|]+/g,"_");
  const result=await window.electronAPI.saveTextFile(`${safeName}.m3u8`, lines.join("\n")+"\n", "M3U Playlist", ["m3u8","m3u"]);

  if(result && result.saved){
    alert(skipped>0 ? tr("playlist.exportedWithSkipped",{count:skipped}) : tr("playlist.exported"));
  } else if(result && result.reason && result.reason!=="canceled"){
    alert(tr("playlist.exportFailed",{reason:result.reason}));
  }
}



function addToPlaylist(playlistId,trackId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;
  if(!p.trackIds.includes(trackId)) p.trackIds.push(trackId);
  idbPut("playlists",p);
  if(state.filter && state.filter.playlistId===playlistId && !state.filter.tracks.some(t=>t.id===trackId)){
    const t=state.tracks.find(t=>t.id===trackId);
    if(t) state.filter.tracks.push(t);
  }
  renderTab();
}



const ADD_MUSIC_SORT_OPTIONS=[
  {value:"title-asc",  key:"sort.titleAsc"},
  {value:"artist-asc", key:"sort.artistAsc"},
  {value:"album-asc",  key:"sort.albumAsc"},
  {value:"date-desc",  key:"sort.dateNewest"}
];

function sortAddMusicTracks(tracks,sortBy){
  const sorted=[...tracks];
  switch(sortBy){
    case "artist-asc": sorted.sort((a,b)=>a.artist.localeCompare(b.artist)); break;
    case "album-asc":  sorted.sort((a,b)=>a.album.localeCompare(b.album)); break;
    case "date-desc":  sorted.sort((a,b)=>(b.dateAdded||0)-(a.dateAdded||0)); break;
    case "title-asc":
    default:           sorted.sort((a,b)=>a.title.localeCompare(b.title)); break;
  }
  return sorted;
}

function addMusicRowHTML(t,p){
  const already=p.trackIds.includes(t.id);
  return `<div class="add-music-row${already?" added":""}" data-track-id="${t.id}">
    <div class="amr-text">
      <div class="amr-title">${escapeHTML(t.title)}</div>
      <div class="amr-artist">${escapeHTML(t.artist)}</div>
    </div>
    <button class="amr-add-btn" ${already?"disabled":""}>${already?escapeHTML(tr("btn.added")):escapeHTML(tr("btn.add"))}</button>
  </div>`;
}

function openAddMusicModal(playlistId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;

  const allTracks=libraryTracks();
  if(!allTracks.length){
    openModal(tr("modal.addMusic"), `<p class='info-empty'>${escapeHTML(tr("empty.noLibraryForAddMusic"))}</p>`);
    return;
  }

  const bodyHTML=`
    <div class="add-music-controls">
      <input type="text" class="edit-input add-music-search" id="addMusicSearch" placeholder="${escapeHTML(tr("search.placeholder"))}" autocomplete="off">
      <select class="edit-input add-music-sort" id="addMusicSort" title="${escapeHTML(tr("sort.sortSongsBy"))}">
        ${ADD_MUSIC_SORT_OPTIONS.map(opt=>`<option value="${opt.value}">${escapeHTML(tr(opt.key))}</option>`).join("")}
      </select>
    </div>
    <div class="add-music-list" id="addMusicList"></div>`;

  openModal(tr("modal.addMusicToNamed",{name:p.name}), bodyHTML);

  const searchInput=$("addMusicSearch");
  const sortSelect=$("addMusicSort");
  const listEl=$("addMusicList");

  function renderRows(){
    const q=(searchInput.value||"").toLowerCase().trim();
    const visible=sortAddMusicTracks(q?allTracks.filter(t=>matchQuery(t,q)):allTracks, sortSelect.value);

    if(!visible.length){
      listEl.innerHTML=`<p class="info-empty">${escapeHTML(tr("empty.noAddMusicResults"))}</p>`;
      return;
    }

    listEl.innerHTML=visible.map(t=>addMusicRowHTML(t,p)).join("");

    listEl.querySelectorAll(".add-music-row").forEach(row=>{
      const trackId=row.dataset.trackId;
      const addBtn=row.querySelector(".amr-add-btn");
      addBtn.addEventListener("click",()=>{
        addToPlaylist(playlistId,trackId);
        row.classList.add("added");
        addBtn.textContent=tr("btn.added");
        addBtn.disabled=true;
      });
    });
  }

  searchInput.addEventListener("input",debounce(renderRows,120));
  sortSelect.addEventListener("change",renderRows);

  renderRows();
}




function removeFromPlaylist(playlistId,trackId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;
  p.trackIds=p.trackIds.filter(id=>id!==trackId);
  idbPut("playlists",p);
  if(state.filter && state.filter.playlistId===playlistId){
    state.filter.tracks=state.filter.tracks.filter(t=>t.id!==trackId);
  }
  renderTab();
}



function isInFavorites(track){
  const fav=state.playlists.find(p=>p.id===state.favoritesId);
  return fav && fav.trackIds.includes(track.id);
}



function toggleFavorite(track){
  const fav=state.playlists.find(p=>p.id===state.favoritesId);
  if(!fav) return;
  let liked;
  if(fav.trackIds.includes(track.id)){ fav.trackIds=fav.trackIds.filter(id=>id!==track.id); liked=false; }
  else { fav.trackIds.push(track.id); liked=true; }
  idbPut("playlists",fav);
  updateLoveButton();
  animateLoveIcon(liked);
}



function animateLoveIcon(liked){
  const btn=$("loveBtn");
  if(!btn) return;
  const icon=btn.querySelector("svg");
  if(icon) replayMotion(icon, liked?"heart-rise":"heart-sink", liked?640:620);
  if(liked && !window.matchMedia("(prefers-reduced-motion: reduce)").matches){
    replayMotion(btn,"heart-glow",640);
    spawnHeartSparks(btn);
  }
}

function spawnHeartSparks(btn){
  const glyphs=["♥","✦","♥","✦","♥","♥"];
  glyphs.forEach(g=>{
    const spark=document.createElement("span");
    spark.className="heart-spark";
    spark.textContent=g;
    spark.style.setProperty("--dx",Math.round(Math.random()*46-23)+"px");
    spark.style.setProperty("--rot",Math.round(Math.random()*50-25)+"deg");
    spark.style.animationDelay=Math.round(Math.random()*80)+"ms";
    btn.appendChild(spark);
    spark.addEventListener("animationend",()=>spark.remove(),{once:true});
    setTimeout(()=>spark.remove(),900);
  });
}



function notifyTracksDeleted(tracks){
  const paths=tracks.map(t=>t.filePath).filter(Boolean);
  if(paths.length) document.dispatchEvent(new CustomEvent("playnck:tracks-deleted",{detail:{paths}}));
}



function removeTrackData(track){
  if(state.currentTrack && state.currentTrack.id===track.id){
    audioEl.pause();
    audioEl.src="";
    state.currentTrack=null;
    updateNowPlayingUI();
  }

  state.playlists.forEach(p=>{
    if(p.trackIds.includes(track.id)){
      p.trackIds=p.trackIds.filter(id=>id!==track.id);
      idbPut("playlists",p);
    }
  });

  const qIdx=state.queue.indexOf(track.id);
  if(qIdx!==-1){
    state.queue.splice(qIdx,1);
    if(state.queueIndex>qIdx) state.queueIndex--;
    resetShuffleNextPick();
    refreshNextPreview();
  }

  if(track.fileURL) URL.revokeObjectURL(track.fileURL);
  if(track.artURL) URL.revokeObjectURL(track.artURL);

  state.tracks=state.tracks.filter(t=>t.id!==track.id);
  idbDelete("tracks",track.id);
  idbDelete("lyrics",track.id).catch(()=>{});
}



function deleteTrack(track){
  if(!confirm(tr("confirm.deleteNamed",{name:track.title}))) return;
  notifyTracksDeleted([track]);
  removeTrackData(track);
  if(state.filter) state.filter.tracks=state.filter.tracks.filter(t=>t.id!==track.id);
  renderTab();
}



function getSelectedTrackIds(){
  const ids=[...state.selectedIds];
  if(state.selectType==="track") return ids;
  if(state.selectType==="albums"){
    const chosen=computeAlbums().filter(a=>ids.includes(a.key));
    return [...new Set(chosen.flatMap(a=>a.tracks.map(t=>t.id)))];
  }
  if(state.selectType==="artists"){
    const chosen=computeArtists().filter(a=>ids.includes(a.artist));
    return [...new Set(chosen.flatMap(a=>a.tracks.map(t=>t.id)))];
  }
  if(state.selectType==="folders"){
    return state.tracks.filter(t=>ids.includes(t.folderId)).map(t=>t.id);
  }
  return [];
}



function deleteSelectedItems(){
  const ids=[...state.selectedIds];
  if(!ids.length) return;
  const pluralKey=SELECT_TYPE_PLURAL_KEY[state.selectType]||"song";

  if(state.selectType==="playlists"){
    const label=plural(ids.length,pluralKey);
    if(!confirm(tr("confirm.deleteCountPlaylists",{label}))) return;
    ids.forEach(id=>{
      state.playlists=state.playlists.filter(p=>p.id!==id);
      idbDelete("playlists",id);
    });
  } else if(state.selectType==="folders"){
    const tracksToDelete=state.tracks.filter(t=>ids.includes(t.folderId));
    const trackCount=tracksToDelete.length;
    const label=plural(ids.length,pluralKey)
      + (trackCount ? tr("labelAnd")+plural(trackCount,"song") : "");
    if(!confirm(tr("confirm.deleteCountSongs",{label}))) return;
    notifyTracksDeleted(tracksToDelete);
    tracksToDelete.forEach(t=>removeTrackData(t));
    ids.forEach(id=>{
      state.folders=state.folders.filter(f=>f.id!==id);
      idbDelete("folders",id);
    });
  } else {
    const trackIds=getSelectedTrackIds();
    if(!trackIds.length) return;
    const label=plural(trackIds.length,"song");
    if(!confirm(tr("confirm.deleteCountSongs",{label}))) return;
    const tracksToDelete=trackIds.map(id=>state.tracks.find(t=>t.id===id)).filter(Boolean);
    notifyTracksDeleted(tracksToDelete);
    tracksToDelete.forEach(track=>removeTrackData(track));
    if(state.filter) state.filter.tracks=state.filter.tracks.filter(t=>!trackIds.includes(t.id));
  }

  state.selectMode=false;
  state.selectedIds.clear();
  selectToggle.classList.remove("active");
  renderTab();
}



function openAddSelectedToPlaylistModal(){
  const trackIds=getSelectedTrackIds();
  if(!trackIds.length) return;

  if(!state.playlists.length){
    openModal(tr("sel.addToPlaylist"), `<p class='info-empty'>${escapeHTML(tr("empty.noPlaylistsForAdd"))}</p>`);
    return;
  }

  const bodyHTML="<div class='add-music-list' id='selPlaylistList'>"+state.playlists.map(p=>{
    const allIn=trackIds.every(id=>p.trackIds.includes(id));
    return `<div class="add-music-row${allIn?" added":""}" data-playlist-id="${p.id}">
      <div class="amr-text">
        <div class="amr-title">${escapeHTML(p.name)}</div>
        <div class="amr-artist">${escapeHTML(plural(p.trackIds.length,"song"))}</div>
      </div>
      <button class="amr-add-btn" ${allIn?"disabled":""}>${allIn?escapeHTML(tr("btn.added")):escapeHTML(tr("btn.add"))}</button>
    </div>`;
  }).join("")+"</div>";

  const label=plural(trackIds.length,"song");
  openModal(tr("modal.addCountToPlaylist",{label}), bodyHTML);

  $("selPlaylistList").querySelectorAll(".add-music-row").forEach(row=>{
    const playlistId=row.dataset.playlistId;
    const addBtn=row.querySelector(".amr-add-btn");
    addBtn.addEventListener("click",()=>{
      trackIds.forEach(id=>addToPlaylist(playlistId,id));
      row.classList.add("added");
      addBtn.textContent=tr("btn.added");
      addBtn.disabled=true;
    });
  });
}

export {
  createPlaylistPrompt, openPlaylistMenu, addToPlaylist, openAddMusicModal,
  removeFromPlaylist, isInFavorites, toggleFavorite, notifyTracksDeleted, removeTrackData,
  deleteTrack, deleteSelectedItems, openAddSelectedToPlaylistModal,
  folderAndDescendantIds, openMoveItemModal
};
