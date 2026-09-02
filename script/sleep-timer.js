import { $, audioEl } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { openModal, closeModal } from "./modal.js";


const SLEEP_TIMER_PRESETS_MIN=[15,30,45,60,90];
let sleepTimerHandle=null;
let sleepTimerEndsAt=null;

function startSleepTimer(minutes){
  clearSleepTimer();
  const ms=minutes*60*1000;
  sleepTimerEndsAt=Date.now()+ms;
  sleepTimerHandle=setTimeout(()=>{
    const audioEl=$("audioEl");
    if(audioEl && !audioEl.paused) audioEl.pause();
    sleepTimerEndsAt=null;
    sleepTimerHandle=null;
  },ms);
}

function clearSleepTimer(){
  if(sleepTimerHandle) clearTimeout(sleepTimerHandle);
  sleepTimerHandle=null;
  sleepTimerEndsAt=null;
}

function openSleepTimerModal(){
  const presetsHTML=SLEEP_TIMER_PRESETS_MIN.map(m=>
    `<button type="button" class="amr-add-btn sleep-preset-btn" data-minutes="${m}">${escapeHTML(tr("sleep.presetMinutes",{minutes:m}))}</button>`
  ).join("");
  const statusText=sleepTimerEndsAt
    ? tr("sleep.activeStatus",{minutes:Math.max(0,Math.round((sleepTimerEndsAt-Date.now())/60000))})
    : tr("sleep.off");
  const bodyHTML=`
    <div class="theme-picker">
      <p class="update-status-text" id="sleepStatusText">${escapeHTML(statusText)}</p>
      <div class="backup-actions" id="sleepPresetRow">${presetsHTML}</div>
      <button type="button" class="edit-save-btn" id="sleepOffBtn"${sleepTimerEndsAt?"":" disabled"}>${escapeHTML(tr("sleep.turnOff"))}</button>
      <p class="theme-note">${escapeHTML(tr("sleep.note"))}</p>
    </div>`;
  openModal(tr("sleep.title"), bodyHTML);

  $("sleepPresetRow").querySelectorAll(".sleep-preset-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      startSleepTimer(Number(btn.dataset.minutes));
      closeModal();
    });
  });
  $("sleepOffBtn").addEventListener("click",()=>{
    clearSleepTimer();
    closeModal();
  });
}

export { openSleepTimerModal };
