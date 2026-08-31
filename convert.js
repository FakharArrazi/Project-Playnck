import { state, $, listContainer, uid, AUDIO_EXT } from "./state.js";
import { el, escapeHTML, fmtTime, formatBytes } from "./utils.js";
import { tr } from "./i18n.js";
import { renderTab } from "./library-view.js";
import { resolveFilePath } from "./init.js";
import { libraryTracks } from "./metadata.js";
import { openModal } from "./modal.js";

/* ================================================================
   CONVERT TAB
   A bulk audio-conversion workspace powered by a real, locally
   installed FFmpeg — entirely separate from the music library:
   nothing added here ever touches state.tracks, libraryTracks(), or
   the "tracks" IndexedDB store. See ffmpeg-bridge.js (main process)
   for FFmpeg detection/one-click install/the actual conversion
   work; everything below is the UI plus a simple sequential queue
   runner (the "Conversion Manager" from the spec) that calls it one
   file at a time — see startConversion() further down.

   state.convert (see APP STATE above) holds everything: FFmpeg
   readiness, the queued files and their statuses, the chosen
   format/quality settings, the output folder + collision mode, and
   the most recent run's summary. It's plain renderer state, never
   written to IndexedDB, so closing and reopening Playnck always
   starts this tab fresh — exactly right for what's meant to be a
   one-off workspace, not a saved project.
   ================================================================ */

// Mirrors ffmpeg-bridge.js's FORMAT_INFO (main process) — kept as a
// small static duplicate here rather than an extra IPC round trip
// for data that never changes at runtime. If a format's behavior
// changes in one place, it needs the same change in the other.
const CONVERT_FORMATS={
  mp3:  {ext:"mp3",  label:"MP3"},
  aac:  {ext:"m4a",  label:"AAC"},
  flac: {ext:"flac", label:"FLAC", lossless:true},
  wav:  {ext:"wav",  label:"WAV",  lossless:true},
  alac: {ext:"m4a",  label:"ALAC", lossless:true},
  opus: {ext:"opus", label:"Opus"}
};
const CONVERT_FORMAT_ORDER=["mp3","aac","flac","wav","alac","opus"];
const CONVERT_BITRATES={
  mp3:  [128,160,192,224,256,320],
  aac:  [128,160,192,224,256,320],
  opus: [96,128,160,192,256]
};

let convertFFmpegCheckInFlight=false;
let convertOutputFolderFetchInFlight=false;

// Entry point — called from renderTab() every time the Convert tab
// is (re)drawn (switching to it, adding/removing a file, changing a
// setting, a run finishing, etc. — see the many renderTab() calls
// sprinkled through the functions below).
function renderConvertTab(){
  const wrap=el("div","convert-view");
  listContainer.appendChild(wrap);

  // FFmpeg conversion needs a real child process — there's no
  // meaningful version of this tab in a plain browser tab. Mirrors
  // how the Backup/Auto-Tag features already tell the person this is
  // a desktop-app-only feature rather than silently doing nothing.
  if(!window.electronAPI){
    wrap.appendChild(el("div","empty-state",escapeHTML(tr("convert.desktopOnly"))));
    return;
  }

  const c=state.convert;

  // First time this tab has ever been opened this session — kick off
  // the "is FFmpeg actually runnable" check described in the spec.
  // checkFFmpegStatus() re-renders itself once it has an answer (if
  // this is still the active tab by then), so nothing more happens
  // here on this pass.
  if(c.ffmpegStatus==="unknown"){
    c.ffmpegStatus="checking";
    checkFFmpegStatus();
  }

  if(c.ffmpegStatus!=="ready"){
    renderConvertFFmpegSetup(wrap, c.ffmpegStatus);
    return;
  }

  // FFmpeg is confirmed ready. Fill in a sensible default output
  // folder the first time that becomes true this session (see
  // get-default-convert-output in main.js) — after this, whatever the
  // person actually chooses via "Choose Folder" sticks for the rest
  // of the session.
  if(!c.outputFolder && !convertOutputFolderFetchInFlight){
    convertOutputFolderFetchInFlight=true;
    window.electronAPI.getDefaultConvertOutput().then(dir=>{
      convertOutputFolderFetchInFlight=false;
      c.outputFolder=dir;
      if(state.currentTab==="convert") renderTab();
    });
  }

  renderConvertReadyBanner(wrap);

  // The completion banner sits ABOVE the queue rather than replacing
  // it — every file's final status is still right there in the list
  // below (see req #13, "the user should be able to see which files
  // succeeded and which failed"), this is just the at-a-glance summary
  // plus the one-click "Open Output Folder".
  if(c.lastRunSummary && !c.isConverting) renderConvertCompletionBanner(wrap);

  renderConvertAddFilesSection(wrap);
  renderConvertQueueSection(wrap);
  if(c.queue.length){
    renderConvertSettingsSection(wrap);
    renderConvertOutputSection(wrap);
  }
  if(c.isConverting) renderConvertProgressSection(wrap);
  if(c.queue.length) renderConvertControlsRow(wrap);
}



// The very first question this tab asks, every time it's opened —
// runs ffmpeg -version for real (see detectFFmpeg() in
// ffmpeg-bridge.js) rather than assuming anything from a file just
// existing somewhere.
async function checkFFmpegStatus(){
  if(convertFFmpegCheckInFlight) return;
  convertFFmpegCheckInFlight=true;
  const c=state.convert;
  try{
    const result=await window.electronAPI.ffmpegDetect();
    c.ffmpegStatus = result && result.available ? "ready" : "missing";
    c.ffmpegVersion = (result && result.version) || null;
  } catch(e){
    console.warn("ffmpegDetect failed:",e);
    c.ffmpegStatus="missing";
  }
  convertFFmpegCheckInFlight=false;
  if(state.currentTab==="convert") renderTab();
}



// "Install FFmpeg" button — see installFFmpeg() in ffmpeg-bridge.js
// for what actually happens (winget, Windows-only). Real status
// lines stream in via onFFmpegInstallProgress (wired once, near the
// bottom of this file) straight into state.convert.installLog while
// this runs, instead of a fake progress percentage.
async function startFFmpegInstall(){
  const c=state.convert;
  c.ffmpegStatus="installing";
  c.installLog=[];
  c.installError=null;
  renderTab();

  const result=await window.electronAPI.ffmpegInstall();
  if(result && result.success){
    c.ffmpegStatus="ready";
    c.ffmpegVersion=result.version || c.ffmpegVersion;
  } else {
    c.ffmpegStatus="install-failed";
    c.installError=(result && result.reason) || null;
  }
  if(state.currentTab==="convert") renderTab();
}



// ----------------------------------------------------------------
// FFMPEG STATUS UI (checking / missing / installing / install-failed)
// ----------------------------------------------------------------

const CONVERT_WRENCH_ICON="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'/></svg>";

function renderConvertFFmpegSetup(wrap, mode){
  const section=el("div","convert-section convert-setup");

  if(mode==="checking"){
    const dot=el("div","convert-ffmpeg-dot");
    dot.dataset.state="checking";
    section.appendChild(dot);
    section.appendChild(el("p","",escapeHTML(tr("convert.checkingFFmpeg"))));
    wrap.appendChild(section);
    return;
  }

  section.appendChild(el("div","",CONVERT_WRENCH_ICON));

  if(mode==="installing"){
    section.appendChild(el("h3","",escapeHTML(tr("convert.installing"))));
    const log=el("div","convert-install-log");
    log.id="convertInstallLog";
    state.convert.installLog.forEach(line=>log.appendChild(el("div","",escapeHTML(line))));
    section.appendChild(log);
    wrap.appendChild(section);
    // Keep the log scrolled to the newest line.
    log.scrollTop=log.scrollHeight;
    return;
  }

  if(mode==="install-failed"){
    section.appendChild(el("h3","",escapeHTML(tr("convert.installFailed"))));
    if(state.convert.installError){
      section.appendChild(el("div","convert-install-error",escapeHTML(state.convert.installError)));
    }
    const retryBtn=el("button","amr-add-btn",escapeHTML(tr("convert.tryAgain")));
    retryBtn.addEventListener("click",startFFmpegInstall);
    section.appendChild(retryBtn);
    section.appendChild(el("p","",escapeHTML(tr("convert.installManually"))));
    wrap.appendChild(section);
    return;
  }

  // mode==="missing"
  section.appendChild(el("h3","",escapeHTML(tr("convert.ffmpegRequired"))));
  section.appendChild(el("p","",escapeHTML(tr("convert.ffmpegRequiredNote"))));
  const installBtn=el("button","edit-save-btn",escapeHTML(tr("convert.installFFmpeg")));
  installBtn.addEventListener("click",startFFmpegInstall);
  section.appendChild(installBtn);
  wrap.appendChild(section);
}



// Small "FFmpeg Ready • vX.X.X" strip shown above the workspace once
// it's confirmed available — deliberately subtle (no card/border),
// per the spec's "should be subtle and fit the Playnck UI".
function renderConvertReadyBanner(wrap){
  const banner=el("div","convert-ffmpeg-banner is-ready");
  const left=el("div","convert-ffmpeg-ready-text");
  const dot=el("span","convert-ffmpeg-dot");
  dot.dataset.state="ready";
  left.appendChild(dot);
  left.appendChild(el("b","",escapeHTML(tr("convert.ffmpegReady"))));
  if(state.convert.ffmpegVersion) left.appendChild(el("span","",escapeHTML("v"+state.convert.ffmpegVersion)));
  banner.appendChild(left);
  wrap.appendChild(banner);
}



// ----------------------------------------------------------------
// ADD FILES — drag & drop zone + Browse Files + Add Folder
// ----------------------------------------------------------------

function renderConvertAddFilesSection(wrap){
  const section=el("div","convert-section");
  section.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.addFiles"))));

  const zone=el("div","convert-dropzone");
  zone.appendChild(el("div","","<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 16V4'/><path d='M7 9l5-5 5 5'/><path d='M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'/></svg>"));
  zone.appendChild(el("p","",escapeHTML(tr("convert.dropHere"))));
  zone.appendChild(el("span","convert-or",escapeHTML(tr("convert.or"))));
  const browseBtn=el("button","amr-add-btn",escapeHTML(tr("convert.browseFiles")));
  zone.appendChild(browseBtn);

  const openPicker=(e)=>{ if(e) e.stopPropagation(); $("convertFilesInput").click(); };
  browseBtn.addEventListener("click",openPicker);
  zone.addEventListener("click",openPicker);

  // Local to this drop zone only — see the note on wireDragAndDropPlay()
  // further up for how the window-level "drop to play" handler steps
  // aside entirely while state.currentTab==="convert", so a file
  // dropped here is never also imported into the library.
  zone.addEventListener("dragover",(e)=>{ e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave",()=>zone.classList.remove("drag-over"));
  zone.addEventListener("drop",(e)=>{
    e.preventDefault();
    zone.classList.remove("drag-over");
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
      addFilesToConvertQueue(e.dataTransfer.files);
    }
  });

  section.appendChild(zone);

  const addRow=el("div","convert-add-row");
  const addFolderBtn=el("button","amr-add-btn",`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'/></svg> ${escapeHTML(tr("convert.addFolder"))}`);
  addFolderBtn.addEventListener("click",addFolderToConvertQueue);
  addRow.appendChild(addFolderBtn);
  section.appendChild(addRow);

  wrap.appendChild(section);
}



// Turns picked/dropped File objects into queue entries. Reuses
// resolveFilePath() (see FILE/METADATA HANDLING above) for a real
// absolute path — FFmpeg needs an actual file on disk, not a blob:
// URL — and getAudioMetadata() (the same IPC the library's Info
// panel and tag-backfill already use) purely for display (duration/
// size/title/artist in the queue row below); nothing here ever
// touches state.tracks or "tracks" in IndexedDB.
async function addFilesToConvertQueue(fileList){
  const c=state.convert;
  const files=Array.from(fileList).filter(f=>{
    const ext=f.name.split(".").pop().toLowerCase();
    return AUDIO_EXT.includes(ext) || f.type.startsWith("audio/");
  });

  let added=0;
  for(const file of files){
    const filePath=resolveFilePath(file);
    if(!filePath){
      console.warn("Convert: couldn't resolve a real path for",file.name,"— skipping.");
      continue;
    }
    if(c.queue.some(q=>q.path===filePath)) continue; // already queued — see req #5/#7-equivalent, "avoid duplicate entries"
    let meta=null;
    try{ meta=await window.electronAPI.getAudioMetadata(filePath); } catch(e){ /* fine — the row just shows less detail */ }
    const ext=filePath.split(".").pop().toLowerCase();
    c.queue.push({
      id:uid(),
      path:filePath,
      name:file.name.replace(/\.[^.]+$/,""),
      ext,
      sizeBytes:(meta && meta.fileSize!=null) ? meta.fileSize : (file.size||null),
      duration:(meta && meta.duration) || 0,
      title:(meta && meta.title) || null,
      artist:(meta && meta.artist) || null,
      status:"waiting", progressPercent:0, error:null, outputPath:null
    });
    added++;
  }
  if(added && state.currentTab==="convert") renderTab();
}



// "Add Folder" — a native folder picker (see select-folder in
// main.js) paired with the exact same scan-folder IPC handler the
// library's own "Add Folder" already uses to enumerate every audio
// file inside it, rather than the webkitdirectory <input> trick the
// library uses (which can't resolve a path at all for an empty
// folder — no good for a picker that also has to work as the
// *output* folder chooser below).
async function addFolderToConvertQueue(){
  const dir=await window.electronAPI.selectFolder();
  if(!dir) return;
  const paths=await window.electronAPI.scanFolder(dir);
  if(!paths || !paths.length){
    openModal(tr("convert.addFolder"), `<p class="info-empty">${escapeHTML(tr("convert.noNewFiles"))}</p>`);
    return;
  }

  const c=state.convert;
  let added=0;
  for(const filePath of paths){
    if(c.queue.some(q=>q.path===filePath)) continue;
    let meta=null;
    try{ meta=await window.electronAPI.getAudioMetadata(filePath); } catch(e){ /* fine */ }
    const ext=filePath.split(".").pop().toLowerCase();
    const base=filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/,"");
    c.queue.push({
      id:uid(), path:filePath, name:base, ext,
      sizeBytes:(meta && meta.fileSize!=null) ? meta.fileSize : null,
      duration:(meta && meta.duration) || 0,
      title:(meta && meta.title) || null,
      artist:(meta && meta.artist) || null,
      status:"waiting", progressPercent:0, error:null, outputPath:null
    });
    added++;
  }
  if(added && state.currentTab==="convert") renderTab();
}



// ----------------------------------------------------------------
// CONVERSION QUEUE
// ----------------------------------------------------------------

const CONVERT_QUEUE_ICON="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/></svg>";
const CONVERT_REMOVE_ICON="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><path d='M18 6 6 18'/><path d='M6 6l12 12'/></svg>";

function renderConvertQueueSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section");

  const header=el("div","convert-queue-header");
  header.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.queueTitle"))));
  if(c.queue.length && !c.isConverting){
    const clearBtn=el("button","edit-cancel-btn",escapeHTML(tr("convert.clearQueue")));
    clearBtn.addEventListener("click",clearConvertQueue);
    header.appendChild(clearBtn);
  }
  section.appendChild(header);

  if(!c.queue.length){
    section.appendChild(el("div","empty-state",escapeHTML(tr("convert.queueEmpty"))));
    wrap.appendChild(section);
    return;
  }

  const list=el("div","convert-queue-list");
  list.id="convertQueueList";
  c.queue.forEach(item=>list.appendChild(buildConvertQueueRow(item)));
  section.appendChild(list);
  wrap.appendChild(section);
}



function buildConvertQueueRow(item){
  const row=el("div","convert-queue-row status-"+item.status);
  row.dataset.jobRowId=item.id; // lets updateConvertRowProgress() find this row later without a full re-render

  row.appendChild(el("div","convert-queue-icon",CONVERT_QUEUE_ICON));

  const info=el("div","convert-queue-info");
  const displayTitle=item.title || item.name;
  const displaySub=[item.ext.toUpperCase(), item.artist, formatBytes(item.sizeBytes), fmtTime(item.duration)].filter(Boolean).join(" • ");
  info.appendChild(el("div","convert-queue-title",escapeHTML(displayTitle)));
  info.appendChild(el("div","convert-queue-sub",escapeHTML(displaySub)));
  if(item.status==="converting"){
    const bar=el("div","convert-queue-row-progress");
    const fill=el("div","convert-queue-row-progress-fill");
    fill.style.width=(item.progressPercent||0)+"%";
    bar.appendChild(fill);
    info.appendChild(bar);
  }
  if(item.status==="failed" && item.error){
    info.appendChild(el("div","convert-queue-row-error",escapeHTML(item.error)));
  }
  row.appendChild(info);

  const status=el("span","convert-queue-status",escapeHTML(tr("convert.status."+item.status)));
  status.dataset.status=item.status;
  row.appendChild(status);

  if(item.status==="waiting" || item.status==="failed" || item.status==="skipped" || item.status==="cancelled"){
    const removeBtn=el("button","convert-queue-remove",CONVERT_REMOVE_ICON);
    removeBtn.title=tr("convert.removeFile");
    removeBtn.addEventListener("click",()=>removeFromConvertQueue(item.id));
    row.appendChild(removeBtn);
  }

  return row;
}



function removeFromConvertQueue(id){
  const c=state.convert;
  c.queue=c.queue.filter(q=>q.id!==id);
  renderTab();
}



function clearConvertQueue(){
  const c=state.convert;
  c.queue=[];
  c.lastRunSummary=null;
  c.overallDone=0;
  c.overallTotal=0;
  renderTab();
}



// ----------------------------------------------------------------
// CONVERSION SETTINGS — output format + the quality control that
// actually applies to whichever format is currently selected
// ----------------------------------------------------------------

function renderConvertSettingsSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section");
  section.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.settingsTitle"))));

  const grid=el("div","convert-settings-grid");

  // --- Output Format ---
  const formatBlock=el("div","");
  formatBlock.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.outputFormat"))));
  const formatRow=el("div","convert-chip-row");
  CONVERT_FORMAT_ORDER.forEach(fmt=>{
    const info=CONVERT_FORMATS[fmt];
    const chip=el("button","lang-chip"+(c.format===fmt?" active":""),escapeHTML(info.label));
    chip.type="button";
    chip.addEventListener("click",()=>{ c.format=fmt; renderTab(); });
    formatRow.appendChild(chip);
  });
  formatBlock.appendChild(formatRow);
  grid.appendChild(formatBlock);

  // --- Quality (shape depends entirely on the selected format —
  // bitrate for lossy formats, compression level for FLAC, bit depth
  // for WAV, nothing at all for ALAC, which has no knob worth
  // exposing at this level of simplicity). ---
  const info=CONVERT_FORMATS[c.format];
  if(info.lossless && c.format!=="flac" && c.format!=="wav"){
    // ALAC
    grid.appendChild(el("p","convert-lossless-note",escapeHTML(tr("convert.losslessNote"))));
  } else if(c.format==="flac"){
    const block=el("div","");
    block.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.flacCompression"))));
    const row=el("div","convert-chip-row");
    for(let level=0;level<=8;level++){
      const chip=el("button","lang-chip"+(c.settings.flac.compressionLevel===level?" active":""),String(level));
      chip.type="button";
      chip.addEventListener("click",()=>{ c.settings.flac.compressionLevel=level; renderTab(); });
      row.appendChild(chip);
    }
    block.appendChild(row);
    block.appendChild(el("p","convert-lossless-note",escapeHTML(tr("convert.flacCompressionNote"))));
    grid.appendChild(block);
  } else if(c.format==="wav"){
    const block=el("div","");
    block.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.bitDepth"))));
    const row=el("div","convert-chip-row");
    [16,24].forEach(depth=>{
      const chip=el("button","lang-chip"+(c.settings.wav.bitDepth===depth?" active":""),depth+"-bit");
      chip.type="button";
      chip.addEventListener("click",()=>{ c.settings.wav.bitDepth=depth; renderTab(); });
      row.appendChild(chip);
    });
    block.appendChild(row);
    grid.appendChild(block);
  } else {
    // mp3 / aac / opus — bitrate
    const block=el("div","");
    block.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.bitrate"))));
    const row=el("div","convert-chip-row");
    CONVERT_BITRATES[c.format].forEach(kbps=>{
      const chip=el("button","lang-chip"+(c.settings[c.format].bitrateKbps===kbps?" active":""),kbps+" kbps");
      chip.type="button";
      chip.addEventListener("click",()=>{ c.settings[c.format].bitrateKbps=kbps; renderTab(); });
      row.appendChild(chip);
    });
    block.appendChild(row);
    grid.appendChild(block);
  }

  section.appendChild(grid);
  wrap.appendChild(section);
}



// ----------------------------------------------------------------
// OUTPUT — destination folder + what to do about a name collision
// ----------------------------------------------------------------

function renderConvertOutputSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section");
  section.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.outputTitle"))));

  section.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.outputFolder"))));
  const pathRow=el("div","convert-output-path-row");
  pathRow.appendChild(el("div","convert-output-path",escapeHTML(c.outputFolder||"")));
  const chooseBtn=el("button","amr-add-btn",escapeHTML(tr("convert.chooseFolder")));
  chooseBtn.addEventListener("click",chooseConvertOutputFolder);
  pathRow.appendChild(chooseBtn);
  section.appendChild(pathRow);

  const collisionBlock=el("div","convert-collision-row");
  collisionBlock.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.ifFileExists"))));
  const collisionRow=el("div","convert-chip-row");
  [["rename","convert.collision.rename"],["replace","convert.collision.replace"],["skip","convert.collision.skip"]].forEach(([mode,key])=>{
    const chip=el("button","lang-chip"+(c.collisionMode===mode?" active":""),escapeHTML(tr(key)));
    chip.type="button";
    chip.addEventListener("click",()=>{ c.collisionMode=mode; renderTab(); });
    collisionRow.appendChild(chip);
  });
  collisionBlock.appendChild(collisionRow);
  section.appendChild(collisionBlock);

  wrap.appendChild(section);
}



async function chooseConvertOutputFolder(){
  const dir=await window.electronAPI.selectFolder(state.convert.outputFolder||undefined);
  if(!dir) return;
  state.convert.outputFolder=dir;
  renderTab();
}



// ----------------------------------------------------------------
// PROGRESS — current file + overall, two independent bars
// ----------------------------------------------------------------

function renderConvertProgressSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section convert-progress-block");

  const current=c.queue.find(q=>q.id===c.currentJobId);

  const currentBlock=el("div","");
  const currentLabelRow=el("div","convert-progress-label-row");
  currentLabelRow.id="convertCurrentLabelRow";
  currentLabelRow.appendChild(el("span","",escapeHTML(tr("convert.currentFile")+(current?": "+(current.title||current.name):""))));
  currentLabelRow.appendChild(el("span","","0%"));
  currentBlock.appendChild(currentLabelRow);
  const currentTrack=el("div","convert-progress-track");
  const currentFill=el("div","convert-progress-fill");
  currentFill.id="convertCurrentFill";
  currentFill.style.width=(current ? (current.progressPercent||0) : 0)+"%";
  currentTrack.appendChild(currentFill);
  currentBlock.appendChild(currentTrack);
  section.appendChild(currentBlock);

  const overallBlock=el("div","");
  const overallLabelRow=el("div","convert-progress-label-row");
  overallLabelRow.id="convertOverallLabelRow";
  overallLabelRow.appendChild(el("span","",escapeHTML(tr("convert.overallProgress"))));
  overallLabelRow.appendChild(el("span","",escapeHTML(tr("convert.filesOf",{done:c.overallDone,total:c.overallTotal}))));
  overallBlock.appendChild(overallLabelRow);
  const overallTrack=el("div","convert-progress-track");
  const overallFill=el("div","convert-progress-fill");
  overallFill.id="convertOverallFill";
  const overallPct=c.overallTotal ? (c.overallDone/c.overallTotal)*100 : 0;
  overallFill.style.width=overallPct+"%";
  overallTrack.appendChild(overallFill);
  overallBlock.appendChild(overallTrack);
  section.appendChild(overallBlock);

  wrap.appendChild(section);
}



// ----------------------------------------------------------------
// CONTROLS — Start / Cancel
// ----------------------------------------------------------------

function renderConvertControlsRow(wrap){
  const c=state.convert;
  const row=el("div","convert-controls-row");

  if(c.isConverting){
    const cancelBtn=el("button","edit-cancel-btn",escapeHTML(tr("convert.cancel")));
    cancelBtn.addEventListener("click",cancelConversion);
    row.appendChild(cancelBtn);
  } else {
    const startBtn=el("button","edit-save-btn",escapeHTML(tr("convert.startConversion")));
    const hasWaiting=c.queue.some(q=>q.status==="waiting");
    if(!hasWaiting || !c.outputFolder) startBtn.disabled=true;
    startBtn.addEventListener("click",startConversion);
    row.appendChild(startBtn);
  }

  wrap.appendChild(row);
}



// ----------------------------------------------------------------
// COMPLETION
// ----------------------------------------------------------------

function renderConvertCompletionBanner(wrap){
  const summary=state.convert.lastRunSummary;
  const section=el("div","convert-section convert-complete");
  section.appendChild(el("div","convert-complete-icon","<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6 9 17l-5-5'/></svg>"));
  section.appendChild(el("h3","",escapeHTML(tr("convert.completeTitle"))));

  let summaryText=tr("convert.completeSummary",{count:summary.succeeded});
  if(summary.failed) summaryText+=tr("convert.completeSummaryFailed",{count:summary.failed});
  if(summary.skipped) summaryText+=tr("convert.completeSummarySkipped",{count:summary.skipped});
  section.appendChild(el("p","",escapeHTML(summaryText)));
  section.appendChild(el("div","convert-complete-path",escapeHTML(tr("convert.outputLocation",{path:summary.outputFolder}))));

  const actions=el("div","convert-complete-actions");
  const openBtn=el("button","amr-add-btn",escapeHTML(tr("convert.openOutputFolder")));
  openBtn.addEventListener("click",()=>window.electronAPI.openFolder(summary.outputFolder));
  actions.appendChild(openBtn);
  const dismissBtn=el("button","edit-cancel-btn",escapeHTML(tr("convert.startNewBatch")));
  dismissBtn.addEventListener("click",()=>{ state.convert.lastRunSummary=null; renderTab(); });
  actions.appendChild(dismissBtn);
  section.appendChild(actions);

  wrap.appendChild(section);
}



// ----------------------------------------------------------------
// THE CONVERSION MANAGER — a plain sequential queue runner. Every
// file is sent to FFmpeg one at a time (see req #17 — "a sequential
// queue is perfectly acceptable for the first implementation"); the
// per-file heavy lifting is entirely convertFile() in
// ffmpeg-bridge.js. This just walks the queue, updates each item's
// status, and keeps the two progress bars current.
// ----------------------------------------------------------------

async function startConversion(){
  const c=state.convert;
  if(c.isConverting) return;
  const pending=c.queue.filter(q=>q.status==="waiting");
  if(!pending.length || !c.outputFolder) return;

  c.isConverting=true;
  c.overallDone=0;
  c.overallTotal=pending.length;
  c.lastRunSummary=null;
  renderTab();

  let succeeded=0, failed=0, skipped=0;

  for(const item of pending){
    // Cancel button flips isConverting straight back to false — bail
    // out of the loop the moment that happens rather than starting
    // another file.
    if(!state.convert.isConverting) break;

    // A still-"waiting" item's remove button stays active even
    // mid-run (see buildConvertQueueRow) — if the person used it on
    // something further down this exact list, honor that as "don't
    // convert this one after all" instead of silently converting it
    // anyway once its turn comes up. overallDone still advances
    // either way, below, outside this if — so the Overall Progress
    // bar still reaches 100% by the time the run ends instead of
    // stalling short of it just because a removed item was never
    // counted.
    if(c.queue.includes(item)){
      item.status="converting";
      item.progressPercent=0;
      c.currentJobId=item.id;
      if(state.currentTab==="convert") renderTab();

      const resolved=await window.electronAPI.convertResolveOutputPath(
        c.outputFolder, item.name, CONVERT_FORMATS[c.format].ext, c.collisionMode
      );

      if(resolved.skip){
        item.status="skipped";
        skipped++;
      } else {
        const jobId=item.id; // reuse the queue item's own id as the FFmpeg job id — already unique, one job per item
        const result=await window.electronAPI.convertFile({
          jobId,
          inputPath:item.path,
          outputPath:resolved.path,
          format:c.format,
          settings:c.settings[c.format],
          durationSec:item.duration||0
        });

        if(result.success){
          item.status="completed";
          item.progressPercent=100;
          item.outputPath=result.outputPath;
          succeeded++;
        } else if(result.cancelled){
          item.status="cancelled";
        } else {
          item.status="failed";
          item.error=result.reason || null;
          failed++;
        }
      }
      c.currentJobId=null;
    }

    c.overallDone++;
    if(state.currentTab==="convert") renderTab();
  }

  // If Cancel was pressed mid-run, every item that never got a
  // chance to start is still sitting at "waiting" — leave those
  // alone rather than relabeling them "cancelled", since they're
  // exactly where they'd need to be to just press Start again.
  c.isConverting=false;
  c.lastRunSummary={succeeded, failed, skipped, outputFolder:c.outputFolder};
  renderTab();
}



function cancelConversion(){
  const c=state.convert;
  if(!c.isConverting) return;
  c.isConverting=false; // the running loop in startConversion() checks this and stops after the current file
  if(c.currentJobId) window.electronAPI.convertCancel(c.currentJobId);
}



// Live per-tick progress from ffmpeg-bridge.js's -progress pipe:1
// parsing (see convert-progress in main.js/preload.js). Deliberately
// mutates the DOM directly instead of calling renderTab() on every
// single tick — a full rebuild of the whole Convert tab several
// times a second would be wasteful and would fight the CSS
// transition on the progress bar fill. state.convert is still kept
// current either way, so switching tabs and back (or any other,
// unrelated renderTab() call) always redraws with the right numbers.
function handleConvertProgressTick({jobId, percent}){
  const c=state.convert;
  const item=c.queue.find(q=>q.id===jobId);
  if(!item || percent==null) return;
  item.progressPercent=percent;

  if(state.currentTab!=="convert") return;

  const fill=$("convertCurrentFill");
  if(fill) fill.style.width=percent+"%";
  const labelRow=$("convertCurrentLabelRow");
  if(labelRow && labelRow.lastElementChild) labelRow.lastElementChild.textContent=Math.round(percent)+"%";

  const row=document.querySelector('.convert-queue-row[data-job-row-id="'+CSS.escape(jobId)+'"] .convert-queue-row-progress-fill');
  if(row) row.style.width=percent+"%";
}

export { renderConvertTab, addFilesToConvertQueue, handleConvertProgressTick };
