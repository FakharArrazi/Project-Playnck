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

function clearPlayerBgImage(){
  state.playerBg.image=null;
  applyPlayerBg();
  savePlayerBg();
  refreshPlayerBgUI();
}

function setPlayerBgBlur(px){
  state.playerBg.blur=Math.max(0,Math.min(20,Number(px)||0));
  applyPlayerBg();
  savePlayerBg();
}

function savePlayerBg(){ idbPut("settings",{key:"playerBg",value:state.playerBg}); }

function refreshPlayerBgUI(){
  const preview=$("playerBgPreview");
  if(!preview) return;
  preview.innerHTML=playerBgPreviewHTML();
  const removeBtn=$("playerBgRemoveBtn");
  if(removeBtn) removeBtn.disabled=!state.playerBg.image;
}
const ACCORDION_CHEVRON_SVG=`<svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

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

function toggleAccordionItem(id){
  const item=$("acc-"+id);
  if(item) item.classList.toggle("open");
}

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

function refreshUpdateUI(){
  const dot=$("updateDot"), text=$("updateStatusText"), btn=$("updateActionBtn");
  if(!dot||!text||!btn) return;
  const v=updateSectionView();
  dot.dataset.state=v.dot;
  text.textContent=v.text;
  btn.textContent=v.btn;
  btn.disabled=!!v.disabled;
}

async function onUpdateActionClick(){
  const v=updateSectionView();
  if(v.action==="install"){
    window.electronAPI.installUpdateNow();
    return;
  }
  if(v.action!=="check") return;
  state.updateInfo={state:"checking"};
  refreshUpdateUI();
  const result=await window.electronAPI.checkForUpdates();
  if(result && result.started===false){
    state.updateInfo={state:"error",message:result.reason||tr("updates.couldntCheck")};
    refreshUpdateUI();
  }
}

function playerBgPreviewHTML(){
  return state.playerBg.image
    ? `<img src="${state.playerBg.image}" alt="Background preview">`
    : `<div class="player-bg-preview-empty">${escapeHTML(tr("settings.noImage"))}</div>`;
}

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
    playerBgFileInput.value="";
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
    slider.addEventListener("change",saveEqSettings);
  });

  $("gaplessEnabledToggle").addEventListener("change",(e)=>{
    state.gapless.enabled=e.target.checked;
    if(!state.gapless.enabled) cancelCrossfade();
    idbPut("settings",{key:"gapless", value:{enabled:state.gapless.enabled}}).catch(()=>{});
  });

  $("visualizerEnabledToggle").addEventListener("change",(e)=>{
    state.visualizer.enabled=e.target.checked;
    saveVisualizerSettings();
    updateVisualizerState();
    const opacityRow=$("visualizerOpacityRow");
    if(opacityRow) opacityRow.classList.toggle("disabled",!state.visualizer.enabled);
  });
  const visualizerOpacitySlider=$("visualizerOpacitySlider");
  visualizerOpacitySlider.addEventListener("input",()=>{
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
