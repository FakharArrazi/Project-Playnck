import { $ } from "./state.js";
import { showWithMotion, hideWithMotion, escapeHTML } from "./utils.js";
import { tr } from "./i18n.js";

// Fills in and shows the shared modal. Used by both openInfoModal()
// and openEditModal() below so there's only one popup to maintain.
function openModal(title, bodyHTML){
  $("modalTitle").textContent=title;
  $("modalBody").innerHTML=bodyHTML;
  showWithMotion($("modalOverlay"));
}



// Hides the shared modal.
function closeModal(){
  hideWithMotion($("modalOverlay"),220);
}



// Stand-in for window.prompt(), which Electron's renderer never
// implements — unlike alert()/confirm(), which show a real native
// dialog, prompt() silently does nothing and the call returns right
// away with no dialog ever appearing on screen (this has been true
// since Electron's earliest releases: https://github.com/electron/electron/issues/472).
// Every call site that used to call prompt() for a text value (new
// playlist name, rename playlist, new/rename folder) calls this
// instead. Reuses the same modal overlay and .edit-* styling as the
// Edit Track modal so it looks native to the app. Resolves with the
// trimmed text, or null if the user cancels/submits empty.
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

export { openModal, closeModal, promptModal };
