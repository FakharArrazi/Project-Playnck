import { $ } from "./state.js";
import { showWithMotion, hideWithMotion, escapeHTML } from "./utils.js";
import { tr } from "./i18n.js";

function openModal(title, bodyHTML){
  $("modalTitle").textContent=title;
  $("modalBody").innerHTML=bodyHTML;
  showWithMotion($("modalOverlay"));
}



function closeModal(){
  hideWithMotion($("modalOverlay"),220);
}



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
    $("modalCloseBtn").addEventListener("click",onOutsideCancel);
    $("modalOverlay").addEventListener("click",onOverlayClick);
  });
}

function updateAvailableModal(version){
  return new Promise(resolve=>{
    const bodyHTML=`
      <div class="edit-form">
        <p class="theme-note">${escapeHTML(tr("updates.promptBody",{version:version||"?"}))}</p>
        <div class="edit-actions">
          <button type="button" class="edit-cancel-btn" id="updatePromptLaterBtn">${escapeHTML(tr("updates.later"))}</button>
          <button type="button" class="edit-save-btn" id="updatePromptDownloadBtn">${escapeHTML(tr("updates.downloadBtn"))}</button>
        </div>
      </div>`;
    openModal(tr("updates.promptTitle"), bodyHTML);

    let settled=false;
    function finish(shouldDownload){
      if(settled) return;
      settled=true;
      $("modalCloseBtn").removeEventListener("click",onOutsideCancel);
      $("modalOverlay").removeEventListener("click",onOverlayClick);
      closeModal();
      resolve(shouldDownload);
    }
    function onOutsideCancel(){ finish(false); }
    function onOverlayClick(e){ if(e.target.id==="modalOverlay") finish(false); }

    $("updatePromptLaterBtn").addEventListener("click",()=>finish(false));
    $("updatePromptDownloadBtn").addEventListener("click",()=>finish(true));
    $("modalCloseBtn").addEventListener("click",onOutsideCancel);
    $("modalOverlay").addEventListener("click",onOverlayClick);
  });
}

export { openModal, closeModal, promptModal, updateAvailableModal };
