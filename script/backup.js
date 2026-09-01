import { state, $, idbGetAll, idbPut } from "./state.js";
import { tr, LANGUAGES } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { hydrateTrack } from "./init.js";
import { renderTab } from "./library-view.js";
import { openModal } from "./modal.js";

/* ================================================================
   LIBRARY BACKUP / RESTORE
   Everything the app knows — tracks (as metadata + real file paths,
   never the raw audio itself), playlists, playlist folders, folders,
   cached lyrics, and settings — as one portable JSON file. This is
   the only way to carry a library between machines or recover it
   after a reinstall, since none of it is otherwise exported
   anywhere; it all just lives in this browser profile's IndexedDB.

   Deliberately excluded from the backup:
     - fileBlob: the actual audio bytes, kept only for tracks picked
       via a plain <input type=file>/drag-drop with no real path
       behind them (see hydrateTrack()). Embedding whole songs in a
       JSON file would make backups enormous, so those particular
       tracks just can't be carried by this — only path-backed ones
       (which is everything imported through a folder, the normal
       desktop flow) can be restored.
     - fileURL/artURL: session-only blob: URLs, meaningless outside
       the run that created them — stripped the same way every other
       idbPut("tracks",...) call site in this file already does.

   Cover art (artBlob) IS included, base64-encoded — unlike audio, a
   picture won't be re-derivable later by rescanning if the source
   file's own tags don't happen to have one embedded.
   ================================================================ */

const BACKUP_FORMAT_VERSION=1;

// Blob -> "data:<mime>;base64,...." string, for embedding in JSON.
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The reverse of blobToBase64 — takes a full "data:...;base64,..."
// string back out of a restored backup and turns it back into a real
// Blob suitable for storing in the artBlob field.
function base64ToBlob(dataURL){
  return fetch(dataURL).then(r=>r.blob());
}

// Re-reads tracks/playlists/folders fresh from IndexedDB into
// `state` and re-renders — the same read+hydrate importLibraryBackup
// needs after writing its restored rows, without repeating init()'s
// one-time migration/theme/first-run "Favorites" playlist logic here
// too (none of that is relevant mid-session).
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

// Gathers every store into one JSON-serializable object and asks the
// main process to show a native Save dialog for it. Returns
// {saved:true, filePath, skippedNoPath} on success, or
// {saved:false, reason} — reason:"canceled" if the person just
// backed out of the dialog, so callers can stay quiet in that case.
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

// Reads a previously exported backup file back in and MERGES it into
// the current library: rows with a matching id overwrite what's
// there now, everything else is left untouched — so restoring a
// backup never deletes tracks/playlists added since it was made.
// Tracks with no filePath at export time (see exportLibraryBackup's
// note above) are skipped here too, since there's no audio for them
// to point at. Returns {imported:false, reason:"canceled"} if the
// person backs out of the file picker, so callers can stay quiet.
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

// Settings > Language: a pill button per language that's been added
// so far (just English at first), plus a "+ Add language" button
// that installs the next entry from LANGUAGES (currently just
// French) and switches to it right away. Once every language in
// LANGUAGES has been installed, the button is swapped for a small
// note instead of just disappearing silently.
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
// Builds the "About Us" modal content: what the app is, the
// current build version (same state.appVersion already fetched via
// electronAPI.getAppVersion() for the Settings > Updates section —
// see wireUpdateEvents()/state init near the top of this file, so
// no extra IPC call is needed here), and a link to the community
// Telegram group. Falls back to the package.json version baked in
// at build time if, for some reason, electronAPI hasn't reported
// back yet (e.g. a non-Electron/web build) — see APP_VERSION_FALLBACK.
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
