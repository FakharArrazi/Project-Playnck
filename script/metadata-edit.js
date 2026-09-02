import { state, $, audioEl, idbPut } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, el } from "./utils.js";
import { openModal, closeModal } from "./modal.js";
import { filePathToURL, getTrackArtURL } from "./init.js";
import { sanitizeFilename } from "./metadata.js";
import { renderTab } from "./library-view.js";
import { updateNowPlayingUI } from "./now-playing-ui.js";

function openEditModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("edit.modalTitleEmpty"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingEdit"))}</p>`);
    return;
  }
  const originalArtURL=getTrackArtURL(t);

  let pendingArtFile=null;
  let removeArt=false;
  let coverCandidates=[];
  let coverCandidateIndex=0;
  let matchCandidates=[];

  const bodyHTML=`
    <div class="edit-form">
      <div class="edit-cover-row">
        <div class="edit-cover-preview" id="editCoverPreview">
          ${originalArtURL
            ? `<img id="editCoverImg" src="${originalArtURL}" alt="cover">`
            : `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`
          }
        </div>
        <div class="edit-cover-actions">
          <button type="button" class="edit-cover-btn" id="editCoverBtn">${escapeHTML(tr("edit.changeCover"))}</button>
          <button type="button" class="edit-cover-btn secondary" id="editCoverRemoveBtn">${escapeHTML(tr("edit.removeCover"))}</button>
          <input type="file" id="editCoverInput" accept="image/*" class="hidden">
        </div>
      </div>
      <div class="edit-cover-gallery hidden" id="editCoverGallery"></div>
      <div class="edit-autotag-row">
        <div class="edit-autotag-buttons">
          <button type="button" class="edit-autotag-btn" id="editAutoTagFingerprintBtn">${escapeHTML(tr("edit.autoTagFingerprint"))}</button>
          <button type="button" class="edit-autotag-btn" id="editAutoTagTextBtn">${escapeHTML(tr("edit.autoTagText"))}</button>
        </div>
        <p class="edit-autotag-status hidden" id="editAutoTagStatus"></p>
        <div class="edit-autotag-matches hidden" id="editAutoTagMatches"></div>
      </div>
      <div class="edit-field">
        <label class="edit-label" for="editTitleInput">${escapeHTML(tr("info.rowTitle"))}</label>
        <input type="text" class="edit-input" id="editTitleInput">
      </div>
      <div class="edit-field">
        <label class="edit-label" for="editArtistInput">${escapeHTML(tr("info.rowArtist"))}</label>
        <input type="text" class="edit-input" id="editArtistInput">
      </div>
      <div class="edit-field">
        <label class="edit-label" for="editAlbumInput">${escapeHTML(tr("info.rowAlbum"))}</label>
        <input type="text" class="edit-input" id="editAlbumInput">
      </div>
      <div class="edit-actions">
        <button type="button" class="edit-cancel-btn" id="editCancelBtn">${escapeHTML(tr("modal.cancel"))}</button>
        <button type="button" class="edit-save-btn" id="editSaveBtn">${escapeHTML(tr("edit.saveChanges"))}</button>
      </div>
      <p class="edit-status hidden" id="editStatus"></p>
    </div>`;

  openModal(tr("edit.modalTitle"), bodyHTML);

  $("editTitleInput").value=t.title||"";
  $("editArtistInput").value=t.artist||"";
  $("editAlbumInput").value=t.album||"";

  const coverInput=$("editCoverInput");
  const galleryEl=$("editCoverGallery");
  const matchesEl=$("editAutoTagMatches");

  function applyCoverCandidate(idx){
    if(!coverCandidates.length) return;
    coverCandidateIndex=((idx%coverCandidates.length)+coverCandidates.length)%coverCandidates.length;
    const candidate=coverCandidates[coverCandidateIndex];
    const bytes=candidate.data instanceof Uint8Array ? candidate.data : new Uint8Array(candidate.data);
    pendingArtFile=new File([bytes], "cover.jpg", { type: candidate.mime||"image/jpeg" });
    removeArt=false;
    const previewURL=URL.createObjectURL(pendingArtFile);
    $("editCoverPreview").innerHTML=`<img id="editCoverImg" src="${previewURL}" alt="cover">`;
    if(galleryEl){
      galleryEl.querySelectorAll(".edit-cover-thumb").forEach((el,i)=>{
        el.classList.toggle("selected", i===coverCandidateIndex);
      });
    }
  }

  function renderCoverGallery(images){
    coverCandidates=images||[];
    if(!galleryEl) return;
    if(coverCandidates.length<2){
      galleryEl.classList.add("hidden");
      galleryEl.innerHTML="";
    } else {
      galleryEl.innerHTML=coverCandidates.map((img,i)=>{
        const bytes=img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data);
        const url=URL.createObjectURL(new Blob([bytes],{type:img.mime||"image/jpeg"}));
        const label=img.releaseTitle ? `${img.releaseTitle}${img.releaseDate?" ("+img.releaseDate+")":""}` : "";
        return `<button type="button" class="edit-cover-thumb" data-idx="${i}" style="background-image:url('${url}')" title="${escapeHTML(label)}" aria-label="${escapeHTML(label||"cover option "+(i+1))}"></button>`;
      }).join("");
      galleryEl.classList.remove("hidden");
    }
    if(coverCandidates.length){
      applyCoverCandidate(0);
    } else {
      pendingArtFile=null;
      removeArt=false;
      $("editCoverPreview").innerHTML=originalArtURL
        ? `<img id="editCoverImg" src="${originalArtURL}" alt="cover">`
        : `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`;
    }
  }

  if(galleryEl){
    galleryEl.addEventListener("click",(e)=>{
      const btn=e.target.closest(".edit-cover-thumb");
      if(!btn) return;
      applyCoverCandidate(parseInt(btn.dataset.idx,10)||0);
    });
  }

  function applyMatch(idx){
    if(!matchCandidates.length) return;
    idx=Math.max(0,Math.min(idx,matchCandidates.length-1));
    const m=matchCandidates[idx];
    if(m.title) $("editTitleInput").value=m.title;
    if(m.artist) $("editArtistInput").value=m.artist;
    if(m.album) $("editAlbumInput").value=m.album;
    renderCoverGallery(m.images||[]);
  }

  function renderMatchOptions(matches){
    matchCandidates=matches||[];
    if(!matchesEl) return;
    if(matchCandidates.length<2){
      matchesEl.classList.add("hidden");
      matchesEl.innerHTML="";
      return;
    }
    const optionLabel=(m)=>[
      m.title||"?",
      m.artist,
      m.album ? (m.album+(m.year?" ("+m.year+")":"")) : null
    ].filter(Boolean).join(" — ");

    matchesEl.innerHTML=`
      <label class="edit-label" for="editAutoTagMatchSelect">${escapeHTML(tr("edit.autoTagPickMatch"))}</label>
      <select class="edit-input edit-autotag-select" id="editAutoTagMatchSelect">
        ${matchCandidates.map((m,i)=>`<option value="${i}">${escapeHTML(optionLabel(m))}</option>`).join("")}
      </select>`;
    matchesEl.classList.remove("hidden");
    $("editAutoTagMatchSelect").addEventListener("change",(e)=>applyMatch(parseInt(e.target.value,10)||0));
  }

  $("editCoverBtn").addEventListener("click",()=>coverInput.click());

  coverInput.addEventListener("change",()=>{
    const file=coverInput.files[0];
    if(!file) return;
    pendingArtFile=file;
    removeArt=false;
    coverCandidates=[];
    if(galleryEl){ galleryEl.classList.add("hidden"); galleryEl.innerHTML=""; }
    const previewURL=URL.createObjectURL(file);
    $("editCoverPreview").innerHTML=`<img id="editCoverImg" src="${previewURL}" alt="cover">`;
  });

  $("editCoverRemoveBtn").addEventListener("click",()=>{
    pendingArtFile=null;
    removeArt=true;
    coverCandidates=[];
    if(galleryEl){ galleryEl.classList.add("hidden"); galleryEl.innerHTML=""; }
    $("editCoverPreview").innerHTML=`<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`;
  });

  const autoTagFingerprintBtn=$("editAutoTagFingerprintBtn");
  const autoTagTextBtn=$("editAutoTagTextBtn");
  const autoTagStatus=$("editAutoTagStatus");
  const AUTOTAG_PROGRESS_KEY={fingerprint:"edit.autoTaggingFingerprint", text:"edit.autoTaggingText"};

  async function runAutoTag(mode){
    if(!(window.electronAPI && window.electronAPI.autoTagTrack && t.filePath)){
      autoTagStatus.classList.remove("hidden");
      autoTagStatus.textContent=tr("edit.autoTagUnavailable");
      return;
    }

    autoTagFingerprintBtn.disabled=true;
    autoTagTextBtn.disabled=true;
    autoTagStatus.classList.remove("hidden");
    autoTagStatus.textContent=tr(AUTOTAG_PROGRESS_KEY[mode]);
    if(matchesEl){ matchesEl.classList.add("hidden"); matchesEl.innerHTML=""; }

    const titleField=$("editTitleInput");
    const artistField=$("editArtistInput");
    const albumField=$("editAlbumInput");

    const artistHint=artistField.value.trim()||t.artist||"";
    const cleanArtistHint=/^unknown artist$/i.test(artistHint) ? "" : artistHint;

    const result=await window.electronAPI.autoTagTrack(t.filePath,{
      title: titleField.value.trim()||t.title||"",
      artist: cleanArtistHint
    }, mode).catch(err=>({found:false, reason:String((err&&err.message)||err)}));

    autoTagFingerprintBtn.disabled=false;
    autoTagTextBtn.disabled=false;

    if(!result || !result.found){
      autoTagStatus.textContent=tr("edit.autoTagNotFound",{reason:(result&&result.reason)||""});
      return;
    }

    if(result.title) titleField.value=result.title;
    if(result.artist) artistField.value=result.artist;
    if(result.album) albumField.value=result.album;

    renderMatchOptions(result.matches||[]);

    if(Array.isArray(result.images) && result.images.length){
      renderCoverGallery(result.images);
    }

    autoTagStatus.textContent=tr(result.source==="fingerprint" ? "edit.autoTagFoundFingerprint" : "edit.autoTagFoundMusicbrainz");
  }

  autoTagFingerprintBtn.addEventListener("click",()=>runAutoTag("fingerprint"));
  autoTagTextBtn.addEventListener("click",()=>runAutoTag("text"));

  $("editCancelBtn").addEventListener("click",closeModal);

  $("editSaveBtn").addEventListener("click",async()=>{
    const saveBtn=$("editSaveBtn");
    saveBtn.disabled=true;
    saveBtn.textContent=tr("edit.saving");

    const newTitle=$("editTitleInput").value.trim()||t.title;
    const newArtist=$("editArtistInput").value.trim()||t.artist;
    const newAlbum=$("editAlbumInput").value.trim()||t.album;

    async function applyToLibrary(){
      t.title=newTitle;
      t.artist=newArtist;
      t.album=newAlbum;

      if(pendingArtFile){
        if(t.artURL) URL.revokeObjectURL(t.artURL);
        t.artBlob=pendingArtFile;
        t.artURL=URL.createObjectURL(pendingArtFile);
      } else if(removeArt){
        if(t.artURL) URL.revokeObjectURL(t.artURL);
        t.artBlob=null;
        t.artURL=null;
      }

      if(t.external) t.external=false;
      const storeCopy={
        id:t.id, title:t.title, artist:t.artist, album:t.album,
        trackNum:t.trackNum,
        duration:t.duration, folderId:t.folderId, dateAdded:t.dateAdded,
        fileBlob:t.fileBlob, artBlob:t.artBlob, filePath:t.filePath
      };
      await idbPut("tracks",storeCopy);

      if(state.currentTrack && state.currentTrack.id===t.id) updateNowPlayingUI();
      renderTab();
    }

    const isRealFileTrack=!!(window.electronAPI && window.electronAPI.writeAudioTags && t.filePath);

    if(!isRealFileTrack){
      await applyToLibrary();
      closeModal();
      return;
    }

    let resumePlayback=null;
    const wasCurrentlyLoaded=!!(state.currentTrack && state.currentTrack.id===t.id && audioEl.src);
    if(wasCurrentlyLoaded){
      resumePlayback={ time: audioEl.currentTime, wasPlaying: !audioEl.paused };
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    }

    let imageData=null;
    if(pendingArtFile) imageData=await pendingArtFile.arrayBuffer();

    const result=await window.electronAPI.writeAudioTags(t.filePath,{
      title:newTitle, artist:newArtist, album:newAlbum,
      imageData, imageMime: pendingArtFile ? pendingArtFile.type : null,
      removeImage: removeArt
    }).catch(err=>({written:false, reason:String((err&&err.message)||err)}));

    const status=$("editStatus");
    const leftoverActions=$("editSaveLibraryOnlyBtn");
    if(leftoverActions) leftoverActions.closest(".edit-status-actions").remove();

    if(!(result && result.written)){
      saveBtn.disabled=false;
      saveBtn.textContent=tr("edit.saveChanges");

      if(wasCurrentlyLoaded){
        audioEl.src=t.fileURL;
        audioEl.currentTime=resumePlayback.time;
        if(resumePlayback.wasPlaying) audioEl.play().catch(()=>{});
      }

      if(status){
        status.classList.remove("hidden");
        status.classList.add("is-error");
        status.textContent=tr("edit.fileWriteFailed",{reason:(result && result.reason) || tr("edit.fileNotChanged")});

        const actionsRow=el("div","edit-status-actions");
        const libOnlyBtn=el("button","edit-lib-only-btn",escapeHTML(tr("edit.saveLibraryOnly")));
        libOnlyBtn.type="button";
        libOnlyBtn.id="editSaveLibraryOnlyBtn";
        libOnlyBtn.addEventListener("click",async()=>{
          libOnlyBtn.disabled=true;
          await applyToLibrary();
          status.classList.remove("is-error");
          status.textContent=tr("edit.savedLibraryOnlyConfirmed");
          actionsRow.remove();
          setTimeout(closeModal,1400);
        });
        actionsRow.appendChild(libOnlyBtn);
        status.insertAdjacentElement("afterend",actionsRow);
      }
      return;
    }

    let renameFailedReason=null;
    if(window.electronAPI.renameFile){
      const desiredBase=sanitizeFilename(`${newArtist} - ${newTitle}`);
      const renameResult=await window.electronAPI.renameFile(t.filePath,desiredBase)
        .catch(err=>({renamed:false, reason:String((err&&err.message)||err)}));
      if(renameResult && renameResult.renamed && renameResult.newPath){
        t.filePath=renameResult.newPath;
        t.fileURL=filePathToURL(t.filePath);
      } else {
        renameFailedReason=(renameResult && renameResult.reason) || tr("edit.couldntRenameGeneric");
      }
    }

    await applyToLibrary();

    if(wasCurrentlyLoaded){
      audioEl.src=t.fileURL;
      audioEl.currentTime=resumePlayback.time;
      if(resumePlayback.wasPlaying) audioEl.play().catch(()=>{});
    }

    if(status){
      status.classList.remove("hidden");
      status.classList.remove("is-error");
      if(result.imageIgnored){
        status.textContent=tr("edit.savedButNoCoverArtSupport");
      } else if(!renameFailedReason){
        status.textContent=tr("edit.savedRenamedAndUpdated");
      } else {
        status.textContent=tr("edit.savedTagsButNotRenamed",{reason:renameFailedReason});
      }
    }
    setTimeout(closeModal,1400);
  });
}

export { openEditModal };
