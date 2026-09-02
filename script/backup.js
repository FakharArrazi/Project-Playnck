import { state, $, idbGetAll, idbPut } from "./state.js";
import { tr, LANGUAGES } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { hydrateTrack } from "./init.js";
import { renderTab } from "./library-view.js";
import { openModal } from "./modal.js";


const BACKUP_FORMAT_VERSION=1;

function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataURL){
  return fetch(dataURL).then(r=>r.blob());
}

async function reloadLibraryFromDB(){
  const [tracksRaw, playlistsRaw, foldersRaw, playlistFoldersRaw] = await Promise.all([
    idbGetAll("tracks"), idbGetAll("playlists"), idbGetAll("folders"), idbGetAll("playlistFolders")
  ]);
  state.folders=foldersRaw||[];
  state.playlists=playlistsRaw||[];
  state.playlistFolders=playlistFoldersRaw||[];
  state.tracks=(tracksRaw||[]).map(hydrateTrack);
  renderTab();
}

async function exportLibraryBackup(){
  if(!(window.electronAPI && window.electronAPI.saveTextFile)){
    return {saved:false, reason:tr("backup.desktopOnly")};
  }

  const [tracks,playlists,folders,playlistFolders,lyrics,settingsRows]=await Promise.all([
    idbGetAll("tracks"), idbGetAll("playlists"), idbGetAll("folders"), idbGetAll("playlistFolders"),
    idbGetAll("lyrics"), idbGetAll("settings")
  ]);

  let skippedNoPath=0;
  const trackRows=await Promise.all(tracks.map(async t=>{
    if(!t.filePath) skippedNoPath++;
    return {
      id:t.id, title:t.title, artist:t.artist, album:t.album,
      duration:t.duration, folderId:t.folderId, dateAdded:t.dateAdded,
      trackNum: t.trackNum!=null ? t.trackNum : null,
      filePath: t.filePath||null,
      art: t.artBlob ? await blobToBase64(t.artBlob) : null
    };
  }));

  const payload={
    format:"playnck-backup", version:BACKUP_FORMAT_VERSION, exportedAt:new Date().toISOString(),
    tracks:trackRows, playlists, folders, playlistFolders, lyrics, settings:settingsRows
  };

  const filename=`playnck-backup-${new Date().toISOString().slice(0,10)}.json`;
  const result=await window.electronAPI.saveTextFile(filename, JSON.stringify(payload), "Playnck Backup", ["json"]);
  if(result && result.saved) return {saved:true, filePath:result.filePath, skippedNoPath};
  return {saved:false, reason:(result&&result.reason)||"canceled"};
}

async function importLibraryBackup(){
  if(!(window.electronAPI && window.electronAPI.openTextFile)){
    return {imported:false, reason:tr("backup.desktopOnly")};
  }
  const picked=await window.electronAPI.openTextFile("Playnck Backup", ["json"]);
  if(!picked) return {imported:false, reason:"canceled"};

  let payload;
  try{ payload=JSON.parse(picked.content); }
  catch(err){ return {imported:false, reason:tr("backup.invalidFile")}; }
  if(!payload || payload.format!=="playnck-backup"){
    return {imported:false, reason:tr("backup.invalidFile")};
  }

  let restored=0, skipped=0;
  for(const row of (payload.tracks||[])){
    if(!row.filePath){ skipped++; continue; }
    const artBlob = row.art ? await base64ToBlob(row.art).catch(()=>null) : null;
    await idbPut("tracks",{
      id:row.id, title:row.title, artist:row.artist, album:row.album,
      duration:row.duration, folderId:row.folderId, dateAdded:row.dateAdded,
      trackNum:row.trackNum, filePath:row.filePath,
      fileBlob:null, artBlob
    });
    restored++;
  }
  for(const p of (payload.playlists||[])) await idbPut("playlists",p);
  for(const f of (payload.folders||[])) await idbPut("folders",f);
  for(const pf of (payload.playlistFolders||[])) await idbPut("playlistFolders",pf);
  for(const l of (payload.lyrics||[])) await idbPut("lyrics",l);
  for(const s of (payload.settings||[])) await idbPut("settings",s);

  await reloadLibraryFromDB();
  return {imported:true, restored, skipped};
}

async function onBackupExportClick(){
  const statusEl=$("backupStatusText");
  if(!statusEl) return;
  statusEl.textContent=tr("backup.exporting");
  const result=await exportLibraryBackup();
  if(result.saved){
    statusEl.textContent = result.skippedNoPath>0
      ? tr("backup.exportedWithSkipped",{count:result.skippedNoPath})
      : tr("backup.exported");
  } else if(result.reason && result.reason!=="canceled"){
    statusEl.textContent=tr("backup.exportFailed",{reason:result.reason});
  } else {
    statusEl.textContent="";
  }
}

async function onBackupImportClick(){
  if(!confirm(tr("backup.importConfirm"))) return;
  const statusEl=$("backupStatusText");
  if(!statusEl) return;
  statusEl.textContent=tr("backup.importing");
  const result=await importLibraryBackup();
  if(result.imported){
    statusEl.textContent=tr("backup.imported",{restored:result.restored,skipped:result.skipped});
  } else if(result.reason && result.reason!=="canceled"){
    statusEl.textContent=tr("backup.importFailed",{reason:result.reason});
  } else {
    statusEl.textContent="";
  }
}

function buildLanguageBodyHTML(){
  const chips=state.installedLanguages.map(code=>
    `<button type="button" class="lang-chip${state.language===code?" active":""}" data-lang="${code}">${escapeHTML(LANGUAGES[code].native)}</button>`
  ).join("");
  const hasMore=Object.keys(LANGUAGES).some(code=>!state.installedLanguages.includes(code));
  const addBtnOrNote=hasMore
    ? `<button type="button" class="amr-add-btn" id="addLanguageBtn">${escapeHTML(tr("language.addButton"))}</button>`
    : `<p class="theme-note">${escapeHTML(tr("language.noMore"))}</p>`;
  return `
    <div class="theme-picker">
      <div>
        <div class="swatch-row" id="languageChipRow">${chips}</div>
      </div>
      ${addBtnOrNote}
      <p class="theme-note">${escapeHTML(tr("language.note"))}</p>
    </div>`;
}
const APP_VERSION_FALLBACK="1.0.11";
function openAboutModal(){
  const version=state.appVersion||APP_VERSION_FALLBACK;
  const bodyHTML=`
    <div class="about-body">
      <p class="about-tagline">${escapeHTML(tr("about.tagline"))}</p>
      <div class="info-grid">
        <div class="info-row"><span class="info-key">${escapeHTML(tr("about.buildVersion"))}</span><span class="info-val">v${escapeHTML(version)}</span></div>
      </div>
      <div class="about-community">
        <p class="about-community-text">${escapeHTML(tr("about.communityText"))}</p>
        <a class="about-action-btn" href="https://t.me/+taM7DL_CKsViNGM0" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M21.9 4.2c-.3-.2-.6-.3-1-.1L2.4 11.4c-.5.2-.8.6-.8 1.1 0 .5.4.9.9 1.1l4.7 1.5 1.8 5.8c.1.4.5.7.9.7.3 0 .5-.1.7-.3l2.6-2.5 4.8 3.5c.2.2.5.2.7.2.2 0 .4 0 .6-.1.4-.2.6-.5.7-.9l3.2-15.3c.1-.4-.1-.8-.4-1z"/></svg>
          ${escapeHTML(tr("about.telegramBtn"))}
        </a>
      </div>
      <div class="about-support">
        <p class="about-support-title">${escapeHTML(tr("about.supportTitle"))}</p>
        <p class="about-support-text">${escapeHTML(tr("about.supportText"))}</p>
        <a class="about-qr-link" href="https://app.binance.com/uni-qr/5tLuirTT" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(tr("about.donateBtn"))}">
          <img class="about-qr-img" src="docs/screenshots/Donation.jpg" alt="${escapeHTML(tr("about.supportQrAlt"))}">
        </a>
        <p class="about-qr-caption">${escapeHTML(tr("about.supportQrCaption"))}</p>
        <a class="about-action-btn" href="https://app.binance.com/uni-qr/5tLuirTT" target="_blank" rel="noopener noreferrer">
          ${escapeHTML(tr("about.donateBtn"))}
        </a>
      </div>
    </div>`;
  openModal(tr("nav.aboutUs"), bodyHTML);
}

export { onBackupExportClick, onBackupImportClick, buildLanguageBodyHTML, openAboutModal };
