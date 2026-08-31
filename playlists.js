import { state, $, idbPut, idbDelete, audioEl, uid, selectToggle } from "./state.js";
import { tr, plural, SELECT_TYPE_PLURAL_KEY } from "./i18n.js";
import { escapeHTML, el, replayMotion } from "./utils.js";
import { renderTab, computeAlbums, computeArtists } from "./library-view.js";
import { closeMenu, setOpenMenuEl } from "./menus.js";
import { libraryTracks } from "./metadata.js";
import { openModal, closeModal } from "./modal.js";
import { resetShuffleNextPick } from "./queue.js";
import { refreshNextPreview, updateNowPlayingUI, updateLoveButton } from "./now-playing-ui.js";

/* ================================================================
   PLAYLISTS
   Creating playlists, and adding/removing individual tracks to
   and from them (including the special built-in Favorites list).
   ================================================================ */

// Stand-in for window.prompt(), which Electron's renderer never
// implements — unlike alert()/confirm(), which show a real native
// dialog, prompt() silently does nothing and the call returns right
// away with no dialog ever appearing on screen (this has been true
// since Electron's earliest releases: https://github.com/electron/electron/issues/472).
// Every call site that used to call prompt() for a text value
// (new playlist name, rename playlist, rename folder) now calls
// this instead. Reuses the same modal overlay and .edit-* styling
// as the Edit Track modal so it looks native to the app. Resolves
// with the trimmed text, or null if the user cancels/submits empty.
function promptModal(title, label, defaultValue){
  return new Promise(resolve=>{
    const bodyHTML=`
      <div class="edit-form">
        <div class="edit-field">
          <label class="edit-label" for="promptModalInput">${escapeHTML(label)}</label>
          <input type="text" class="edit-input" id="promptModalInput" autocomplete="off">
        </div>
        <div class="edit-actions">
          <button type="button" class="edit-cancel-btn" id="promptModalCancelBtn">${escapeHTML(tr("modal.cancel"))}</button>
          <button type="button" class="edit-save-btn" id="promptModalOkBtn">${escapeHTML(tr("modal.ok"))}</button>
        </div>
      </div>`;
    openModal(title, bodyHTML);

    const input=$("promptModalInput");
    input.value=defaultValue||"";
    input.focus();
    input.select();

    let settled=false;
    function finish(value){
      if(settled) return;
      settled=true;
      $("modalCloseBtn").removeEventListener("click",onOutsideCancel);
      $("modalOverlay").removeEventListener("click",onOverlayClick);
      closeModal();
      resolve(value);
    }
    function onOutsideCancel(){ finish(null); }
    function onOverlayClick(e){ if(e.target.id==="modalOverlay") finish(null); }

    $("promptModalCancelBtn").addEventListener("click",()=>finish(null));
    $("promptModalOkBtn").addEventListener("click",()=>finish(input.value.trim()||null));
    input.addEventListener("keydown",(e)=>{
      if(e.key==="Enter"){ e.preventDefault(); finish(input.value.trim()||null); }
      else if(e.key==="Escape"){ e.preventDefault(); finish(null); }
    });
    // Also resolve (as a cancel) if the modal gets closed via the
    // "✕" button or by clicking the dark backdrop, so the promise
    // never hangs unresolved.
    $("modalCloseBtn").addEventListener("click",onOutsideCancel);
    $("modalOverlay").addEventListener("click",onOverlayClick);
  });
}



// Prompts the user for a playlist name and creates it. If
// trackIdToAdd is given (e.g. from the "+ New playlist" option
// inside a song's "⋮" menu), that track is added to it immediately.
async function createPlaylistPrompt(trackIdToAdd){
  const name=await promptModal(tr("prompt.newPlaylistTitle"),tr("prompt.playlistNameLabel"));
  if(!name) return;
  const p={id:uid(),name,trackIds:trackIdToAdd?[trackIdToAdd]:[]};
  state.playlists.push(p);
  idbPut("playlists",p);
  renderTab();
}



// Opens the "⋮" menu for a single playlist row (Rename /
// Delete). Reuses the exact same ".ctx-menu" popup styling and
// single-menu-at-a-time behavior as openTrackMenu()/openSortMenu().
function openPlaylistMenu(e,playlist){
  closeMenu();
  const menu=el("div","ctx-menu");

  const renameBtn=el("button","",tr("playlist.rename"));
  renameBtn.addEventListener("click",()=>{ closeMenu(); renamePlaylist(playlist); });
  menu.appendChild(renameBtn);

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



// Prompts for a new name and renames the playlist in place.
async function renamePlaylist(playlist){
  const name=await promptModal(tr("prompt.renamePlaylistTitle"),tr("prompt.playlistNameLabel"),playlist.name);
  if(!name) return;
  playlist.name=name;
  idbPut("playlists",playlist);
  renderTab();
}



// Confirms, then removes the playlist entirely (its tracks
// stay in the library — only the playlist itself is deleted).
function deletePlaylist(playlist){
  if(!confirm(tr("confirm.deleteNamed",{name:playlist.name}))) return;
  state.playlists=state.playlists.filter(p=>p.id!==playlist.id);
  idbDelete("playlists",playlist.id);
  // If the person is currently looking inside the playlist that
  // was just deleted, back out to the Playlists list instead of
  // showing a now-broken filtered view.
  if(state.filter&&state.filter.type==="playlist"&&state.filter.playlistId===playlist.id){
    state.filter=null;
  }
  renderTab();
}



// Exports a playlist as a standard Extended M3U (.m3u8) file — just
// file-path references, not the actual audio — so it opens directly
// in VLC/Winamp/foobar2000/etc, or can be re-imported into another
// player entirely. Electron-only (needs a native Save dialog and a
// real path per track). Tracks with no filePath (picked via a plain
// <input type=file>/drag-drop with nothing real on disk behind them
// — see hydrateTrack()) can't be referenced this way and are skipped,
// with a count reported back so the person knows some were left out
// rather than silently getting a shorter playlist than expected.
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



// Adds a track to a playlist (no-op if it's already in there).
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



// Opens the shared modal with a full list of every song in the
// library so the user can add any of them to the given playlist.
// Rows already in the playlist show a disabled "Added" state;
// clicking "Add" on any other row adds it immediately and flips
// that row to "Added" too, without closing the modal — so several
// songs can be added in one go.
function openAddMusicModal(playlistId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;

  if(!libraryTracks().length){
    openModal(tr("modal.addMusic"), `<p class='info-empty'>${escapeHTML(tr("empty.noLibraryForAddMusic"))}</p>`);
    return;
  }

  const sorted=libraryTracks().sort((a,b)=>a.title.localeCompare(b.title));
  const bodyHTML="<div class='add-music-list' id='addMusicList'>"+sorted.map(t=>{
    const already=p.trackIds.includes(t.id);
    return `<div class="add-music-row${already?" added":""}" data-track-id="${t.id}">
      <div class="amr-text">
        <div class="amr-title">${escapeHTML(t.title)}</div>
        <div class="amr-artist">${escapeHTML(t.artist)}</div>
      </div>
      <button class="amr-add-btn" ${already?"disabled":""}>${already?escapeHTML(tr("btn.added")):escapeHTML(tr("btn.add"))}</button>
    </div>`;
  }).join("")+"</div>";

  openModal(tr("modal.addMusicToNamed",{name:p.name}), bodyHTML);

  // Wire up each row's Add button after the HTML is in the DOM.
  $("addMusicList").querySelectorAll(".add-music-row").forEach(row=>{
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




// Removes a track from a playlist, and — if that playlist is the
// one currently being viewed — updates the on-screen list too.
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



// True if a track is currently inside the Favorites playlist.
function isInFavorites(track){
  const fav=state.playlists.find(p=>p.id===state.favoritesId);
  return fav && fav.trackIds.includes(track.id);
}



// Adds/removes a track from Favorites and refreshes the heart icon.
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



// The heart's reaction to actually being toggled by the user (as
// opposed to updateLoveButton() elsewhere just silently syncing its
// resting state on a track change) — liking sends it up on a bouncy
// overshoot with a little scatter of hearts/sparks; unliking lets it
// visibly droop and sag back down instead.
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

// Scatters a handful of tiny hearts/sparks off the Love button that
// float up and fade, each on a slightly randomized drift/rotation/
// delay so the burst doesn't look mechanically identical every time.
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
    setTimeout(()=>spark.remove(),900); // fail-safe in case animationend doesn't fire
  });
}



// Fires a plain DOM event listing the real disk paths of tracks
// that are being PERMANENTLY deleted (not just removed from the
// library). Called only from actual "Delete" actions (deleteTrack,
// deleteFolder, and the bulk "Delete" selection below) — deliberately
// NOT from forgetFolder(), which only ever removes library entries
// and must leave files on disk untouched.
//
// This is a generic, platform-agnostic hook: it doesn't reference
// window.electronAPI or anything Electron-specific, and is a no-op
// with zero listeners on a web/Android build. Right now only
// renderer-bridge.js listens for it, to send those files to the
// Recycle Bin/Trash on Electron.
function notifyTracksDeleted(tracks){
  const paths=tracks.map(t=>t.filePath).filter(Boolean);
  if(paths.length) document.dispatchEvent(new CustomEvent("playnck:tracks-deleted",{detail:{paths}}));
}



// Shared cleanup used by both deleteTrack() (single song,
// below) and deleteFolder() (a whole batch of songs at once, see
// the FOLDERS section further down): strips the track out of
// every playlist it's in, out of the current play queue, stops
// playback if it's the track currently loaded, and removes it
// from both the in-memory library and IndexedDB. Doesn't confirm
// or re-render — callers are responsible for both.
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
    // Any memoized shuffle pick (see shuffleNextPick above) stored a
    // raw queue *index* — if the removed track sat before that index,
    // the number now points at a different track entirely. Safer to
    // just force a fresh roll than risk a wrong-but-in-range index.
    resetShuffleNextPick();
    refreshNextPreview();
  }

  // Release its temporary blob: URLs — nothing else is using them
  // once the track record itself is gone.
  if(track.fileURL) URL.revokeObjectURL(track.fileURL);
  if(track.artURL) URL.revokeObjectURL(track.artURL);

  state.tracks=state.tracks.filter(t=>t.id!==track.id);
  idbDelete("tracks",track.id);
  idbDelete("lyrics",track.id).catch(()=>{});
}



// Permanently deletes a single track from the library, after
// confirming with the user first since this can't be undone.
function deleteTrack(track){
  if(!confirm(tr("confirm.deleteNamed",{name:track.title}))) return;
  notifyTracksDeleted([track]);
  removeTrackData(track);
  // If we're currently drilled into a view that included this
  // track (album/artist/playlist/folder), drop it from there too.
  if(state.filter) state.filter.tracks=state.filter.tracks.filter(t=>t.id!==track.id);
  renderTab();
}



// Resolves the currently checked ids into an actual list of track
// ids to act on, based on what kind of thing is selected:
//   track   -> the checked ids ARE track ids already
//   albums  -> every track belonging to each checked album
//   artists -> every track belonging to each checked artist
//   folders -> every track belonging to each checked folder
//   playlists -> not applicable (a playlist selection acts on the
//                playlists themselves, never on their songs — see
//                deleteSelectedItems())
// Used by both the bulk "Delete" and "Add to Playlist" actions so
// selecting 3 albums and hitting Delete removes every song in them,
// the same way selecting songs directly would.
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



// Permanently deletes everything currently checked (the selection
// bar's "Delete" button), with wording and behavior that adapt to
// what's actually selected:
//   track/albums/artists -> deletes every underlying song
//   folders   -> deletes the folders AND every song inside them
//                (same as the per-folder "Delete folder" menu entry)
//   playlists -> deletes just the playlists themselves; their songs
//                stay in the library, same as the per-playlist
//                "Delete" menu entry
// Same one-time confirmation pattern throughout, then drops out of
// select mode and refreshes the list.
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



// Opens a modal listing every playlist so the checked songs (or,
// for an album/artist/folder selection, every song inside those)
// can be added to one in a single tap (the selection bar's "Add to
// Playlist" button — hidden entirely when selecting playlists,
// since adding a playlist "to a playlist" isn't a real action).
// Reuses the same visual style as the per-song "Add to Playlist"
// submenu, but each row adds ALL resolved tracks at once and the
// modal stays open so you can add to more than one playlist before
// closing it.
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
  promptModal, createPlaylistPrompt, openPlaylistMenu, addToPlaylist, openAddMusicModal,
  removeFromPlaylist, isInFavorites, toggleFavorite, notifyTracksDeleted, removeTrackData,
  deleteTrack, deleteSelectedItems, openAddSelectedToPlaylistModal
};
