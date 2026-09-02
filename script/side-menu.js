import { state, $ } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, fmtTime, formatBytes, formatBitrate, showWithMotion, hideWithMotion } from "./utils.js";
import { openModal, closeModal } from "./modal.js";


function toggleSideDropdown(){
  const dd=$("sideDropdown");
  if(dd.classList.contains("hidden")) openSideDropdown();
  else closeSideDropdown();
}



function openSideDropdown(){
  showWithMotion($("sideDropdown"));
  setTimeout(()=>document.addEventListener("click",closeSideDropdown,{once:true}),0);
}



function closeSideDropdown(){
  hideWithMotion($("sideDropdown"));
}
function openInfoModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("info.modalTitleEmpty"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingInfo"))}</p>`);
    return;
  }

  const file=t.fileBlob;
  const folder=state.folders.find(f=>f.id===t.folderId);
  const estimatedBitrate=file ? formatBitrate(file.size, t.duration) : tr("common.unknown");
  const fileNameFallback=t.filePath ? t.filePath.split(/[\\/]/).pop() : tr("common.unknown");

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
    }).catch(()=>{   });
  }
}

export { toggleSideDropdown, closeSideDropdown, openInfoModal };
