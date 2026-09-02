const DB_NAME="music_player_db", DB_VERSION=3;
let db;

function setDb(value){ db=value; return db; }



function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=(e)=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks",{keyPath:"id"});
      if(!d.objectStoreNames.contains("playlists")) d.createObjectStore("playlists",{keyPath:"id"});
      if(!d.objectStoreNames.contains("folders")) d.createObjectStore("folders",{keyPath:"id"});
      if(!d.objectStoreNames.contains("playlistFolders")) d.createObjectStore("playlistFolders",{keyPath:"id"});
      if(!d.objectStoreNames.contains("lyrics")) d.createObjectStore("lyrics",{keyPath:"trackId"});
      if(!d.objectStoreNames.contains("settings")) d.createObjectStore("settings",{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}



function tx(store,mode){ return db.transaction(store,mode).objectStore(store); }



function idbPut(store,val){ return new Promise((res,rej)=>{ const r=tx(store,"readwrite").put(val); r.onsuccess=()=>res(val); r.onerror=()=>rej(r.error); }); }



function idbDelete(store,key){ return new Promise((res,rej)=>{ const r=tx(store,"readwrite").delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }



function idbGetAll(store){ return new Promise((res,rej)=>{ const r=tx(store,"readonly").getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }



function idbGet(store,key){ return new Promise((res,rej)=>{ const r=tx(store,"readonly").get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }



function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : "id-"+Date.now()+"-"+Math.random().toString(16).slice(2)); }



let orderSeed=Date.now();
function nextOrder(){ return orderSeed++; }



const state={
  tracks:[],
  playlists:[],
  folders:[],
  playlistFolders:[],
  playlistFolderId:null,
  favoritesId:null,
  playHistory:[],
  currentTab:"songs",
  filter:null,
  sortBy:"title-asc",
  albumSortBy:"track-asc",
  queue:[],
  queueIndex:-1,
  shuffle:false,
  shuffleHistory:[],
  repeat:"off",
  currentTrack:null,
  lyricsOpen:false,
  lyricsCache:{},
  lyricOffsets:{},
  lastLyricIdx:-2,
  theme:{bg:"pitchblack",accent:"blue"},
  playerBg:{image:null,blur:0},
  visualizer:{enabled:false,intensity:1},
  updateInfo:{state:"idle"},
  appVersion:null,
  selectMode:false,
  selectedIds:new Set(),
  selectType:null,
  language:"en",
  installedLanguages:["en"],
  volume:0.8,
  muted:false,
  eq:{enabled:false, gains:[0,0,0,0,0,0,0,0,0,0]},
  gapless:{enabled:false},
  convert:{
    ffmpegStatus:"unknown",
    ffmpegVersion:null,
    installError:null,
    installLog:[],
    queue:[],
    format:"mp3",
    settings:{ mp3:{bitrateKbps:192}, aac:{bitrateKbps:192}, opus:{bitrateKbps:160}, flac:{compressionLevel:5}, alac:{}, wav:{bitDepth:16} },
    collisionMode:"rename",
    outputFolder:null,
    isConverting:false,
    currentJobId:null,
    overallDone:0,
    overallTotal:0,
    lastRunSummary:null
  }
};



const AUDIO_EXT=["mp3","wav","ogg","m4a","flac","aac","opus","weba"];




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
