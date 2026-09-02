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
import { pruneHistoryEntries } from "./history.js";

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

  (tracksRaw||[]).forEach(raw=>{
    if(raw.filePath && raw.fileBlob){
      const slim={...raw};
      delete slim.fileBlob;
      idbPut("tracks",slim).catch(()=>{});
    }
  });

  const savedTheme=await idbGet("settings","theme");
  if(savedTheme && savedTheme.value){
    state.theme.bg=THEME_BG[savedTheme.value.bg] ? savedTheme.value.bg : state.theme.bg;
    state.theme.accent=THEME_ACCENT[savedTheme.value.accent] ? savedTheme.value.accent : state.theme.accent;
  }
  applyTheme();
  cacheThemeForNextBoot();

  const savedPlayerBg=await idbGet("settings","playerBg");
  if(savedPlayerBg && savedPlayerBg.value){
    state.playerBg.image=savedPlayerBg.value.image||null;
    state.playerBg.blur=typeof savedPlayerBg.value.blur==="number" ? savedPlayerBg.value.blur : 0;
  }
  applyPlayerBg();

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

  const savedVolume=await idbGet("settings","volume");
  if(savedVolume && savedVolume.value){
    if(typeof savedVolume.value.level==="number") state.volume=Math.min(1,Math.max(0,savedVolume.value.level));
    state.muted=!!savedVolume.value.muted;
  }
  applyVolume();

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
  updateVisualizerState();

  const savedHistory=await idbGet("settings","playHistory");
  state.playHistory=(savedHistory && Array.isArray(savedHistory.value)) ? savedHistory.value : [];
  pruneHistoryEntries();

  let fav=state.playlists.find(p=>p.name==="Favorites");
  if(!fav){ fav={id:uid(),name:"Favorites",trackIds:[]}; state.playlists.unshift(fav); idbPut("playlists",fav); }
  state.favoritesId=fav.id;

  [ ["playlists",state.playlists], ["playlistFolders",state.playlistFolders] ].forEach(([store,list])=>{
    list.forEach(item=>{
      if(typeof item.order!=="number"){ item.order=nextOrder(); idbPut(store,item); }
    });
  });

  renderTab();
  bindEvents();
  updateRepeatBadge();

  backfillTrackNumbers();

  verifyLibraryOnDisk();
  setInterval(verifyLibraryOnDisk, 10*60*1000);
  window.addEventListener("focus", verifyLibraryOnDisk);

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



function filePathToURL(filePath){
  return "playnck-file://local/?p="+encodeURIComponent(filePath);
}

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



function resolveFilePath(file){
  if(window.electronAPI && window.electronAPI.getPathForFile){
    const p=window.electronAPI.getPathForFile(file);
    if(p) return p;
  }
  return file.__electronPath || null;
}



function deriveFolderRootPath(file, filePath){
  const rel=file.webkitRelativePath;
  if(!rel || !filePath) return null;
  const relParts=rel.split("/");
  const sep=filePath.includes("\\") ? "\\" : "/";
  const pathParts=filePath.split(sep);
  const trimCount=relParts.length-1;
  if(trimCount<=0 || trimCount>=pathParts.length) return null;
  return pathParts.slice(0, pathParts.length-trimCount).join(sep);
}

export { init, hydrateTrack, getTrackArtURL, resolveFilePath, deriveFolderRootPath, filePathToURL };
