import { state, $ } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, fmtTime, formatBytes, formatBitrate, showWithMotion, hideWithMotion } from "./utils.js";
import { openModal, closeModal } from "./modal.js";

/* ================================================================
   SIDE MENU: INFO / EDIT / SYNC LYRICS
   The "☰" button in the top-right of the now-playing panel opens
   a small dropdown with three entries, all of which reuse one
   shared modal popup (openModal/closeModal):
     - Info: read-only details about the current song and its file
     - Edit: retag the current song (title/artist/album/cover)
     - Sync Lyrics: nudge lyric timing forward/backward in ms
   ================================================================ */

// Shows/hides the Info/Edit dropdown. Called on every click of the
// side-menu button, so clicking it again closes it (a normal
// toggle). e.stopPropagation() on the button (see bindEvents
// below) keeps that same click from also being seen as an
// "outside click" by closeSideDropdown's document listener.
function toggleSideDropdown(){
  const dd=$("sideDropdown");
  if(dd.classList.contains("hidden")) openSideDropdown();
  else closeSideDropdown();
}



// Reveals the Info/Edit dropdown and arms a one-time listener that
// closes it again on the next click anywhere on the page (the
// same "click outside to close" pattern used by closeMenu above).
function openSideDropdown(){
  showWithMotion($("sideDropdown"));
  setTimeout(()=>document.addEventListener("click",closeSideDropdown,{once:true}),0);
}



// Hides the Info/Edit dropdown.
function closeSideDropdown(){
  hideWithMotion($("sideDropdown"));
}
// Builds the "Info" modal content: everything we know about a
// song, plus details about its underlying audio file (name, type,
// size, and when it was added). Pass a specific track (e.g. from a
// song row's "⋮" menu) to show info for that song; called with no
// argument (e.g. from the player panel's side menu) it falls back
// to whatever's currently playing.
//
// Bitrate, File type, and File size: all three show instantly from
// whatever's available client-side (bitrate as a size/duration
// ESTIMATE, type/size read off the in-memory fileBlob if there is
// one) and, if running inside the Electron build with a real file
// path known, all three get swapped for accurate values read
// straight off disk once an async call to the main process resolves
// (see metadata-bridge.js — parses real MP3/FLAC/etc. frame headers
// via the music-metadata package, and stats the file for its real
// byte size). Path-backed tracks (see hydrateTrack()) don't keep a
// fileBlob at all, so without this upgrade those two rows would stay
// stuck on "Unknown" forever instead of just until the read resolves.
// Nothing here breaks or even changes on a non-Electron build — that
// whole branch is skipped when window.electronAPI isn't present.
function openInfoModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("info.modalTitleEmpty"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingInfo"))}</p>`);
    return;
  }

  const file=t.fileBlob;
  const folder=state.folders.find(f=>f.id===t.folderId);
  const estimatedBitrate=file ? formatBitrate(file.size, t.duration) : tr("common.unknown");
  // Path-backed tracks (see hydrateTrack()) don't carry a fileBlob
  // any more, so file name/type/size fall back to what can be read
  // off the path itself; size/bitrate get upgraded to the real
  // reading by the getAudioMetadata() call further down regardless.
  const fileNameFallback=t.filePath ? t.filePath.split(/[\\/]/).pop() : tr("common.unknown");

  // Each row is [label, value] — shown in this exact order. The
  // bitrate row gets a fixed id so we can upgrade its value in
  // place if an accurate reading comes back later.
  const rows=[
    [tr("info.rowTitle"), t.title],
    [tr("info.rowArtist"), t.artist],
    [tr("info.rowAlbum"), t.album],
    [tr("info.rowTrackNo"), t.trackNum!=null ? t.trackNum : tr("common.unknown")],
    [tr("info.rowDuration"), fmtTime(t.duration)],
    [tr("info.rowFolder"), folder ? folder.name : "—"],
    [tr("info.rowFileName"), (file && file.name) ? file.name : fileNameFallback],
    [tr("info.rowFileType"), (file && file.type) ? file.type : tr("common.unknown"), "infoFileTypeVal"],
    [tr("info.rowFileSize"), file ? formatBytes(file.size) : tr("common.unknown"), "infoFileSizeVal"],
    [tr("info.rowBitrate"), estimatedBitrate, "infoBitrateVal"],
    [tr("info.rowDateAdded"), t.dateAdded ? new Date(t.dateAdded).toLocaleString() : tr("common.unknown")]
  ];

  const bodyHTML="<div class='info-grid'>"+rows.map(([key,val,id])=>
    `<div class='info-row'><span class='info-key'>${escapeHTML(key)}</span><span class='info-val'${id?` id='${id}'`:""}>${escapeHTML(String(val))}</span></div>`
  ).join("")+"</div>";

  openModal(tr("info.modalTitle"), bodyHTML);

  // --- Electron-only upgrade: real bitrate from the file's actual
  // encoded stream, instead of the size/duration estimate above.
  // Also upgrades File type/File size for path-backed tracks, which
  // never carry a fileBlob (see the comment above) so those two rows
  // start out as "Unknown" and get filled in here once the real
  // values come back from disk. ---
  if(window.electronAPI && window.electronAPI.getAudioMetadata && t.filePath){
    window.electronAPI.getAudioMetadata(t.filePath).then(meta=>{
      if(!meta) return;

      if(meta.bitrate){
        const bitrateEl=$("infoBitrateVal");
        if(bitrateEl){
          const vbrTag=meta.lossless ? tr("info.lossless") : "";
          bitrateEl.textContent=meta.bitrate+" kb/s"+vbrTag;
        }
      }

      if(meta.mimeType){
        const typeEl=$("infoFileTypeVal");
        if(typeEl) typeEl.textContent=meta.mimeType;
      }

      if(typeof meta.fileSize==="number"){
        const sizeEl=$("infoFileSizeVal");
        if(sizeEl) sizeEl.textContent=formatBytes(meta.fileSize);
      }
    }).catch(()=>{ /* leave the estimates/"Unknown" showing — no real reading available */ });
  }
}

export { toggleSideDropdown, closeSideDropdown, openInfoModal };
