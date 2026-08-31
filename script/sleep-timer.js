import { $, audioEl } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { openModal, closeModal } from "./modal.js";

/* ================================================================
   SLEEP TIMER
   One scheduled pause — pick a duration, and playback pauses itself
   once that much time has passed. Deliberately just a plain
   setTimeout acting directly on the real <audio> element (audioEl),
   rather than anything wired into the queue/repeat/shuffle/auto-
   advance logic elsewhere in this file: it only ever calls
   audioEl.pause(), so it can't conflict with (or need to know
   anything about) whatever decides what plays next. Reachable from
   the "☰" side menu (menuSleepBtn) alongside Info/Edit/Sync Lyrics.
   Session-only by design — like a real sleep timer, it's meant to
   apply to *this* listening session, not persist across restarts.
   ================================================================ */

const SLEEP_TIMER_PRESETS_MIN=[15,30,45,60,90];
let sleepTimerHandle=null;
let sleepTimerEndsAt=null; // epoch ms, or null when no timer is running

// Starts (or restarts, if one was already running) a sleep timer for
// the given number of minutes.
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

// Cancels a running sleep timer, if any. Safe to call even when none
// is running (used both by the "Turn Off" button and defensively
// before starting a new one).
function clearSleepTimer(){
  if(sleepTimerHandle) clearTimeout(sleepTimerHandle);
  sleepTimerHandle=null;
  sleepTimerEndsAt=null;
}

// Opens a small modal with duration presets plus the current status,
// reusing the exact same shared openModal()/closeModal() popup as
// Info/Edit/About.
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
