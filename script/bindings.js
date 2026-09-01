import { $, state, searchInput, searchRow, playerPanel, backBtn, searchToggle,
  locatePlayingToggle, addMusicToggle, selectToggle, volumeBtn, volumeSlider } from "./state.js";
import { ingestFiles, libraryTracks } from "./metadata.js";
import { pulseCtrlBtn, debounce } from "./utils.js";
import { renderTab, toggleSelectMode, scrollToNowPlaying } from "./library-view.js";
import { closeSideDropdown, toggleSideDropdown, openInfoModal } from "./side-menu.js";
import { togglePlay, nextTrack, prevTrack, playTrack, seekBy } from "./player.js";
import { closeModal, openModal } from "./modal.js";
import { adjustVolume, setVolume, toggleMute, toggleVolumePopup } from "./volume.js";
import { wireDragAndDropPlay } from "./drag-drop.js";
import { addFilesToConvertQueue, handleConvertProgressTick } from "./convert.js";
import { openSortMenu } from "./menus.js";
import { openAddMusicModal, toggleFavorite, deleteSelectedItems, openAddSelectedToPlaylistModal } from "./playlists.js";
import { resetShuffleNextPick } from "./queue.js";
import { cycleRepeatMode, refreshNextPreview } from "./now-playing-ui.js";
import { toggleLyrics, openSyncModal } from "./lyrics.js";
import { openSettingsModal } from "./settings.js";
import { openAboutModal } from "./backup.js";
import { openSleepTimerModal } from "./sleep-timer.js";
import { openEditModal } from "./metadata-edit.js";

/* ================================================================
   NAV RAIL: expand/collapse + Settings / About Us
   The "☰" button at the top of the far-left icon rail toggles the
   "rail-expanded" class on #appRoot. That one class is all the CSS
   needs (see .rail / .rail-label / .app.rail-expanded in the
   stylesheet) to widen the rail's grid column and fade each
   section's text label into view next to its icon. Settings/About
   Us reuse the same shared modal (openModal/closeModal) as the
   Info/Edit side menu below.
   ================================================================ */

function toggleRail(){
  $("appRoot").classList.toggle("rail-expanded");
}

/* ================================================================
   EVENTS / BINDINGS
   Wires up every static button/input in the page (one time, on
   startup) to the functions above. Buttons that are re-created on
   every render — like the per-song "⋮" menu or the Folders tab's
   "Add Songs"/"Add Folder" buttons — get their listeners attached
   inline where they're created instead of here.
   ================================================================ */
function bindEvents(){

  // --- Global playback shortcuts ---
  // Without this, these keys normally do whatever the
  // currently-focused element defines (click a focused button,
  // scroll the page, move a text cursor, etc.) — so the same key
  // press could mean different things depending on where you'd last
  // clicked. This intercepts all of them everywhere and makes them
  // ALWAYS mean the same thing, with one shared exception: typing in
  // a text field (search box, rename inputs, Edit modal fields, ...)
  // is left completely alone, same as the original Space-only
  // version of this handler.
  //
  //   Space                        play / pause (unchanged from before)
  //   M                             mute / unmute
  //   ArrowUp / ArrowDown           volume up / down, 5 percentage points per press
  //   ArrowLeft / ArrowRight        seek back / forward 5 seconds
  //   Ctrl/Cmd+ArrowLeft/ArrowRight previous / next track
  //
  // Space and M are one-shot toggles, so (like the original Space
  // handler) they ignore key-repeat from a held-down key. The arrow
  // shortcuts deliberately do NOT ignore repeat — holding Right to
  // scrub forward or holding Up to ramp the volume up is normal,
  // expected behavior for those.
  document.addEventListener("keydown",(e)=>{
    const t=e.target;
    const isTyping = t && (t.tagName==="INPUT" || t.tagName==="TEXTAREA" || t.isContentEditable);
    if(isTyping) return;

    if((e.code==="Space" || e.key===" ") && !e.repeat){
      e.preventDefault();     // stop the browser's default space behavior (button click, page scroll)
      togglePlay();
      return;
    }

    if(e.code==="KeyM" && !e.repeat){
      e.preventDefault();
      toggleMute();
      return;
    }

    if(e.code==="ArrowUp"){
      e.preventDefault();     // stop the page from scrolling
      adjustVolume(0.05);
      return;
    }
    if(e.code==="ArrowDown"){
      e.preventDefault();
      adjustVolume(-0.05);
      return;
    }

    if(e.code==="ArrowRight"){
      e.preventDefault();
      if(e.ctrlKey || e.metaKey) nextTrack(false);
      else seekBy(5);
      return;
    }
    if(e.code==="ArrowLeft"){
      e.preventDefault();
      if(e.ctrlKey || e.metaKey) prevTrack();
      else seekBy(-5);
      return;
    }
  });


  // --- Nav rail: switch which list is shown ---
  document.querySelectorAll(".rail-item[data-tab]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".rail-item[data-tab]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      state.currentTab=btn.dataset.tab;
      state.filter=null;
      state.playlistFolderId=null; // always land on the Playlists tab's root, same as every other tab resetting to its own top level
      searchInput.value="";
      renderTab();
    });
  });


  // --- Back button + search toggle/input ---
  // Two things can be "backed out of" on the Playlists tab: a
  // drilled-into playlist's song list (state.filter, same as
  // albums/artists/library folders), or a nested playlist folder
  // (state.playlistFolderId, which has no such filter). A song list
  // always backs out to whichever of those it was opened from, so
  // clearing state.filter first and falling through to
  // playlistFolderId naturally lands back on the right folder.
  backBtn.addEventListener("click",()=>{
    if(state.filter){
      state.filter=null;
    } else if(state.currentTab==="playlists" && state.playlistFolderId){
      const current=state.playlistFolders.find(f=>f.id===state.playlistFolderId);
      state.playlistFolderId=current ? (current.parentId||null) : null;
    }
    searchInput.value="";
    renderTab();
  });
  searchToggle.addEventListener("click",()=>{
    searchRow.classList.toggle("hidden");
    if(!searchRow.classList.contains("hidden")) searchInput.focus();
    else { searchInput.value=""; renderTab(); }
  });
  searchInput.addEventListener("input",debounce(renderTab,120));


  // --- Locate button scrolls the list to the currently playing song ---
  locatePlayingToggle.addEventListener("click",scrollToNowPlaying);


  // --- Sort button opens the sort-order menu ---
  $("sortToggle").addEventListener("click",(e)=>{ e.stopPropagation(); openSortMenu(e); });


  // --- Add-music button (only visible inside a playlist view) ---
  addMusicToggle.addEventListener("click",()=>{
    if(state.filter && state.filter.type==="playlist") openAddMusicModal(state.filter.playlistId);
  });


  // --- Select button + bulk-action bar (Add to Playlist / Delete / Cancel) ---
  selectToggle.addEventListener("click",toggleSelectMode);
  $("selCancelBtn").addEventListener("click",toggleSelectMode);
  $("selDeleteBtn").addEventListener("click",deleteSelectedItems);
  $("selAddPlaylistBtn").addEventListener("click",openAddSelectedToPlaylistModal);


  // --- Drag a file onto the app anywhere -> add it (if new) and
  // start playing it immediately. See wireDragAndDropPlay() below. ---
  wireDragAndDropPlay();


  // --- Hidden file inputs (now triggered from the Folders tab) ---
  $("filesInput").addEventListener("change",(e)=>{ ingestFiles(e.target.files,null); e.target.value=""; });
  $("folderInput").addEventListener("change",(e)=>{
    const files=e.target.files;
    if(!files.length){ e.target.value=""; return; }
    let folderName="Folder";
    const rel=files[0].webkitRelativePath;
    if(rel) folderName=rel.split("/")[0];
    ingestFiles(files,folderName);
    e.target.value="";
  });

  // Convert tab's "Browse Files" — see CONVERT TAB above. Deliberately
  // NOT ingestFiles(): this never touches the music library.
  $("convertFilesInput").addEventListener("change",(e)=>{
    const files=e.target.files;
    if(files.length) addFilesToConvertQueue(files);
    e.target.value="";
  });


  // --- Transport controls (desktop player panel) ---
  // Every button here besides #playBtn also gets a small "alive"
  // flourish via pulseCtrlBtn() — see the TRANSPORT ROW comment in
  // styles.css. #playBtn is untouched, per its own liquid-glass morph.
  $("playBtn").addEventListener("click",togglePlay);
  $("nextBtn").addEventListener("click",()=>{ pulseCtrlBtn("nextBtn","skip-kick",380,"ctrl-streak"); nextTrack(false); });
  $("prevBtn").addEventListener("click",()=>{ pulseCtrlBtn("prevBtn","skip-kick",380,"ctrl-streak"); prevTrack(); });
  $("shuffleBtn").addEventListener("click",()=>{
    state.shuffle=!state.shuffle;
    if(!state.shuffle) state.shuffleHistory=[];   // turning shuffle off invalidates the retrace trail
    // The shuffle pick memoized in resolveNextIndex() (see
    // shuffleNextPick above) was only ever valid for "shuffle was ON,
    // for this current track" — it's now stale either way (shuffle
    // just turned off, so it no longer applies at all; or just turned
    // on, and Test 3 expects a genuinely fresh roll rather than
    // silently reusing whatever the last roll happened to be, since
    // the memo's forId key wouldn't have changed). Clearing it here
    // forces the very next resolveNextIndex() call to recalculate
    // from scratch instead of returning a leftover value.
    resetShuffleNextPick();
    $("shuffleBtn").classList.toggle("active",state.shuffle);
    pulseCtrlBtn("shuffleBtn","shuffle-spin",520);
    refreshNextPreview(); // this is the actual fix — see refreshNextPreview()'s comment for why it was missing before
  });
  $("repeatBtn").addEventListener("click",()=>{ cycleRepeatMode(); pulseCtrlBtn("repeatBtn","repeat-flip",520); });
  $("lyricsBtn").addEventListener("click",toggleLyrics);
  $("loveBtn").addEventListener("click",()=>{ if(state.currentTrack){ toggleFavorite(state.currentTrack); } });


  // --- Transport controls (mobile mini-player bar) ---
  $("miniPlay").addEventListener("click",togglePlay);
  $("miniNext").addEventListener("click",()=>{ pulseCtrlBtn("miniNext","skip-kick",380,"ctrl-streak"); nextTrack(false); });
  $("miniPrev").addEventListener("click",()=>{ pulseCtrlBtn("miniPrev","skip-kick",380,"ctrl-streak"); prevTrack(); });


  // --- Mobile now-playing overlay open/close ---
  $("miniInfo").addEventListener("click",()=>playerPanel.classList.add("expanded"));
  $("closeOverlay").addEventListener("click",()=>playerPanel.classList.remove("expanded"));


  // --- App menu (☰) with its Settings / About Us dropdown entries ---
  $("railToggle").addEventListener("click",(e)=>{ e.stopPropagation(); toggleRail(); });
  $("railSettingsBtn").addEventListener("click",openSettingsModal);
  $("railAboutBtn").addEventListener("click",openAboutModal);


  // --- Side menu (☰) with its Info / Edit dropdown entries ---
  $("sideMenuBtn").addEventListener("click",(e)=>{ e.stopPropagation(); toggleSideDropdown(); });
  $("menuInfoBtn").addEventListener("click",()=>{ closeSideDropdown(); openInfoModal(); });
  $("menuEditBtn").addEventListener("click",()=>{ closeSideDropdown(); openEditModal(); });
  $("menuSyncBtn").addEventListener("click",()=>{ closeSideDropdown(); openSyncModal(); });
  $("menuSleepBtn").addEventListener("click",()=>{ closeSideDropdown(); openSleepTimerModal(); });


  // --- Volume button + its vertical slider popup ---
  volumeBtn.addEventListener("click",(e)=>{ e.stopPropagation(); toggleVolumePopup(); });
  volumeSlider.addEventListener("input",(e)=>{ setVolume(e.target.value/100); });


  // --- Info/Edit modal close (✕ button, or clicking the dark backdrop) ---
  $("modalCloseBtn").addEventListener("click",closeModal);
  $("modalOverlay").addEventListener("click",(e)=>{ if(e.target.id==="modalOverlay") closeModal(); });
}



/* ================================================================
   DESKTOP "OPEN WITH" INTEGRATION (Electron only)
   Guarded behind window.electronAPI so this block is a total no-op
   on any build that isn't Electron (a plain browser tab, a future
   Android/Capacitor wrapper, etc.) — nothing here runs unless the
   preload script exposed the bridge.

   When the OS hands the app an audio file (double-click, "Open
   with", drag onto the .exe/.app, second-instance on Windows), main.js
   reads it and sends {name, mime, data} over IPC. We rebuild that
   into a real File object and feed it through the same ingestFiles()/
   playTrack() path used for manually added songs — but with
   persist:false, so it plays immediately like any other track
   without being written into the Songs library. If it's already a
   real library track, ingestFiles() just hands back that existing
   (persisted) entry as usual, per its duplicate guard. See
   ingestFiles()/libraryTracks() further up for the full picture.
   ================================================================ */
if(window.electronAPI){
  window.electronAPI.onOpenFile(async (payload)=>{
    if(!payload || !payload.data) return;

    const bytes = payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data);
    const file = new File([bytes], payload.name, {type: payload.mime});
    // This File was rebuilt from raw bytes, so webUtils.getPathForFile()
    // can't resolve it (see resolveFilePath() further up) — stash the
    // real path main.js already knew about directly on the object.
    if(payload.path) file.__electronPath=payload.path;

    // ingestFiles() now hands back the track it actually ended up
    // with for this file - either a brand-new, temporary/unpersisted
    // one (persist:false — see its comment), or the existing library
    // track it matched. Either way we just play that, so reopening a
    // song you already have plays your existing copy instead of
    // adding (and playing) a duplicate.
    const [track] = await ingestFiles([file], null, {persist:false});

    if(track){
      playTrack(track, [track]);
    } else {
      console.warn("Opened file wasn't a supported audio file, ignoring:", payload.name);
    }
  });

  // Convert tab — see startFFmpegInstall()/the Conversion Manager
  // (startConversion()) above. Both of these are pure event streams:
  // the matching ffmpegInstall()/convertFile() calls already resolve
  // once each with a final result, this is just the "here's what's
  // happening right now" updates in between.
  window.electronAPI.onFFmpegInstallProgress(({line})=>{
    if(line==null) return;
    state.convert.installLog.push(line);
    if(state.currentTab==="convert" && state.convert.ffmpegStatus==="installing") renderTab();
  });
  window.electronAPI.onConvertProgress(handleConvertProgressTick);
}

export { bindEvents };
