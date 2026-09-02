import { state, $, listContainer, listTitle, backBtn, searchToggle, locatePlayingToggle,
  searchRow, searchInput, addMusicToggle, selectToggle, selectionBar, selCount } from "./state.js";
import { el, escapeHTML, fmtTime, replayMotion, fallbackArt } from "./utils.js";
import { tr, plural, SELECT_TYPE_PLURAL_KEY, pluralWord } from "./i18n.js";
import { getTrackArtURL } from "./init.js";
import { libraryTracks } from "./metadata.js";
import { playTrack } from "./player.js";
import { openFolderMenu } from "./folders.js";
import { renderConvertTab } from "./convert.js";
import { openTrackMenu } from "./menus.js";
import { createPlaylistPrompt, openPlaylistMenu } from "./playlists.js";
import { createPlaylistFolderPrompt, openPlaylistFolder, openPlaylistFolderMenu, countPlaylistsInFolder } from "./playlist-folders.js";


function computeAlbums(){
  const map=new Map();
  for(const t of libraryTracks()){
    const key=t.album+"|||"+t.artist;
    if(!map.has(key)) map.set(key,{key,album:t.album,artist:t.artist,art:getTrackArtURL(t),tracks:[]});
    map.get(key).tracks.push(t);
    if(!map.get(key).art && getTrackArtURL(t)) map.get(key).art=getTrackArtURL(t);
  }
  return sortGroups(Array.from(map.values()),"album");
}



function computeArtists(){
  const map=new Map();
  for(const t of libraryTracks()){
    if(!map.has(t.artist)) map.set(t.artist,{artist:t.artist,art:getTrackArtURL(t),tracks:[]});
    map.get(t.artist).tracks.push(t);
    if(!map.get(t.artist).art && getTrackArtURL(t)) map.get(t.artist).art=getTrackArtURL(t);
  }
  return sortGroups(Array.from(map.values()),"artist");
}



function sortGroups(groups,nameField){
  const sorted=[...groups];
  const totalDuration=g=>g.tracks.reduce((sum,t)=>sum+(t.duration||0),0);
  const newestDate=g=>g.tracks.reduce((max,t)=>Math.max(max,t.dateAdded||0),0);
  const oldestDate=g=>g.tracks.reduce((min,t)=>Math.min(min,t.dateAdded||Infinity),Infinity);
  switch(state.sortBy){
    case "title-desc":    sorted.sort((a,b)=>b[nameField].localeCompare(a[nameField])); break;
    case "artist-asc":    sorted.sort((a,b)=>a.artist.localeCompare(b.artist)); break;
    case "artist-desc":   sorted.sort((a,b)=>b.artist.localeCompare(a.artist)); break;
    case "duration-asc":  sorted.sort((a,b)=>totalDuration(a)-totalDuration(b)); break;
    case "duration-desc": sorted.sort((a,b)=>totalDuration(b)-totalDuration(a)); break;
    case "date-desc":     sorted.sort((a,b)=>newestDate(b)-newestDate(a)); break;
    case "date-asc":      sorted.sort((a,b)=>oldestDate(a)-oldestDate(b)); break;
    case "title-asc":
    default:              sorted.sort((a,b)=>a[nameField].localeCompare(b[nameField])); break;
  }
  return sorted;
}




const SORT_OPTIONS=[
  {value:"title-asc",     key:"sort.titleAsc"},
  {value:"title-desc",    key:"sort.titleDesc"},
  {value:"artist-asc",    key:"sort.artistAsc"},
  {value:"artist-desc",   key:"sort.artistDesc"},
  {value:"duration-asc",  key:"sort.durationAsc"},
  {value:"duration-desc", key:"sort.durationDesc"},
  {value:"date-desc",     key:"sort.dateNewest"},
  {value:"date-asc",      key:"sort.dateOldest"},
  {value:"track-asc",     key:"sort.trackNumber"}
];



function currentSortKey(){
  return (state.filter && state.filter.type==="album") ? "albumSortBy" : "sortBy";
}

function sortTracks(tracks){
  const sorted=[...tracks];
  const sortBy=state[currentSortKey()];
  switch(sortBy){
    case "title-desc":    sorted.sort((a,b)=>b.title.localeCompare(a.title)); break;
    case "artist-asc":    sorted.sort((a,b)=>a.artist.localeCompare(b.artist)); break;
    case "artist-desc":   sorted.sort((a,b)=>b.artist.localeCompare(a.artist)); break;
    case "duration-asc":  sorted.sort((a,b)=>a.duration-b.duration); break;
    case "duration-desc": sorted.sort((a,b)=>b.duration-a.duration); break;
    case "date-desc":     sorted.sort((a,b)=>(b.dateAdded||0)-(a.dateAdded||0)); break;
    case "date-asc":      sorted.sort((a,b)=>(a.dateAdded||0)-(b.dateAdded||0)); break;
    case "track-asc":     sorted.sort((a,b)=>{
                             const an=a.trackNum, bn=b.trackNum;
                             if(an==null && bn==null) return a.title.localeCompare(b.title);
                             if(an==null) return 1;
                             if(bn==null) return -1;
                             return an-bn || a.title.localeCompare(b.title);
                           }); break;
    case "title-asc":
    default:              sorted.sort((a,b)=>a.title.localeCompare(b.title)); break;
  }
  return sorted;
}




function renderTab(){
  listContainer.innerHTML="";
  virtualSongList=null;
  const q=(searchInput.value||"").toLowerCase().trim();

  const selType=currentSelectType();
  if(state.selectMode && state.selectType!==selType){
    state.selectMode=false;
    state.selectedIds.clear();
    selectToggle.classList.remove("active");
  }
  state.selectType=selType;
  selectToggle.classList.toggle("hidden", !selType);
  updateSelectionBar();

  const sortApplies = state.filter || state.currentTab==="songs" || state.currentTab==="albums" || state.currentTab==="artists";
  $("sortToggle").classList.toggle("hidden", !sortApplies);
  const searchApplies = state.filter || (state.currentTab!=="home" && state.currentTab!=="convert");
  searchToggle.classList.toggle("hidden", !searchApplies);
  const songListApplies = state.filter || state.currentTab==="songs";
  locatePlayingToggle.classList.toggle("hidden", !songListApplies);
  if(!searchApplies){ searchRow.classList.add("hidden"); searchInput.value=""; }

  if(state.filter){
    backBtn.classList.remove("hidden");
    listTitle.textContent=state.filter.title;
    let tracks=state.filter.tracks;
    if(q) tracks=tracks.filter(t=>matchQuery(t,q));
    renderSongList(tracks, state.filter.type==="playlist" ? state.filter.playlistId : null);
    addMusicToggle.classList.toggle("hidden", state.filter.type!=="playlist");
    replayMotion(listContainer,"view-enter",360);
    return;
  }
  backBtn.classList.add("hidden");
  addMusicToggle.classList.add("hidden");

  if(state.currentTab==="home"){
    listTitle.textContent=tr("nav.home");
    renderHomeTab();
  } else if(state.currentTab==="songs"){
    listTitle.textContent=tr("nav.songs");
    let tracks=libraryTracks();
    if(q) tracks=tracks.filter(t=>matchQuery(t,q));
    renderSongList(tracks,null);
  } else if(state.currentTab==="albums"){
    listTitle.textContent=tr("nav.albums");
    let albums=computeAlbums();
    if(q) albums=albums.filter(a=>a.album.toLowerCase().includes(q)||a.artist.toLowerCase().includes(q));
    renderAlbumGrid(albums);
  } else if(state.currentTab==="artists"){
    listTitle.textContent=tr("nav.artists");
    let artists=computeArtists();
    if(q) artists=artists.filter(a=>a.artist.toLowerCase().includes(q));
    renderArtistList(artists);
  } else if(state.currentTab==="playlists"){
    if(state.playlistFolderId && !state.playlistFolders.find(f=>f.id===state.playlistFolderId)){
      state.playlistFolderId=null;
    }
    const currentFolder = state.playlistFolderId ? state.playlistFolders.find(f=>f.id===state.playlistFolderId) : null;
    listTitle.textContent = currentFolder ? currentFolder.name : tr("nav.playlists");
    backBtn.classList.toggle("hidden", !currentFolder);
    renderPlaylistList();
  } else if(state.currentTab==="folders"){
    listTitle.textContent=tr("nav.folders");
    renderFolderList();
  } else if(state.currentTab==="convert"){
    listTitle.textContent=tr("nav.convert");
    renderConvertTab();
  }
  replayMotion(listContainer,"view-enter",360);
}



function matchQuery(t,q){
  return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q);
}



const SONG_ROW_HEIGHT=60;
const SONG_LIST_OVERSCAN=12;
let virtualSongList=null;
let virtualScrollFrame=null;

function scheduleVirtualSongRender(){
  if(!virtualSongList || virtualScrollFrame) return;
  if(Math.floor(listContainer.scrollTop/SONG_ROW_HEIGHT)===virtualSongList.firstVisible) return;
  virtualScrollFrame=requestAnimationFrame(()=>{
    virtualScrollFrame=null;
    const {tracks,playlistIdContext}=virtualSongList;
    renderSongList(tracks,playlistIdContext,true);
  });
}

function renderSongList(tracks, playlistIdContext, alreadySorted=false){
  if(!alreadySorted) tracks=sortTracks(tracks);

  if(!tracks.length){
    listContainer.appendChild(el("div","empty-state",tr("empty.noSongs")));
    return;
  }
  const allTracks=tracks;
  const queueTracks=allTracks;
  const virtualized=allTracks.length>120;
  let windowStart=0;
  let windowEnd=allTracks.length;
  if(virtualized){
    const viewportHeight=listContainer.clientHeight||600;
    const firstVisible=Math.floor(listContainer.scrollTop/SONG_ROW_HEIGHT);
    windowStart=Math.max(0,firstVisible-SONG_LIST_OVERSCAN);
    windowEnd=Math.min(allTracks.length,Math.ceil((listContainer.scrollTop+viewportHeight)/SONG_ROW_HEIGHT)+SONG_LIST_OVERSCAN);
    virtualSongList={tracks:allTracks,playlistIdContext,firstVisible};
    listContainer.replaceChildren();
    const topSpacer=el("div","song-virtual-spacer");
    topSpacer.style.height=(windowStart*SONG_ROW_HEIGHT)+"px";
    listContainer.appendChild(topSpacer);
    tracks=allTracks.slice(windowStart,windowEnd);
    listContainer.addEventListener("scroll",scheduleVirtualSongRender,{passive:true});
  }
  tracks.forEach(t=>{
    const selected=state.selectMode && state.selectedIds.has(t.id);
    const row=el("div","song-row"
      +(state.currentTrack&&state.currentTrack.id===t.id?" playing":"")
      +(state.selectMode?" selectable":"")
      +(selected?" selected":""));
    row.dataset.trackId=t.id;
    row.dataset.selectId=t.id;
    if(state.selectMode){
      row.appendChild(el("div","row-check"));
    }
    const img=document.createElement("img");
    img.className="thumb";
    img.loading="lazy";
    img.decoding="async";
    img.src=getTrackArtURL(t)||fallbackArt();
    const info=el("div","info");
    info.appendChild(el("div","title",escapeHTML(t.title)));
    info.appendChild(el("div","sub",escapeHTML(t.artist)));
    const dur=el("span","dur",fmtTime(t.duration));
    const menuBtn=el("button","menu-btn","&#8942;");
    menuBtn.addEventListener("click",(e)=>{ e.stopPropagation(); openTrackMenu(e,t,playlistIdContext); });
    row.appendChild(img); row.appendChild(info); row.appendChild(dur); row.appendChild(menuBtn);
    row.addEventListener("click",()=>{
      if(state.selectMode) toggleItemSelected(t.id);
      else playTrack(t,queueTracks);
    });
    listContainer.appendChild(row);
  });
  if(virtualized){
    const bottomSpacer=el("div","song-virtual-spacer");
    bottomSpacer.style.height=((allTracks.length-windowEnd)*SONG_ROW_HEIGHT)+"px";
    listContainer.appendChild(bottomSpacer);
  }
}



function refreshPlayingHighlight(){
  listContainer.querySelectorAll(".song-row.playing").forEach(r=>r.classList.remove("playing"));
  const id=state.currentTrack&&state.currentTrack.id;
  if(id==null) return;
  listContainer.querySelectorAll(`.song-row[data-track-id="${CSS.escape(String(id))}"]`).forEach(r=>r.classList.add("playing"));
}



function currentSongListTracks(){
  const q=(searchInput.value||"").toLowerCase().trim();
  let tracks;
  if(state.filter){
    tracks=state.filter.tracks;
    if(q) tracks=tracks.filter(t=>matchQuery(t,q));
  } else if(state.currentTab==="songs"){
    tracks=libraryTracks();
    if(q) tracks=tracks.filter(t=>matchQuery(t,q));
  } else {
    return null;
  }
  return sortTracks(tracks);
}

function scrollToNowPlaying(){
  if(!state.currentTrack) return;
  const existingRow=listContainer.querySelector(".song-row.playing");
  if(existingRow){
    const target=Math.max(0, existingRow.offsetTop - (listContainer.clientHeight/2) + (existingRow.offsetHeight/2));
    listContainer.scrollTo({top:target,behavior:"smooth"});
    flashRow(existingRow);
    return;
  }
  const tracks=currentSongListTracks();
  if(!tracks) return;
  const index=tracks.findIndex(t=>t.id===state.currentTrack.id);
  if(index===-1) return;
  const target=Math.max(0, (index*SONG_ROW_HEIGHT) - (listContainer.clientHeight/2) + (SONG_ROW_HEIGHT/2));
  listContainer.scrollTo({top:target,behavior:"smooth"});
  setTimeout(()=>{
    const row=listContainer.querySelector(".song-row.playing");
    if(row) flashRow(row);
  },420);
}

function flashRow(row){
  row.classList.remove("row-locate-flash");
  void row.offsetWidth;
  row.classList.add("row-locate-flash");
}



function refreshSelectionHighlight(id){
  const selected=state.selectedIds.has(id);
  listContainer.querySelectorAll(`[data-select-id="${CSS.escape(String(id))}"]`).forEach(elm=>{
    elm.classList.toggle("selected",selected);
  });
}



function toggleItemSelected(id){
  if(state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  refreshSelectionHighlight(id);
  updateSelectionBar();
}



function updateSelectionBar(){
  const n=state.selectedIds.size;
  selectionBar.classList.toggle("hidden", !state.selectMode || n===0);
  const pluralKey=SELECT_TYPE_PLURAL_KEY[state.selectType]||"song";
  selCount.textContent=plural(n,pluralKey)+" "+tr("sel.selectedSuffix");
  $("selAddPlaylistBtn").classList.toggle("hidden", state.selectType==="playlists");
}



function toggleSelectMode(){
  state.selectMode=!state.selectMode;
  state.selectedIds.clear();
  selectToggle.classList.toggle("active", state.selectMode);
  selectToggle.title=tr("header.selectPrefix")+pluralWord(SELECT_TYPE_PLURAL_KEY[state.selectType]||"song");
  renderTab();
  updateSelectionBar();
}



function isTrackListView(){
  return (state.currentTab==="songs" && !state.filter) || !!state.filter;
}



function currentSelectType(){
  if(isTrackListView()) return "track";
  if(!state.filter && ["albums","artists","playlists","folders"].includes(state.currentTab)) return state.currentTab;
  return null;
}



function renderHomeTab(){
  const wrap=el("div","home-view");

  const stats=el("div","home-stats");
  stats.appendChild(homeStatBox(libraryTracks().length,tr("nav.songs")));
  stats.appendChild(homeStatBox(computeAlbums().length,tr("nav.albums")));
  stats.appendChild(homeStatBox(computeArtists().length,tr("nav.artists")));
  wrap.appendChild(stats);

  const recent=libraryTracks().filter(t=>t.lastPlayedAt)
    .sort((a,b)=>b.lastPlayedAt-a.lastPlayedAt)
    .slice(0,3);
  wrap.appendChild(homeSection(tr("home.recentlyPlayed"),recent,"recent"));

  const top=libraryTracks().filter(t=>t.playCount>0)
    .sort((a,b)=>b.playCount-a.playCount)
    .slice(0,3);
  wrap.appendChild(homeSection(tr("home.topSongs"),top,"plays"));

  listContainer.appendChild(wrap);
}



function homeStatBox(value,label){
  const box=el("div","home-stat-box");
  box.appendChild(el("div","home-stat-value",String(value)));
  box.appendChild(el("div","home-stat-label",escapeHTML(label)));
  return box;
}



function homeSection(title,tracks,kind){
  const section=el("div","home-section");
  section.appendChild(el("div","home-section-title",escapeHTML(title)));
  if(!tracks.length){
    section.appendChild(el("div","empty-state", kind==="plays" ? tr("empty.noSongsPlayedYet") : tr("empty.nothingPlayedYet")));
    return section;
  }
  tracks.forEach(t=>{
    const row=el("div","song-row"+(state.currentTrack&&state.currentTrack.id===t.id?" playing":""));
    row.dataset.trackId=t.id;
    const img=document.createElement("img");
    img.className="thumb";
    img.loading="lazy";
    img.decoding="async";
    img.src=getTrackArtURL(t)||fallbackArt();
    const info=el("div","info");
    info.appendChild(el("div","title",escapeHTML(t.title)));
    info.appendChild(el("div","sub",escapeHTML(t.artist)));
    const stat=el("span","dur", kind==="plays"
      ? plural(t.playCount,"play")
      : fmtTime(t.duration));
    row.appendChild(img); row.appendChild(info); row.appendChild(stat);
    row.addEventListener("click",()=>playTrack(t,tracks));
    section.appendChild(row);
  });
  return section;
}



function renderAlbumGrid(albums){
  if(!albums.length){ listContainer.appendChild(el("div","empty-state",tr("empty.noAlbums"))); return; }
  const grid=el("div","grid-cards");
  albums.forEach(a=>{
    const selected=state.selectMode && state.selectedIds.has(a.key);
    const card=el("div","card"+(state.selectMode?" selectable":"")+(selected?" selected":""));
    card.dataset.selectId=a.key;
    const imgWrap=el("div","card-art-wrap");
    const img=document.createElement("img"); img.loading="lazy"; img.decoding="async"; img.src=a.art||fallbackArt();
    imgWrap.appendChild(img);
    if(state.selectMode) imgWrap.appendChild(el("div","row-check card-check"));
    card.appendChild(imgWrap);
    card.appendChild(el("div","name",escapeHTML(a.album)));
    card.appendChild(el("div","sub",escapeHTML(a.artist)));
    card.addEventListener("click",()=>{
      if(state.selectMode) toggleItemSelected(a.key);
      else{ state.filter={type:"album",title:a.album,tracks:a.tracks}; renderTab(); }
    });
    grid.appendChild(card);
  });
  listContainer.appendChild(grid);
}



function renderArtistList(artists){
  if(!artists.length){ listContainer.appendChild(el("div","empty-state",tr("empty.noArtists"))); return; }
  artists.forEach(a=>{
    const selected=state.selectMode && state.selectedIds.has(a.artist);
    const line=el("div","list-line"+(state.selectMode?" selectable":"")+(selected?" selected":""));
    line.dataset.selectId=a.artist;
    if(state.selectMode) line.appendChild(el("div","row-check"));
    const img=document.createElement("img"); img.loading="lazy"; img.decoding="async"; img.src=a.art||fallbackArt();
    line.appendChild(img);
    const wrap=el("div","wrap");
    wrap.appendChild(el("div","name",escapeHTML(a.artist)));
    wrap.appendChild(el("div","sub",plural(a.tracks.length,"song")));
    line.appendChild(wrap);
    line.addEventListener("click",()=>{
      if(state.selectMode) toggleItemSelected(a.artist);
      else{ state.filter={type:"artist",title:a.artist,tracks:a.tracks}; renderTab(); }
    });
    listContainer.appendChild(line);
  });
}



function renderPlaylistList(){
  const toolbar=el("div","playlist-toolbar");
  const newPlaylistBtn=el("button","new-playlist-btn",tr("playlists.newPlaylist"));
  newPlaylistBtn.addEventListener("click",()=>createPlaylistPrompt());
  const newFolderBtn=el("button","new-playlist-btn",tr("playlists.newFolder"));
  newFolderBtn.addEventListener("click",()=>createPlaylistFolderPrompt());
  toolbar.appendChild(newPlaylistBtn);
  toolbar.appendChild(newFolderBtn);
  listContainer.appendChild(toolbar);

  const parentId=state.playlistFolderId||null;
  const folders=state.playlistFolders.filter(f=>(f.parentId||null)===parentId);
  const playlists=state.playlists.filter(p=>(p.parentId||null)===parentId);
  const items=folders.map(data=>({kind:"folder",data}))
    .concat(playlists.map(data=>({kind:"playlist",data})))
    .sort((a,b)=>(a.data.order??0)-(b.data.order??0));

  if(parentId && !items.length){
    listContainer.appendChild(el("div","empty-state",tr("empty.emptyPlaylistFolder")));
    return;
  }

  items.forEach(({kind,data})=>{
    listContainer.appendChild(kind==="folder" ? renderPlaylistFolderRow(data) : renderPlaylistRow(data));
  });
}



function renderPlaylistFolderRow(f){
  const line=el("div","list-line folder-line");
  const iconWrap=el("div","icon-wrap","<svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='2'><path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'/></svg>");
  line.appendChild(iconWrap);
  const wrap=el("div","wrap");
  wrap.appendChild(el("div","name",escapeHTML(f.name)));
  wrap.appendChild(el("div","sub",plural(countPlaylistsInFolder(f.id),"playlist")));
  line.appendChild(wrap);
  const menuBtn=el("button","menu-btn","&#8942;");
  menuBtn.addEventListener("click",(e)=>{ e.stopPropagation(); openPlaylistFolderMenu(e,f); });
  line.appendChild(menuBtn);
  line.addEventListener("click",()=>openPlaylistFolder(f));
  return line;
}



function renderPlaylistRow(p){
  const tracks=p.trackIds.map(id=>state.tracks.find(t=>t.id===id)).filter(Boolean);
  const isFavorites=p.id===state.favoritesId;
  const selectableRow=state.selectMode && !isFavorites;
  const selected=selectableRow && state.selectedIds.has(p.id);
  const line=el("div","list-line"+(selectableRow?" selectable":"")+(selected?" selected":""));
  line.dataset.selectId=p.id;
  if(selectableRow) line.appendChild(el("div","row-check"));
  const img=document.createElement("img");
  img.loading="lazy"; img.decoding="async";
  img.src=(tracks[0]&&getTrackArtURL(tracks[0]))||fallbackArt();
  line.appendChild(img);
  const wrap=el("div","wrap");
  wrap.appendChild(el("div","name",escapeHTML(p.name)));
  wrap.appendChild(el("div","sub",plural(tracks.length,"song")));
  line.appendChild(wrap);
  if(!isFavorites){
    const menuBtn=el("button","menu-btn","&#8942;");
    menuBtn.addEventListener("click",(e)=>{ e.stopPropagation(); openPlaylistMenu(e,p); });
    line.appendChild(menuBtn);
  }
  line.addEventListener("click",()=>{
    if(selectableRow) toggleItemSelected(p.id);
    else{ state.filter={type:"playlist",title:p.name,tracks,playlistId:p.id}; renderTab(); }
  });
  return line;
}



function renderFolderList(){
  const toolbar=el("div","folder-toolbar");

  const addSongsBtn=el("button","",`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/></svg> ${escapeHTML(tr("folder.addSongs"))}`);
  addSongsBtn.addEventListener("click",()=>$("filesInput").click());

  const addFolderBtn=el("button","",`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'/></svg> ${escapeHTML(tr("folder.addFolder"))}`);
  addFolderBtn.addEventListener("click",()=>$("folderInput").click());

  toolbar.appendChild(addSongsBtn);
  toolbar.appendChild(addFolderBtn);
  listContainer.appendChild(toolbar);

  if(!state.folders.length){
    listContainer.appendChild(el("div","empty-state",tr("empty.noFolders")));
    return;
  }
  state.folders.forEach(f=>{
    const tracks=state.tracks.filter(t=>t.folderId===f.id);
    const selected=state.selectMode && state.selectedIds.has(f.id);
    const line=el("div","list-line folder-line"+(state.selectMode?" selectable":"")+(selected?" selected":""));
    line.dataset.selectId=f.id;
    if(state.selectMode) line.appendChild(el("div","row-check"));
    const iconWrap=el("div","icon-wrap","<svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='2'><path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'/></svg>");
    line.appendChild(iconWrap);
    const wrap=el("div","wrap");
    wrap.appendChild(el("div","name",escapeHTML(f.name)));
    wrap.appendChild(el("div","sub",plural(tracks.length,"song")));
    line.appendChild(wrap);
    const menuBtn=el("button","menu-btn","&#8942;");
    menuBtn.addEventListener("click",(e)=>{ e.stopPropagation(); openFolderMenu(e,f); });
    line.appendChild(menuBtn);
    line.addEventListener("click",()=>{
      if(state.selectMode) toggleItemSelected(f.id);
      else{ state.filter={type:"folder",title:f.name,tracks}; renderTab(); }
    });
    listContainer.appendChild(line);
  });
}

export {
  renderTab, renderSongList, refreshPlayingHighlight, scrollToNowPlaying,
  updateSelectionBar, toggleSelectMode, computeAlbums, computeArtists,
  SORT_OPTIONS, currentSortKey, matchQuery
};
