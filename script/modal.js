import { $ } from "./state.js";
import { showWithMotion, hideWithMotion } from "./utils.js";

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

export { openModal, closeModal };
