import { state, $, audioEl, idbPut, volumePopup, volumeSlider, volumePct, volumeIcon } from "./state.js";
import { tr } from "./i18n.js";
import { showWithMotion, hideWithMotion } from "./utils.js";
import { cancelCrossfade } from "./crossfade.js";

/* ================================================================
   VOLUME
   Keeps audioEl.volume, the vertical slider's fill/thumb, the "NN%"
   label, and the speaker icon glyph all in sync, and persists the
   chosen level + mute flag to IndexedDB (the same "settings"
   key/value store already used for theme/playerBg/language — see
   INIT above for the restore side of this) so it survives a
   restart.
   ================================================================ */

// Pushes state.volume/state.muted onto the real <audio> element and
// repaints the UI to match. Called after anything changes either
// field, and once at startup right after the saved level is
// restored (see init()).
function applyVolume(){
  cancelCrossfade(); // a manual volume/mute change always wins over an in-flight gapless fade's own volume ramp — see GAPLESS PLAYBACK above
  audioEl.volume = state.muted ? 0 : state.volume;
  updateVolumeUI();
}

// Purely visual — repaints the slider's fill + thumb position, the
// percentage label (or "Muted"), and swaps the speaker icon between
// muted/low/high glyphs. Never touches audioEl.volume itself;
// applyVolume() above is what actually does that.
function updateVolumeUI(){
  const level=state.muted ? 0 : state.volume;
  const pct=Math.round(level*100);

  volumeSlider.value=pct;
  // Same "paint the fill up to the current value, everything past
  // it plain elevated" trick #seek uses in the timeupdate listener
  // above — "to right" here becomes "bottom-to-top" once the
  // -90deg-rotated slider (see styles.css) turns it sideways.
  volumeSlider.style.background=`linear-gradient(to right, var(--accent1) ${pct}%, var(--elevated) ${pct}%)`;
  volumePct.textContent = state.muted ? tr("player.muted") : `${pct}%`;

  const speaker='<polygon points="4 9 8 9 12 5 12 19 8 15 4 15" fill="currentColor" stroke="none"/>';
  let waves;
  if(level<=0) waves='<line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/>';       // muted: an "X" instead of sound waves
  else if(level<0.5) waves='<path d="M16 8a5 5 0 0 1 0 8"/>';                                              // quiet: one wave arc
  else waves='<path d="M16 8a5 5 0 0 1 0 8"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';                          // loud: two wave arcs
  volumeIcon.innerHTML=speaker+waves;
}

// Saves the current level + mute flag so it's still set next launch.
function persistVolume(){
  idbPut("settings",{key:"volume",value:{level:state.volume, muted:state.muted}}).catch(()=>{});
}

// Slider drags and ArrowUp/ArrowDown both funnel through here.
// Raising the level off zero while muted always un-mutes first —
// same as every other player, since otherwise dragging the slider
// up while muted would visibly move but silently do nothing.
function setVolume(level){
  state.volume=Math.min(1,Math.max(0,level));
  if(state.muted && state.volume>0) state.muted=false;
  applyVolume();
  persistVolume();
}

// ArrowUp/ArrowDown: nudges the level by `delta` (positive or
// negative) starting from 0 if currently muted, so raising the
// volume from a muted state starts from silence rather than
// jumping back to whatever it was before muting. Also briefly shows
// the popup so the percentage is visible even though nothing was
// clicked — see showVolumeOSD() below.
function adjustVolume(delta){
  setVolume((state.muted?0:state.volume)+delta);
  showVolumeOSD();
}

// Reuses the same popup as the speaker-icon click, just auto-hides
// itself a moment later instead of waiting for an outside click —
// same idea as the volume overlay every OS shows when you tap a
// hardware volume key. Repeated key presses (holding Up/Down) keep
// resetting the timer, so it only disappears once you actually stop.
let volumeOSDTimer=null;
function showVolumeOSD(){
  openVolumePopup();
  clearTimeout(volumeOSDTimer);
  volumeOSDTimer=setTimeout(closeVolumePopup,1400);
}

// The M key. Flips state.muted without touching the remembered
// level, so unmuting restores exactly where the slider was.
function toggleMute(){
  state.muted=!state.muted;
  applyVolume();
  persistVolume();
}

// Same open/close/toggle pattern as the Info/Edit side dropdown
// (see toggleSideDropdown/openSideDropdown/closeSideDropdown above
// it) — click the speaker icon to reveal the vertical slider, click
// anywhere else (or the icon again) to close it.
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
