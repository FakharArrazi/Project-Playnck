import { state, $, idbPut } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { ensureAudioGraph, applyEqGains, saveEqSettings, EQ_BANDS, EQ_PRESETS, formatEqFreq } from "./equalizer.js";
import { saveVisualizerSettings, updateVisualizerState } from "./visualizer.js";
import { themeBgLabel, themeAccentLabel, setLanguage, addLanguage } from "./i18n.js";
import { cancelCrossfade } from "./crossfade.js";
import { THEME_BG, THEME_ACCENT, setThemeBg, setThemeAccent } from "./theme.js";
import { onBackupExportClick, onBackupImportClick, buildLanguageBodyHTML } from "./backup.js";
import { openModal } from "./modal.js";

// Paints (or clears) the custom background image behind the
// now-playing panel and dials in its blur amount. #playerBg is a
// plain absolutely-positioned layer sitting behind everything else
// in .player-panel (see the CSS) — this just points its
// background-image at the stored data URL and sets the blur var.
// Safe to call before the panel exists in the DOM (init() calls it
// before the first render).
function applyPlayerBg(){
  const layer=$("playerBg");
  if(!layer) return;
  if(state.playerBg.image){
    layer.style.backgroundImage=`url("${state.playerBg.image}")`;
    layer.classList.remove("hidden");
  } else {
    layer.style.backgroundImage="none";
    layer.classList.add("hidden");
  }
  document.documentElement.style.setProperty("--player-bg-blur",state.playerBg.blur+"px");
}

// Reads a File the user picked, converts it to a data URL (so it
// can be stashed in IndexedDB and survive a restart same as
// everything else here), applies it immediately, and persists it.
function setPlayerBgImage(file){
  if(!file || !file.type.startsWith("image/")) return;
  const reader=new FileReader();
  reader.onload=()=>{
    state.playerBg.image=reader.result;
    applyPlayerBg();
    savePlayerBg();
    refreshPlayerBgUI();
  };
  reader.readAsDataURL(file);
}

// Clears the custom background back to the plain panel gradient.
function clearPlayerBgImage(){
  state.playerBg.image=null;
  applyPlayerBg();
  savePlayerBg();
  refreshPlayerBgUI();
}

// Live-updates the blur amount as the slider is dragged.
function setPlayerBgBlur(px){
  state.playerBg.blur=Math.max(0,Math.min(20,Number(px)||0));
  applyPlayerBg();
  savePlayerBg();
}

// Persists the current image + blur to IndexedDB so it's still
// there next time the app opens.
function savePlayerBg(){ idbPut("settings",{key:"playerBg",value:state.playerBg}); }

// Re-draws just the Player section's preview thumbnail / empty
// state / remove button in place, without rebuilding the whole
// Settings modal — mirrors refreshUpdateUI() below.
function refreshPlayerBgUI(){
  const preview=$("playerBgPreview");
  if(!preview) return; // Settings modal (or Player section) isn't open right now
  preview.innerHTML=playerBgPreviewHTML();
  const removeBtn=$("playerBgRemoveBtn");
  if(removeBtn) removeBtn.disabled=!state.playerBg.image;
}
// Small chevron icon reused by every accordion header — rotates
// 180° via CSS when its parent .accordion-item gets the "open"
// class (see toggleAccordionItem below).
const ACCORDION_CHEVRON_SVG=`<svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

// Builds one collapsible row of the Settings accordion: a clickable
// header (label + chevron) and a body that's collapsed by default.
// bodyHTML is whatever that section should show once expanded.
function accordionItem(id,label,bodyHTML){
  return `
    <div class="accordion-item" id="acc-${id}">
      <button class="accordion-header" data-acc="${id}">
        <span>${escapeHTML(label)}</span>
        ${ACCORDION_CHEVRON_SVG}
      </button>
      <div class="accordion-body">
        <div class="accordion-body-inner">${bodyHTML}</div>
      </div>
    </div>`;
}

// Expands/collapses one accordion section in place. Other sections
// are left exactly as they were — this app doesn't force a
// single-open-at-a-time behavior, so switching between Theme/Audio/
// Player never loses whichever one you already had open.
function toggleAccordionItem(id){
  const item=$("acc-"+id);
  if(item) item.classList.toggle("open");
}

// Maps the last "update-status" event from main.js (state.updateInfo)
// into what the Settings > Updates section should show right now: the
// status dot's color/pulse state, the line of text next to it, the
// action button's label, whether that button is disabled, and what it
// should do when clicked. Centralized here so both the initial modal
// build (updatesBodyHTML) and any later live refresh (refreshUpdateUI,
// since an update can land while Settings happens to already be open)
// draw from exactly the same logic.
function updateSectionView(){
  const info=state.updateInfo||{state:"idle"};
  const version=state.appVersion?`v${state.appVersion}`:"";
  switch(info.state){
    case "checking":
      return {dot:"checking",text:tr("updates.checking"),btn:tr("updates.checkingBtn"),disabled:true,action:null};
    case "available":
      return {dot:"available",text:tr("updates.foundDownloading",{version:info.version||"?"}),btn:tr("updates.downloadingBtn"),disabled:true,action:null};
    case "downloading":
      return {dot:"downloading",text:tr("updates.downloading")+(info.percent!=null?" "+info.percent+"%":""),btn:tr("updates.downloadingBtn"),disabled:true,action:null};
    case "downloaded":
      return {dot:"downloaded",text:tr("updates.readyRestart",{version:info.version||"?"}),btn:tr("updates.restartInstall"),disabled:false,action:"install"};
    case "up-to-date":
      return {dot:"up-to-date",text:tr("updates.upToDate")+(version?" ("+version+")":""),btn:tr("updates.checkForUpdates"),disabled:false,action:"check"};
    case "error":
      return {dot:"error",text:info.message||tr("updates.couldntCheck"),btn:tr("updates.tryAgain"),disabled:false,action:"check"};
    default:
      return {dot:"idle",text:version?tr("updates.running",{version}):"",btn:tr("updates.checkForUpdates"),disabled:false,action:"check"};
  }
}

// Builds the Updates accordion body. On a non-Electron build (plain
// web, a future Android wrapper) window.electronAPI.checkForUpdates
// won't exist, so this falls back to a plain placeholder matching the
// other not-yet-wired sections instead of showing a dead button.
function updatesBodyHTML(){
  if(!(window.electronAPI && window.electronAPI.checkForUpdates)){
    return `<p class="info-empty">${escapeHTML(tr("updates.onlyDesktop"))}</p>`;
  }
  const v=updateSectionView();
  return `
    <div class="update-section">
      <div class="update-status-row">
        <span class="update-dot" id="updateDot" data-state="${v.dot}"></span>
        <span class="update-status-text" id="updateStatusText">${escapeHTML(v.text)}</span>
      </div>
      <button type="button" class="edit-save-btn update-check-btn" id="updateActionBtn"${v.disabled?" disabled":""}>${escapeHTML(v.btn)}</button>
    </div>`;
}

// Re-draws just the dot/text/button of the Updates section in place,
// without rebuilding the whole Settings modal — used right after a
// manual "Check for Updates" click, and whenever a live update-status
// event arrives from main.js while Settings happens to already be
// open. Safely does nothing if the modal (or this section) isn't
// currently in the DOM.
function refreshUpdateUI(){
  const dot=$("updateDot"), text=$("updateStatusText"), btn=$("updateActionBtn");
  if(!dot||!text||!btn) return;
  const v=updateSectionView();
  dot.dataset.state=v.dot;
  text.textContent=v.text;
  btn.textContent=v.btn;
  btn.disabled=!!v.disabled;
}

// Handles the Updates section's single action button, which means
// one of two different things depending on current state: kick off a
// fresh check, or (once state:"downloaded" has been reached) install
// the update that's already sitting there ready to go.
async function onUpdateActionClick(){
  const v=updateSectionView();
  if(v.action==="install"){
    window.electronAPI.installUpdateNow();
    return;
  }
  if(v.action!=="check") return; // mid check/download already — button is disabled, but guard anyway
  state.updateInfo={state:"checking"};
  refreshUpdateUI();
  const result=await window.electronAPI.checkForUpdates();
  if(result && result.started===false){
    state.updateInfo={state:"error",message:result.reason||tr("updates.couldntCheck")};
    refreshUpdateUI();
  }
  // On success, further state (available/downloading/downloaded/
  // up-to-date) arrives via the onUpdateStatus subscription in init().
}

// Small thumbnail (or empty placeholder) shown next to the Choose/
// Remove buttons in Settings > Player, reflecting whatever's
// currently saved in state.playerBg.image.
function playerBgPreviewHTML(){
  return state.playerBg.image
    ? `<img src="${state.playerBg.image}" alt="Background preview">`
    : `<div class="player-bg-preview-empty">${escapeHTML(tr("settings.noImage"))}</div>`;
}

// Builds the Settings > Backup & Restore accordion body. Electron-
// only (needs a native Save/Open dialog — see saveTextFile/
// openTextFile in preload.js), same reasoning as updatesBodyHTML.
function backupBodyHTML(){
  if(!(window.electronAPI && window.electronAPI.saveTextFile)){
    return `<p class="info-empty">${escapeHTML(tr("backup.desktopOnly"))}</p>`;
  }
  return `
    <div class="update-section">
      <p class="theme-note">${escapeHTML(tr("backup.note"))}</p>
      <div class="backup-actions">
        <button type="button" class="edit-save-btn" id="backupExportBtn">${escapeHTML(tr("backup.exportBtn"))}</button>
        <button type="button" class="amr-add-btn" id="backupImportBtn">${escapeHTML(tr("backup.importBtn"))}</button>
      </div>
      <p class="update-status-text" id="backupStatusText"></p>
    </div>`;
}

// Builds the Settings modal body: a stack of collapsible sections
// (Theme, Updates, Audio, Player, Language) — clicking a header
// reveals that section's controls underneath it. Audio/Language
// are placeholders ready for whatever gets added next.
function openSettingsModal(){
  const bgSwatches=Object.entries(THEME_BG).map(([key,cfg])=>
    `<button class="swatch-btn bg-swatch${key==="light"?" on-light":""}${state.theme.bg===key?" active":""}" data-bg="${key}" style="background:${cfg.swatch}" title="${escapeHTML(themeBgLabel(key))}"></button>`
  ).join("");
  const accentSwatches=Object.entries(THEME_ACCENT).map(([key,cfg])=>
    `<button class="swatch-btn${state.theme.accent===key?" active":""}" data-accent="${key}" style="background:${cfg.a1}" title="${escapeHTML(themeAccentLabel(key))}"></button>`
  ).join("");

  const themeBodyHTML=`
    <div class="theme-picker">
      <div>
        <div class="theme-group-label">${escapeHTML(tr("settings.appBackground"))}</div>
        <div class="swatch-row" id="bgSwatchRow">${bgSwatches}</div>
      </div>
      <div>
        <div class="theme-group-label">${escapeHTML(tr("settings.accentColor"))}</div>
        <div class="swatch-row" id="accentSwatchRow">${accentSwatches}</div>
      </div>
      <p class="theme-note">${escapeHTML(tr("settings.themeNote"))}</p>
    </div>`;

  const eqBandsHTML=EQ_BANDS.map((band,i)=>{
    const gain=state.eq.gains[i]||0;
    return `
      <div class="eq-band">
        <span class="eq-band-value" id="eqBandValue${i}">${gain>0?"+":""}${gain}</span>
        <div class="eq-band-wrap"><input type="range" class="eq-band-slider" min="-12" max="12" step="1" value="${gain}" data-band="${i}"></div>
        <span class="eq-band-freq">${formatEqFreq(band.freq)}</span>
      </div>`;
  }).join("");

  const audioBodyHTML=`
    <div class="audio-settings">
      <div class="settings-toggle-row">
        <div class="settings-toggle-label">
          <div class="theme-group-label">${escapeHTML(tr("audio.equalizer"))}</div>
          <p class="theme-note">${escapeHTML(tr("audio.equalizerNote"))}</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="eqEnabledToggle"${state.eq.enabled?" checked":""}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="eq-controls${state.eq.enabled?"":" disabled"}" id="eqControls">
        <div class="eq-presets" id="eqPresetRow">
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="flat">${escapeHTML(tr("audio.eqFlat"))}</button>
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="bassBoost">${escapeHTML(tr("audio.eqBassBoost"))}</button>
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="trebleBoost">${escapeHTML(tr("audio.eqTrebleBoost"))}</button>
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="vocalBoost">${escapeHTML(tr("audio.eqVocalBoost"))}</button>
        </div>
        <div class="eq-bands-row" id="eqBandsRow">${eqBandsHTML}</div>
      </div>

      <div class="settings-toggle-row settings-toggle-row-divider">
        <div class="settings-toggle-label">
          <div class="theme-group-label">${escapeHTML(tr("audio.gapless"))}</div>
          <p class="theme-note">${escapeHTML(tr("audio.gaplessNote"))}</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="gaplessEnabledToggle"${state.gapless.enabled?" checked":""}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`;
  const playerBodyHTML=`
    <div class="player-bg-settings">
      <div class="theme-group-label">${escapeHTML(tr("settings.nowPlayingBgImage"))}</div>
      <div class="player-bg-row">
        <div class="player-bg-preview" id="playerBgPreview">${playerBgPreviewHTML()}</div>
        <div class="player-bg-actions">
          <button type="button" class="edit-save-btn" id="playerBgChooseBtn">${escapeHTML(tr("settings.chooseImage"))}</button>
          <button type="button" class="amr-add-btn" id="playerBgRemoveBtn"${state.playerBg.image?"":" disabled"}>${escapeHTML(tr("settings.remove"))}</button>
          <input type="file" id="playerBgFileInput" accept="image/*" class="hidden">
        </div>
      </div>
      <div class="player-bg-blur-row">
        <div class="theme-group-label">${escapeHTML(tr("settings.blur"))}</div>
        <div class="player-bg-blur-control">
          <input type="range" id="playerBgBlurSlider" min="0" max="20" step="1" value="${state.playerBg.blur}">
          <span class="player-bg-blur-value" id="playerBgBlurValue">${state.playerBg.blur}px</span>
        </div>
      </div>
      <p class="theme-note">${escapeHTML(tr("settings.playerBgNote"))}</p>

      <div class="settings-toggle-row settings-toggle-row-divider">
        <div class="settings-toggle-label">
          <div class="theme-group-label">${escapeHTML(tr("player.visualizer"))}</div>
          <p class="theme-note">${escapeHTML(tr("player.visualizerNote"))}</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="visualizerEnabledToggle"${state.visualizer.enabled?" checked":""}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="player-bg-blur-row visualizer-opacity-row${state.visualizer.enabled?"":" disabled"}" id="visualizerOpacityRow">
        <div class="theme-group-label">${escapeHTML(tr("player.visualizerOpacity"))}</div>
        <div class="player-bg-blur-control">
          <input type="range" id="visualizerOpacitySlider" min="0" max="2" step="0.05" value="${state.visualizer.intensity}">
          <span class="player-bg-blur-value" id="visualizerOpacityValue">${Math.round(state.visualizer.intensity*100)}%</span>
        </div>
      </div>
    </div>`;
  const languageBodyHTML=buildLanguageBodyHTML();

  const bodyHTML=`
    <div class="settings-accordion">
      ${accordionItem("theme",tr("settings.theme"),themeBodyHTML)}
      ${accordionItem("updates",tr("settings.updates"),updatesBodyHTML())}
      ${accordionItem("audio",tr("settings.audio"),audioBodyHTML)}
      ${accordionItem("player",tr("settings.player"),playerBodyHTML)}
      ${accordionItem("backup",tr("settings.backup"),backupBodyHTML())}
      ${accordionItem("language",tr("settings.language"),languageBodyHTML)}
    </div>`;

  openModal(tr("nav.settings"), bodyHTML);

  document.querySelectorAll(".accordion-header").forEach(btn=>{
    btn.addEventListener("click",()=>toggleAccordionItem(btn.dataset.acc));
  });
  $("bgSwatchRow").querySelectorAll(".swatch-btn").forEach(btn=>{
    btn.addEventListener("click",()=>setThemeBg(btn.dataset.bg));
  });
  $("accentSwatchRow").querySelectorAll(".swatch-btn").forEach(btn=>{
    btn.addEventListener("click",()=>setThemeAccent(btn.dataset.accent));
  });
  if(window.electronAPI && window.electronAPI.checkForUpdates){
    $("updateActionBtn").addEventListener("click",onUpdateActionClick);
  }

  const playerBgFileInput=$("playerBgFileInput");
  $("playerBgChooseBtn").addEventListener("click",()=>playerBgFileInput.click());
  playerBgFileInput.addEventListener("change",()=>{
    const file=playerBgFileInput.files && playerBgFileInput.files[0];
    if(file) setPlayerBgImage(file);
    playerBgFileInput.value=""; // lets picking the exact same file again still fire "change"
  });
  $("playerBgRemoveBtn").addEventListener("click",clearPlayerBgImage);
  const blurSlider=$("playerBgBlurSlider");
  blurSlider.addEventListener("input",()=>{
    $("playerBgBlurValue").textContent=blurSlider.value+"px";
    setPlayerBgBlur(blurSlider.value);
  });

  $("languageChipRow").querySelectorAll(".lang-chip").forEach(btn=>{
    btn.addEventListener("click",()=>setLanguage(btn.dataset.lang));
  });
  const addLangBtn=$("addLanguageBtn");
  if(addLangBtn) addLangBtn.addEventListener("click",addLanguage);

  // --- Settings > Audio: Equalizer ---
  $("eqEnabledToggle").addEventListener("change",(e)=>{
    state.eq.enabled=e.target.checked;
    ensureAudioGraph();
    applyEqGains();
    saveEqSettings();
    $("eqControls").classList.toggle("disabled",!state.eq.enabled);
  });
  $("eqPresetRow").querySelectorAll(".eq-preset-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const preset=EQ_PRESETS[btn.dataset.preset];
      if(!preset) return;
      state.eq.gains=preset.slice();
      ensureAudioGraph();
      applyEqGains();
      saveEqSettings();
      $("eqBandsRow").querySelectorAll(".eq-band-slider").forEach((slider,i)=>{
        slider.value=state.eq.gains[i];
        const valEl=$("eqBandValue"+i);
        if(valEl) valEl.textContent=(state.eq.gains[i]>0?"+":"")+state.eq.gains[i];
      });
    });
  });
  $("eqBandsRow").querySelectorAll(".eq-band-slider").forEach(slider=>{
    const i=Number(slider.dataset.band);
    slider.addEventListener("input",()=>{
      state.eq.gains[i]=Number(slider.value);
      const valEl=$("eqBandValue"+i);
      if(valEl) valEl.textContent=(state.eq.gains[i]>0?"+":"")+state.eq.gains[i];
      ensureAudioGraph();
      applyEqGains();
    });
    slider.addEventListener("change",saveEqSettings); // persist once per drag, not on every tick
  });

  // --- Settings > Audio: Gapless Playback ---
  $("gaplessEnabledToggle").addEventListener("change",(e)=>{
    state.gapless.enabled=e.target.checked;
    if(!state.gapless.enabled) cancelCrossfade();
    idbPut("settings",{key:"gapless", value:{enabled:state.gapless.enabled}}).catch(()=>{});
  });

  // --- Settings > Player: Visualizer ---
  $("visualizerEnabledToggle").addEventListener("change",(e)=>{
    state.visualizer.enabled=e.target.checked;
    saveVisualizerSettings();
    updateVisualizerState();
    const opacityRow=$("visualizerOpacityRow");
    if(opacityRow) opacityRow.classList.toggle("disabled",!state.visualizer.enabled);
  });
  const visualizerOpacitySlider=$("visualizerOpacitySlider");
  visualizerOpacitySlider.addEventListener("input",()=>{
    // Live, like a Photoshop layer-opacity slider — no separate "apply"
    // step, drawVisualizerFrame() just reads state.visualizer.intensity
    // on its next tick.
    state.visualizer.intensity=Math.max(0,Math.min(2,Number(visualizerOpacitySlider.value)||0));
    $("visualizerOpacityValue").textContent=Math.round(state.visualizer.intensity*100)+"%";
    saveVisualizerSettings();
  });

  if(window.electronAPI && window.electronAPI.saveTextFile){
    $("backupExportBtn").addEventListener("click",onBackupExportClick);
    $("backupImportBtn").addEventListener("click",onBackupImportClick);
  }
}

export { applyPlayerBg, refreshUpdateUI, openSettingsModal };
