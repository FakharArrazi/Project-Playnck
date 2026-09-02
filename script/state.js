/* ================================================================
   DB LAYER
   Tiny wrapper around IndexedDB so the rest of the app can just
   call idbGet/idbPut/idbGetAll/idbDelete without touching the
   verbose native IndexedDB API directly. Everything the user adds
   (songs, playlists, folders) is saved here so it's still there
   next time the page is opened.
   ================================================================ */
const DB_NAME="music_player_db", DB_VERSION=3;
let db;

function setDb(value){ db=value; return db; }



// Opens (and, on first run, creates) the IndexedDB database and
// its object stores. Returns a promise that resolves with
// the open database connection.
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=(e)=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks",{keyPath:"id"});
      if(!d.objectStoreNames.contains("playlists")) d.createObjectStore("playlists",{keyPath:"id"});
      if(!d.objectStoreNames.contains("folders")) d.createObjectStore("folders",{keyPath:"id"});
      // Playlist folders — the Playlists tab's own folder hierarchy
      // (unrelated to "folders" above, which groups imported songs
      // by their real disk location). A playlist or a playlist
      // folder points at its parent via parentId, so nesting is just
      // this one flat store plus that one pointer — see
      // playlist-folders.js. Bumped DB_VERSION to 3 to add it; the
      // guard above means every existing store/row is left untouched.
      if(!d.objectStoreNames.contains("playlistFolders")) d.createObjectStore("playlistFolders",{keyPath:"id"});
      if(!d.objectStoreNames.contains("lyrics")) d.createObjectStore("lyrics",{keyPath:"trackId"});
      if(!d.objectStoreNames.contains("settings")) d.createObjectStore("settings",{keyPath:"key"});   // small key/value store — currently just holds the saved theme
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}



// Shortcut for grabbing an object store in a given transaction mode.
function tx(store,mode){ return db.transaction(store,mode).objectStore(store); }



// Saves (creates or overwrites) one record in the given store.
function idbPut(store,val){ return new Promise((res,rej)=>{ const r=tx(store,"readwrite").put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error); }); }



// Deletes one record (by key) from the given store.
function idbDelete(store,key){ return new Promise((res,rej)=>{ const r=tx(store,"readwrite").delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }



// Reads every record out of a store as an array.
function idbGetAll(store){ return new Promise((res,rej)=>{ const r=tx(store,"readonly").getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }



// Reads a single record (by key) from a store.
function idbGet(store,key){ return new Promise((res,rej)=>{ const r=tx(store,"readonly").get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }



// Generates a short random unique id, used for every track/
// playlist/folder created in the app. Falls back to a
// timestamp+random string on very old browsers without
// crypto.randomUUID.
function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : "id-"+Date.now()+"-"+Math.random().toString(16).slice(2)); }



// Hands out a monotonically increasing sort key, used as the
// "order" field on playlists and playlist folders so sibling items
// keep a stable, restart-proof order (see playlist-folders.js).
// Seeded from Date.now() so anything created this session sorts
// after everything restored from a previous one, then just counts
// up — simpler and collision-proof compared to calling Date.now()
// again for every single item.
let orderSeed=Date.now();
function nextOrder(){ return orderSeed++; }



/* ================================================================
   APP STATE
   One plain object holding everything the UI needs to render.
   Nothing fancy — functions read state.* directly and call
   renderTab() (or a smaller targeted update) whenever it changes.
   ================================================================ */
const state={
  tracks:[],              // every imported song: {id,title,artist,album,duration,folderId,dateAdded,fileBlob,artBlob,fileURL,artURL}
  playlists:[],           // {id,name,trackIds:[],parentId,order} — parentId points at a state.playlistFolders entry (or is null/undefined for a root-level playlist), see playlist-folders.js
  folders:[],             // {id,name}
  playlistFolders:[],     // {id,name,parentId,order} — the Playlists tab's folder tree; parentId points at another entry here (or is null/undefined for a root-level folder) — see playlist-folders.js
  playlistFolderId:null,  // id of the playlist folder currently open in the Playlists tab (null = root) — session-only, like state.filter, never persisted
  favoritesId:null,       // id of the auto-created "Favorites" playlist
  playHistory:[],         // read-only playback log for the "☰" menu's History view: [{id,trackId,title,artist,album,playedAt}], newest first, pruned to the last HISTORY_RETENTION_DAYS — see history.js. Separate from playCount/lastPlayedAt above: those track one running total per track for Home's Recently Played/Top Songs, this keeps every individual play as its own dated entry.
  currentTab:"songs",      // which sidebar tab is active: home|songs|albums|artists|playlists|folders|convert
  filter:null,            // when drilled into an album/artist/playlist/folder: {type,value,title,tracks}
  sortBy:"title-asc",     // current song sort order everywhere EXCEPT inside a drilled-into album — see the SORTING section below
  albumSortBy:"track-asc", // current song sort order specifically while viewing a single album's tracklist — kept separate so opening an album always starts ordered by Track Number, without that choice bleeding into the Songs tab, Artists, Playlists, or Folders
  queue:[],               // array of track ids representing the current playable order
  queueIndex:-1,          // index of the currently-playing track inside "queue"
  shuffle:false,
  shuffleHistory:[],      // queue indices visited via shuffle, in order — lets prevTrack step back through actual shuffle order instead of re-randomizing
  repeat:"off",           // "off" | "all" | "one"
  currentTrack:null,
  lyricsOpen:false,
  lyricsCache:{},         // trackId -> parsed lyric lines (or null if none found)
  lyricOffsets:{},        // trackId -> manual sync offset in ms (+delays lyrics, -shows them earlier), from the Sync Lyrics modal
  lastLyricIdx:-2,        // index of the phrase currently shown in the lyrics pane
  theme:{bg:"pitchblack",accent:"blue"},   // current theme choice — see THEME_BG/THEME_ACCENT below
  playerBg:{image:null,blur:0},      // Settings > Player: custom background image (data URL) shown behind the now-playing panel, plus its blur amount in px (0-20)
  visualizer:{enabled:false,intensity:1},  // Settings > Player: subtle audio-reactive bars along the bottom edge of the panel, plus an opacity multiplier (1 = default look, up to 2 = more pronounced) — see the VISUALIZER section below
  updateInfo:{state:"idle"},         // last "update-status" event from main.js's autoUpdater (Electron only) — see Settings > Updates
  appVersion:null,                   // this build's version, filled in once via window.electronAPI.getAppVersion()
  selectMode:false,       // true while the current list is showing checkboxes for multi-select
  selectedIds:new Set(),  // ids currently checked while selectMode is on (meaning depends on selectType)
  selectType:null,        // what kind of item selectedIds holds: "track"|"albums"|"artists"|"playlists"|"folders"
  language:"en",           // active UI language — see INTERNATIONALIZATION below
  installedLanguages:["en"], // language codes added via Settings > Language's "+ Add language" button
  volume:0.8,              // 0-1, remembered playback level — see the VOLUME section below
  muted:false,             // true after the M key/mute action; volume itself is untouched so unmuting restores exactly where it was
  eq:{enabled:false, gains:[0,0,0,0,0,0,0,0,0,0]}, // 10-band graphic EQ, one gain (dB, -12..12) per EQ_BANDS entry — see the EQUALIZER section below
  gapless:{enabled:false},  // crossfade-based smoothing between tracks — see the GAPLESS PLAYBACK section below
  convert:{                 // Convert tab — see the CONVERT TAB section below. Entirely in-memory and never persisted anywhere: this is a one-off conversion workspace, deliberately separate from the music library.
    ffmpegStatus:"unknown", // "unknown" | "checking" | "ready" | "missing" | "installing" | "install-failed"
    ffmpegVersion:null,
    installError:null,
    installLog:[],          // raw status lines streamed from winget while ffmpegStatus is "installing" — see onFFmpegInstallProgress in preload.js
    queue:[],                // [{id, path, name, ext, sizeBytes, duration, title, artist, status, progressPercent, error, outputPath}] — status: waiting|converting|completed|failed|skipped|cancelled
    format:"mp3",            // one of CONVERT_FORMATS's keys, just above renderConvertTab() below
    settings:{ mp3:{bitrateKbps:192}, aac:{bitrateKbps:192}, opus:{bitrateKbps:160}, flac:{compressionLevel:5}, alac:{}, wav:{bitDepth:16} }, // one settings object per format, kept independently so flipping the format picker back and forth never loses what was chosen
    collisionMode:"rename",  // "rename" | "replace" | "skip" — what happens when a chosen output file already exists
    outputFolder:null,       // filled in with a sensible default (OS Music/Playnck Converted) the first time FFmpeg is confirmed ready
    isConverting:false,
    currentJobId:null,       // jobId of whichever queued file is actively being sent to FFmpeg right now
    overallDone:0,           // files finished (success, failure, or skip) since Start was pressed — for the Overall Progress bar
    overallTotal:0,          // queue length at the moment Start was pressed, fixed for that run so adding files mid-run can't shift the denominator
    lastRunSummary:null      // {succeeded, failed, skipped, outputFolder}, shown by the Completion state once a run finishes
  }
};



// File extensions treated as playable audio when importing.
const AUDIO_EXT=["mp3","wav","ogg","m4a","flac","aac","opus","weba"];




/* ================================================================
   DOM REFERENCES
   Grabbed once up front so the rest of the code can reuse these
   short names instead of calling getElementById everywhere.
   ================================================================ */
const $=(id)=>document.getElementById(id);
const listContainer=$("listContainer");
const listTitle=$("listTitle");
const backBtn=$("backBtn");
const searchToggle=$("searchToggle");
const locatePlayingToggle=$("locatePlayingToggle");
const searchRow=$("searchRow");
const searchInput=$("searchInput");
const addMusicToggle=$("addMusicToggle");
const selectToggle=$("selectToggle");
const selectionBar=$("selectionBar");
const selCount=$("selCount");
const audioEl=$("audioEl");
const playerPanel=$("playerPanel");
const volumeBtn=$("volumeBtn");
const volumePopup=$("volumePopup");
const volumeSlider=$("volumeSlider");
const volumePct=$("volumePct");
const volumeIcon=$("volumeIcon");

export {
  DB_NAME, DB_VERSION, db, setDb, openDB, tx, idbPut, idbDelete, idbGetAll, idbGet, uid, nextOrder,
  state, AUDIO_EXT,
  $, listContainer, listTitle, backBtn, searchToggle, locatePlayingToggle, searchRow,
  searchInput, addMusicToggle, selectToggle, selectionBar, selCount, audioEl, playerPanel,
  volumeBtn, volumePopup, volumeSlider, volumePct, volumeIcon
};
