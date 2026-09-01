import { state, setDb, openDB, idbGetAll, idbGet, idbPut, uid, nextOrder } from "./state.js";
import { applyI18n, LANGUAGES } from "./i18n.js";
import { applyTheme, cacheThemeForNextBoot, THEME_BG, THEME_ACCENT } from "./theme.js";
import { renderTab } from "./library-view.js";
import { applyPlayerBg, refreshUpdateUI } from "./settings.js";
import { applyVolume } from "./volume.js";
import { verifyLibraryOnDisk, backfillTrackNumbers } from "./metadata.js";
import { updateRepeatBadge } from "./now-playing-ui.js";
import { updateVisualizerState } from "./visualizer.js";
import { EQ_BANDS } from "./equalizer.js";
import { bindEvents } from "./bindings.js";

/* ================================================================
   INIT
   Runs once when the page loads: opens the database, restores
   everything that was saved last time (songs, playlists, folders),
   makes sure a "Favorites" playlist exists, then does the first
   render and wires up every button.
   ================================================================ */
init();
async function init(){
  setDb(await openDB());

  const [tracksRaw, playlistsRaw, foldersRaw, playlistFoldersRaw] = await Promise.all([
    idbGetAll("tracks"), idbGetAll("playlists"), idbGetAll("folders"), idbGetAll("playlistFolders")
  ]);

  state.folders=foldersRaw||[];
  state.playlists=playlistsRaw||[];
  state.playlistFolders=playlistFoldersRaw||[];
  state.tracks=(tracksRaw||[]).map(hydrateTrack);

  // One-time migration for libraries saved before this version:
  // older builds stored a full Blob copy of the audio in IndexedDB
  // *even for* tracks that already had a resolvable real path on
  // disk (filePath). Those no longer need the duplicate now that
  // hydrateTrack() streams path-backed tracks straight from disk
  // (see playnck-file:// in main.js) — strip fileBlob back out and
  // re-save the slimmer record so existing installs reclaim that
  // IndexedDB space too, not just new imports going forward. Wrapped
  // so a failure here (e.g. private-browsing quota weirdness) can
  // never block startup.
  (tracksRaw||[]).forEach(raw=>{
    if(raw.filePath && raw.fileBlob){
      const slim={...raw};
      delete slim.fileBlob;
      idbPut("tracks",slim).catch(()=>{});
    }
  });

  // Restore the saved theme (if any) and paint it before the first
  // render, so the UI never flashes the default theme first.
  const savedTheme=await idbGet("settings","theme");
  if(savedTheme && savedTheme.value){
    state.theme.bg=THEME_BG[savedTheme.value.bg] ? savedTheme.value.bg : state.theme.bg;
    state.theme.accent=THEME_ACCENT[savedTheme.value.accent] ? savedTheme.value.accent : state.theme.accent;
  }
  applyTheme();
  cacheThemeForNextBoot(); // keeps theme-boot.js's synchronous cache in sync with IndexedDB's authoritative value, even if the user never opens Settings this session

  // Restore the saved Player background image + blur (if any) and
  // paint it before the first render, same reasoning as the theme
  // restore just above — no flash of a bare panel then a pop-in image.
  const savedPlayerBg=await idbGet("settings","playerBg");
  if(savedPlayerBg && savedPlayerBg.value){
    state.playerBg.image=savedPlayerBg.value.image||null;
    state.playerBg.blur=typeof savedPlayerBg.value.blur==="number" ? savedPlayerBg.value.blur : 0;
  }
  applyPlayerBg();

  // Restore the saved language (and whatever other languages had
  // been added via "+ Add language") before the first render, same
  // reasoning as theme/playerBg above — no flash of the wrong
  // language before this settles in.
  const savedLanguage=await idbGet("settings","language");
  if(savedLanguage && savedLanguage.value){
    const val=savedLanguage.value;
    if(Array.isArray(val.installed)){
      const installed=val.installed.filter(code=>LANGUAGES[code]);
      if(installed.length) state.installedLanguages=installed;
    }
    if(val.active && LANGUAGES[val.active] && state.installedLanguages.includes(val.active)){
      state.language=val.active;
    }
  }
  if(!state.installedLanguages.includes("en")) state.installedLanguages.unshift("en");
  applyI18n();

  // Restore the saved volume level + mute flag (if any), same
  // reasoning as theme/playerBg/language above — applied before the
  // first render so the slider/icon never flash the default 80%
  // then jump to whatever was saved last time.
  const savedVolume=await idbGet("settings","volume");
  if(savedVolume && savedVolume.value){
    if(typeof savedVolume.value.level==="number") state.volume=Math.min(1,Math.max(0,savedVolume.value.level));
    state.muted=!!savedVolume.value.muted;
  }
  applyVolume();

  // Settings > Audio: EQ gains/on-off and Gapless Playback's on-off,
  // same "settings" key/value store as everything else here. Just
  // restoring the plain values into state — the actual Web Audio
  // graph these feed into (ensureAudioGraph/applyEqGains, see the
  // EQUALIZER section further down) isn't built yet at this point,
  // since that only happens lazily on first real use.
  const savedEq=await idbGet("settings","equalizer");
  if(savedEq && savedEq.value){
    state.eq.enabled=!!savedEq.value.enabled;
    if(Array.isArray(savedEq.value.gains) && savedEq.value.gains.length===EQ_BANDS.length){
      state.eq.gains=savedEq.value.gains.slice();
    }
  }
  const savedGapless=await idbGet("settings","gapless");
  if(savedGapless && savedGapless.value){
    state.gapless.enabled=!!savedGapless.value.enabled;
  }
  const savedVisualizer=await idbGet("settings","visualizer");
  if(savedVisualizer && savedVisualizer.value){
    state.visualizer.enabled=!!savedVisualizer.value.enabled;
    if(typeof savedVisualizer.value.intensity==="number" && isFinite(savedVisualizer.value.intensity)){
      state.visualizer.intensity=Math.max(0,Math.min(2,savedVisualizer.value.intensity));
    }
  }
  updateVisualizerState(); // just syncs the canvas's hidden class at this point — nothing plays yet, so the render loop itself won't start until playback does

  // Every install gets exactly one built-in "Favorites" playlist,
  // created the first time the app ever runs.
  let fav=state.playlists.find(p=>p.name==="Favorites");
  if(!fav){ fav={id:uid(),name:"Favorites",trackIds:[]}; state.playlists.unshift(fav); idbPut("playlists",fav); }
  state.favoritesId=fav.id;

  // Playlists/folders saved before ordering existed (or freshly
  // migrated from an older version with no "order" field at all)
  // get one assigned now, in whatever order they happened to load
  // in, so the Playlists tab has a stable, restart-proof order from
  // here on instead of re-deriving one from IndexedDB's own (mostly
  // meaningless, since ids are random) key order every launch.
  [ ["playlists",state.playlists], ["playlistFolders",state.playlistFolders] ].forEach(([store,list])=>{
    list.forEach(item=>{
      if(typeof item.order!=="number"){ item.order=nextOrder(); idbPut(store,item); }
    });
  });

  renderTab();
  bindEvents();
  updateRepeatBadge();     // make sure the repeat badge starts out correctly hidden

  // One-time migration for libraries saved before the Track Number
  // sort existed: those track records have no trackNum field at all
  // (not even null), so re-read each file's tags in the background
  // to backfill it. Fired-and-forgotten here (not awaited) so it
  // never delays startup — see backfillTrackNumbers() below.
  backfillTrackNumbers();

  // Self-heals the library against changes made outside the app
  // (files/folders moved, renamed, or deleted on disk; new songs
  // dropped into an already-added folder) — see verifyLibraryOnDisk()
  // above. Fired-and-forgotten at startup for the same reason as
  // backfillTrackNumbers() just above, then re-run periodically and
  // whenever the window regains focus (the common case: the user
  // switches to Explorer/Finder, changes something, switches back).
  // Total no-op on a plain web build (verifyLibraryOnDisk() bails
  // immediately without window.electronAPI).
  verifyLibraryOnDisk();
  setInterval(verifyLibraryOnDisk, 10*60*1000); // every 10 minutes while the app stays open
  window.addEventListener("focus", verifyLibraryOnDisk);

  // --- Settings > Updates (Electron only, total no-op elsewhere) ---
  // Grabs the running version once (for the "up to date" label) and
  // subscribes to live status pushed from main.js's autoUpdater
  // listeners. refreshUpdateUI() safely no-ops whenever the Settings
  // modal isn't currently showing the Updates section.
  if(window.electronAPI && window.electronAPI.getAppVersion){
    window.electronAPI.getAppVersion().then(v=>{ state.appVersion=v; refreshUpdateUI(); }).catch(()=>{});
  }
  if(window.electronAPI && window.electronAPI.onUpdateStatus){
    window.electronAPI.onUpdateStatus(info=>{
      state.updateInfo=info||{state:"idle"};
      refreshUpdateUI();
    });
  }
}



// Builds the playnck-file:// URL (see main.js) that streams a track
// straight off disk by its real path — supports seeking (range
// requests) the same as any other streamed audio URL. Electron
// only; nothing calls this unless t.filePath is already set, which
// only ever happens when resolveFilePath() succeeded.
function filePathToURL(filePath){
  return "playnck-file://local/?p="+encodeURIComponent(filePath);
}

// Turns a raw track record from IndexedDB into a "hydrated" one
// with a real, playable URL for its audio and cover art.
//   - Tracks with a known real path on disk (Electron only) stream
//     straight from disk via playnck-file:// — no Blob involved, so
//     nothing needs to be duplicated into IndexedDB for these.
//   - Everything else (plain web, or a file Electron couldn't
//     resolve a path for) falls back to a blob: URL built from the
//     stored Blob, exactly as before.
// blob: URLs are NOT saved to the database — only the underlying
// Blob is (when there is one).
function hydrateTrack(t){
  t.fileURL = t.filePath ? filePathToURL(t.filePath)
            : (t.fileBlob ? URL.createObjectURL(t.fileBlob) : null);
  t.artURL = null;
  return t;
}

function getTrackArtURL(track){
  if(!track.artURL && track.artBlob) track.artURL=URL.createObjectURL(track.artBlob);
  return track.artURL;
}



// Best-effort lookup of a File's real absolute path on disk.
// Total no-op (returns null) outside the Electron build, so this
// is safe to call unconditionally from anywhere.
//   - Files picked via <input type=file> or drag/drop: resolved
//     through webUtils.getPathForFile(), bridged from preload.js.
//   - Files rebuilt from IPC bytes (the "Open with" flow in
//     script.js's DESKTOP OPEN WITH INTEGRATION block below):
//     webUtils can't help since that File wasn't picked from a
//     dialog, so main.js's original path is stashed directly on
//     the object as file.__electronPath before it reaches here.
function resolveFilePath(file){
  if(window.electronAPI && window.electronAPI.getPathForFile){
    const p=window.electronAPI.getPathForFile(file);
    if(p) return p;
  }
  return file.__electronPath || null;
}



// Best-effort derivation of a folder's real absolute root directory
// on disk from one of the files inside it, so it can be found again
// later (see rescanFolders()/verifyLibraryOnDisk() further down) —
// state.folders otherwise only ever knows a folder by the display
// name taken from its top path segment, which isn't enough to walk
// the real directory again.
//   file.webkitRelativePath — only set on Files that came from the
//   "Add Folder" <input webkitdirectory> picker (see the folderInput
//   handler below) — looks like "MyMusic/Rock/song.mp3", always with
//   forward slashes regardless of OS. filePath is that same file's
//   real absolute path, e.g. "C:\Users\bob\Music\MyMusic\Rock\song.mp3"
//   (Electron only — resolveFilePath() above). Stripping as many
//   trailing path components off filePath as webkitRelativePath has
//   *beyond* its first segment leaves exactly the folder's own root:
//   "C:\Users\bob\Music\MyMusic".
// Returns null for anything that didn't come from that picker (plain
// "Add Songs"/drag-drop, or a file resolveFilePath() couldn't place
// on disk at all) — those never had a real folder selection to
// derive a root from in the first place.
function deriveFolderRootPath(file, filePath){
  const rel=file.webkitRelativePath;
  if(!rel || !filePath) return null;
  const relParts=rel.split("/");                              // webkitRelativePath is always forward-slash
  const sep=filePath.includes("\\") ? "\\" : "/";           // filePath uses the OS's real separator
  const pathParts=filePath.split(sep);
  const trimCount=relParts.length-1;                           // everything in rel beyond the folder root itself
  if(trimCount<=0 || trimCount>=pathParts.length) return null;
  return pathParts.slice(0, pathParts.length-trimCount).join(sep);
}

export { init, hydrateTrack, getTrackArtURL, resolveFilePath, deriveFolderRootPath, filePathToURL };
