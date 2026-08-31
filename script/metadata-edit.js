import { state, $, audioEl, idbPut } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, el } from "./utils.js";
import { openModal, closeModal } from "./modal.js";
import { filePathToURL, getTrackArtURL } from "./init.js";
import { sanitizeFilename } from "./metadata.js";
import { renderTab } from "./library-view.js";
import { updateNowPlayingUI } from "./now-playing-ui.js";

// Builds the "Edit" modal: lets the user retag a track — change
// its title, artist, album, and cover art. Pass a specific track
// (e.g. from a song row's "⋮" menu) to edit that song; called with
// no argument (e.g. from the player panel's side menu) it falls
// back to whatever's currently playing. Holds the picked cover
// file (if any) in a closure variable until Save is clicked, so
// nothing is written to the track/DB until the user confirms.
function openEditModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("edit.modalTitleEmpty"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingEdit"))}</p>`);
    return;
  }
  const originalArtURL=getTrackArtURL(t);

  let pendingArtFile=null;   // newly picked cover image, staged until Save
  let removeArt=false;       // true if the user chose to remove the cover
  let coverCandidates=[];    // cover options for whichever match is selected, for the gallery
  let coverCandidateIndex=0;
  let matchCandidates=[];    // every song Auto-tag found plausible, for the match dropdown

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

  // Set values via .value instead of baking them into the HTML
  // above, so quotes/special characters in existing tags never
  // need escaping into an attribute.
  $("editTitleInput").value=t.title||"";
  $("editArtistInput").value=t.artist||"";
  $("editAlbumInput").value=t.album||"";

  const coverInput=$("editCoverInput");
  const galleryEl=$("editCoverGallery");
  const matchesEl=$("editAutoTagMatches");

  // Applies cover candidate #idx from whatever match is currently
  // selected as the preview/pendingArtFile, and highlights the
  // matching thumbnail in the gallery. Shared by the initial
  // Auto-tag result, every subsequent match selection, and clicking
  // a different thumbnail directly.
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

  // Renders the cover options for whichever match is currently
  // selected as clickable thumbnails, so the user can pick the right
  // one directly instead of committing to whatever came back first.
  // Hidden entirely when there's nothing to choose between (0 or 1
  // image) — the single image, if any, is still applied as the
  // preview via applyCoverCandidate(0) below.
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
      // This match didn't turn up any cover art of its own — fall
      // back to the track's original cover (if any) instead of
      // leaving a previous match's cover on screen, which would no
      // longer correspond to the song now selected.
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

  // Applies candidate match #idx (a whole title/artist/album + cover
  // set) to the form fields and gallery — used both for the initial
  // best guess and whenever the user picks a different option from
  // the dropdown below.
  function applyMatch(idx){
    if(!matchCandidates.length) return;
    idx=Math.max(0,Math.min(idx,matchCandidates.length-1));
    const m=matchCandidates[idx];
    if(m.title) $("editTitleInput").value=m.title;
    if(m.artist) $("editArtistInput").value=m.artist;
    if(m.album) $("editAlbumInput").value=m.album;
    renderCoverGallery(m.images||[]);
  }

  // Renders the "which song is it?" dropdown when Auto-tag found
  // more than one plausible match (ambiguous fingerprint hit, or
  // several confident title/artist search results) — hidden when
  // there's only one, since there's nothing to choose between.
  function renderMatchOptions(matches){
    matchCandidates=matches||[];
    if(!matchesEl) return;
    if(matchCandidates.length<2){
      matchesEl.classList.add("hidden");
      matchesEl.innerHTML="";
      return;
    }
    // "Song — Artist — Album (Year)" — album gets its own clearly
    // visible segment rather than being buried in parentheses, since
    // with several candidates for the same song, the album (which
    // release/edition it is) is usually the only thing actually
    // telling them apart — see the fingerprint-tier fix in
    // autotag-bridge.js's acoustidLookup(), which is what makes
    // m.album reliably populated for fingerprint matches too now,
    // not just text-search ones.
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
    coverCandidates=[]; // manual pick overrides whatever Auto-tag found
    if(galleryEl){ galleryEl.classList.add("hidden"); galleryEl.innerHTML=""; }
    const previewURL=URL.createObjectURL(file);
    $("editCoverPreview").innerHTML=`<img id="editCoverImg" src="${previewURL}" alt="cover">`;
  });

  $("editCoverRemoveBtn").addEventListener("click",()=>{
    pendingArtFile=null;
    removeArt=true;
    coverCandidates=[]; // manual removal overrides whatever Auto-tag found
    if(galleryEl){ galleryEl.classList.add("hidden"); galleryEl.innerHTML=""; }
    $("editCoverPreview").innerHTML=`<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`;
  });

  // --- Auto-tag: identify the song and fill in title/artist/album
  // (+ cover, if one was found) for the user to review before Save.
  // Nothing is written anywhere until Save is clicked — this only
  // populates the same form fields/pendingArtFile the user could've
  // filled in by hand. Electron-only (needs a real file on disk to
  // fingerprint or a running main process to talk to the lookup
  // APIs); on plain web the buttons explain that instead of trying.
  //
  // Two separate buttons/tiers instead of one combined Auto-tag
  // button: "identify from audio" (fingerprint only) and "search by
  // title/artist" (MusicBrainz text search only) — each runs just its
  // own tier via autoTagTrack's mode param, so a fingerprint miss is
  // reported as a miss instead of silently turning into a (less
  // trustworthy) text-search guess the user didn't ask for, and the
  // text search can be re-run on demand after editing the
  // title/artist fields without re-fingerprinting the file.
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

    // Disable both buttons while either is running — they share the
    // same form fields/matchCandidates/coverCandidates state, so
    // letting one fire mid-flight of the other would race.
    autoTagFingerprintBtn.disabled=true;
    autoTagTextBtn.disabled=true;
    autoTagStatus.classList.remove("hidden");
    autoTagStatus.textContent=tr(AUTOTAG_PROGRESS_KEY[mode]);
    if(matchesEl){ matchesEl.classList.add("hidden"); matchesEl.innerHTML=""; }

    const titleField=$("editTitleInput");
    const artistField=$("editArtistInput");
    const albumField=$("editAlbumInput");

    // guessFromName() (used at import time for untagged files) fills
    // in the literal string "Unknown Artist" when there's no real
    // artist to read — sending that through as a search hint would
    // make the lookup go looking for a recording actually credited to
    // an artist named "Unknown Artist" and (correctly) find nothing.
    // Treat that placeholder the same as no artist hint at all.
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

    // Several plausible songs? Show the dropdown so the user can pick
    // the actual right one instead of just getting the top guess.
    renderMatchOptions(result.matches||[]);

    // Uint8Array data arrives as-is over IPC (Buffer isn't
    // structured-cloneable as itself) — renderCoverGallery()/
    // applyCoverCandidate() wrap each candidate into a File on
    // demand, exactly like a user-picked cover file, so the rest of
    // the Save flow (writeAudioTags' imageData/imageMime) doesn't
    // need to know the difference.
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

    // Applies the edit to Playnck's own library/UI. For a real
    // path-backed track this only ever runs AFTER the actual file on
    // disk has been written and verified further down (or, via the
    // "Save inside Playnck only" fallback, after the user explicitly
    // chooses to keep the edit despite the file write failing) — the
    // whole point being that the library is a reflection of what's
    // really on disk, not a separate, possibly-stale copy of it.
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

      // Persist a plain copy to IndexedDB — same shape used when a
      // track is first imported (see ingestFiles() above), deliberately
      // without the temporary fileURL/artURL blob: URLs. Saving an edit
      // always persists (there's no "temporary" edit), so an externally
      // opened track reached via the player panel's Edit menu (see
      // openEditModal()'s comment) gets promoted into the real library
      // here too — same idea as ingestFiles()'s re-import promotion.
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
      // No known file on disk to be the source of truth for (plain
      // web build, or a track Playnck never learned a real path for)
      // — Save behaves exactly as it always has: the library copy is
      // the only thing that changes, and there's no "file wasn't
      // updated" implication because there was never a file to update.
      await applyToLibrary();
      closeModal();
      return;
    }

    // --- If this exact track is the one currently loaded in the
    // player, Playnck's OWN open read stream on it (see the
    // playnck-file:// protocol handler in main.js — it reads straight
    // off disk via fs.createReadStream, it never buffers the whole
    // file into memory first) is, by itself, enough for Windows to
    // refuse the rename that swaps the freshly-tagged copy in. That's
    // a real lock, not a false alarm, and it has nothing to do with
    // any other program — releasing it before writing is what
    // actually fixes it, rather than just retrying blindly. Detach
    // <audio> from the file first, restore playback afterward either
    // way.
    let resumePlayback=null;
    const wasCurrentlyLoaded=!!(state.currentTrack && state.currentTrack.id===t.id && audioEl.src);
    if(wasCurrentlyLoaded){
      resumePlayback={ time: audioEl.currentTime, wasPlaying: !audioEl.paused };
      audioEl.pause();
      // removeAttribute (not src="") + load(): per spec this drops
      // networkState to NETWORK_EMPTY without firing 'error' or
      // 'ended' — setting src="" instead would fire a real 'error'
      // event, which the "error" listener further down treats as a
      // sign the file went missing on disk and would incorrectly
      // trigger handleMissingTrack() on a file that's actually fine.
      audioEl.removeAttribute("src");
      audioEl.load();
    }

    // --- Real file on disk: write the tags/artwork into it FIRST,
    // and verify the write actually stuck (see metadata-bridge.js /
    // ffmpeg-bridge.js) — before touching Playnck's own library or UI
    // at all. This is what makes the file the source of truth instead
    // of Playnck's database: nothing here is "saved" from the user's
    // point of view until the bytes on disk actually carry it,
    // because that's the copy that survives a phone transfer, a
    // reimport, or opening the file in any other player.
    let imageData=null;
    if(pendingArtFile) imageData=await pendingArtFile.arrayBuffer();

    const result=await window.electronAPI.writeAudioTags(t.filePath,{
      title:newTitle, artist:newArtist, album:newAlbum,
      imageData, imageMime: pendingArtFile ? pendingArtFile.type : null,
      removeImage: removeArt
    }).catch(err=>({written:false, reason:String((err&&err.message)||err)}));

    const status=$("editStatus");
    // Clear out any "Save inside Playnck only" row left over from a
    // previous failed attempt in this same modal session — it's a
    // sibling of #editStatus, not part of its text, so it wouldn't
    // otherwise go away just because this retry took a different path.
    const leftoverActions=$("editSaveLibraryOnlyBtn");
    if(leftoverActions) leftoverActions.closest(".edit-status-actions").remove();

    if(!(result && result.written)){
      // The write failed, or wrote something that didn't verify back
      // correctly — either way the real file was NOT changed
      // (metadata-bridge.js / ffmpeg-bridge.js only ever swap in a
      // copy they've already confirmed matches). So the library isn't
      // touched either: no optimistic title/artist/album/art change,
      // no idbPut. The modal stays open (no auto-close) so this can't
      // be missed, the reason is shown, Save is re-enabled so the
      // user can just retry after fixing the cause, and the fallback
      // button below is the only way to keep the edit anyway.
      saveBtn.disabled=false;
      saveBtn.textContent=tr("edit.saveChanges");

      // Nothing on disk changed, so restoring playback just means
      // pointing back at the exact same fileURL it already had.
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

    // --- Write verified. Rename the real file to match the edited
    // title/artist too (best-effort, cosmetic — the embedded tags are
    // already correct either way), THEN reflect all of it — tags,
    // artwork, and the (possibly new) path — in the library/UI in one
    // go, so nothing in between is ever half-updated.
    let renameFailedReason=null;
    if(window.electronAPI.renameFile){
      const desiredBase=sanitizeFilename(`${newArtist} - ${newTitle}`);
      const renameResult=await window.electronAPI.renameFile(t.filePath,desiredBase)
        .catch(err=>({renamed:false, reason:String((err&&err.message)||err)}));
      if(renameResult && renameResult.renamed && renameResult.newPath){
        t.filePath=renameResult.newPath;
        // fileURL now points at disk by path (see hydrateTrack()),
        // so a rename has to refresh it too, or the next play/seek
        // would 404 against the old, now-moved filename.
        t.fileURL=filePathToURL(t.filePath);
      } else {
        renameFailedReason=(renameResult && renameResult.reason) || tr("edit.couldntRenameGeneric");
      }
    }

    await applyToLibrary();

    // Restore playback now that the swap is complete — using t.fileURL
    // AFTER applyToLibrary() specifically, since a successful rename
    // just above may have changed it. Restoring any earlier would
    // point <audio> at a path that briefly doesn't exist anymore.
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
