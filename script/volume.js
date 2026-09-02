import { state, $, audioEl, idbPut, volumePopup, volumeSlider, volumePct, volumeIcon } from "./state.js";
import { tr } from "./i18n.js";
import { showWithMotion, hideWithMotion } from "./utils.js";
import { cancelCrossfade } from "./crossfade.js";


function applyVolume(){
  cancelCrossfade();
  audioEl.volume = state.muted ? 0 : state.volume;
  updateVolumeUI();
}

function updateVolumeUI(){
  const level=state.muted ? 0 : state.volume;
  const pct=Math.round(level*100);

  volumeSlider.value=pct;
  volumeSlider.style.background=`linear-gradient(to right, var(--accent1) ${pct}%, var(--elevated) ${pct}%)`;
  volumePct.textContent = state.muted ? tr("player.muted") : `${pct}%`;

  const speaker='<polygon points="4 9 8 9 12 5 12 19 8 15 4 15" fill="currentColor" stroke="none"/>';
  let waves;
  if(level<=0) waves='<line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/>';
  else if(level<0.5) waves='<path d="M16 8a5 5 0 0 1 0 8"/>';
  else waves='<path d="M16 8a5 5 0 0 1 0 8"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';
  volumeIcon.innerHTML=speaker+waves;
}

function persistVolume(){
  idbPut("settings",{key:"volume",value:{level:state.volume, muted:state.muted}}).catch(()=>{});
}

function setVolume(level){
  state.volume=Math.min(1,Math.max(0,level));
  if(state.muted && state.volume>0) state.muted=false;
  applyVolume();
  persistVolume();
}

function adjustVolume(delta){
  setVolume((state.muted?0:state.volume)+delta);
  showVolumeOSD();
}

let volumeOSDTimer=null;
function showVolumeOSD(){
  openVolumePopup();
  clearTimeout(volumeOSDTimer);
  volumeOSDTimer=setTimeout(closeVolumePopup,1400);
}

function toggleMute(){
  state.muted=!state.muted;
  applyVolume();
  persistVolume();
}

function toggleVolumePopup(){
  if(volumePopup.classList.contains("hidden")) openVolumePopup();
  else closeVolumePopup();
}
function openVolumePopup(){
  const wasHidden=volumePopup.classList.contains("hidden");
  showWithMotion(volumePopup);
  if(wasHidden){
    setTimeout(()=>document.addEventListener("click",closeVolumePopup,{once:true}),0);
  }
}
function closeVolumePopup(){
  hideWithMotion(volumePopup);
}

export { applyVolume, setVolume, adjustVolume, toggleMute, toggleVolumePopup };
