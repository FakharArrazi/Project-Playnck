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

/* ================================================================
   GROUPING
   Turns the flat state.tracks array into the grouped shapes the
   Albums and Artists tabs need (one entry per album / per artist,
   each carrying its own list of tracks and a representative image).
   ================================================================ */

// Groups tracks by "album + artist" (so two different artists'
// albums that happen to share a name don't get merged together).
// Reads through libraryTracks() (see its comment) so an unpersisted
// external track doesn't show up as an "album" of its own.
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



// Groups tracks by artist name. See computeAlbums() just above.
function computeArtists(){
  const map=new Map();
  for(const t of libraryTracks()){
    if(!map.has(t.artist)) map.set(t.artist,{artist:t.artist,art:getTrackArtURL(t),tracks:[]});
    map.get(t.artist).tracks.push(t);
    if(!map.get(t.artist).art && getTrackArtURL(t)) map.get(t.artist).art=getTrackArtURL(t);
  }
  return sortGroups(Array.from(map.values()),"artist");
}



// Orders a list of album/artist groups according to state.sortBy,
// so the sort menu affects the Albums and Artists tabs the same
// way it affects the Songs tab instead of always falling back to
// a hardcoded alphabetical order. "nameField" is which property
// on the group holds its display name ("album" for the Albums
// tab, "artist" for the Artists tab) — that's what "title" sort
// options key off of, since a group doesn't have a separate title.
// "duration" sorts by the summed length of every track in the
// group. Never mutates the array it's given.
function sortGroups(groups,nameField){
  const sorted=[...groups];
  const totalDuration=g=>g.tracks.reduce((sum,t)=>sum+(t.duration||0),0);
  // A group's "date" is however recently/long-ago its most/least
  // recently added track was added — that single track is what
  // decides where the whole album/artist lands in the list.
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



/* ================================================================
   SORTING
   Powers the new sort button in the list header. Two independent
   preferences are kept — state.sortBy (Songs tab, Artists,
   Playlists, Folders) and state.albumSortBy (only while viewing a
   single album's tracklist) — so opening any album always starts
   sorted by Track Number by default, without that choice leaking
   into every other list, and picking a different order (say,
   Duration) for one album doesn't change the default everywhere
   else either. currentSortKey() below is the single place that
   decides which of the two applies; sortTracks() is called every
   time a list of songs is about to be drawn on screen.
   ================================================================ */

// The six sort orders offered in the sort menu, in the order they
// should appear. "value" is stored in state.sortBy/state.albumSortBy
// (see currentSortKey()); "label" is what's shown to the user.
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



// Which of the two sort preferences is currently "live" — the
// album-specific one while drilled into a single album, the general
// one everywhere else (Songs tab, or drilled into an artist/
// playlist/folder). Every read or write of "the current sort order"
// goes through this one function so the two preferences can never
// drift out of sync with what's actually on screen.
function currentSortKey(){
  return (state.filter && state.filter.type==="album") ? "albumSortBy" : "sortBy";
}

// Returns a NEW array containing the same tracks, ordered according
// to whichever sort preference applies to the current view (see
// currentSortKey()). Never mutates the array it's given.
function sortTracks(tracks){
  const sorted=[...tracks];
  const sortBy=state[currentSortKey()];
  switch(sortBy){
    case "title-desc":    sorted.sort((a,b)=>b.title.localeCompare(a.title)); break;
    case "artist-asc":    sorted.sort((a,b)=>a.artist.localeCompare(b.artist)); break;
    case "artist-desc":   sorted.sort((a,b)=>b.artist.localeCompare(a.artist)); break;
    case "duration-asc":  sorted.sort((a,b)=>a.duration-b.duration); break;
    case "duration-desc": sorted.sort((a,b)=>b.duration-a.duration); break;
    // dateAdded is a Date.now() timestamp set at import time (see
    // state.tracks comment above) — missing/undefined values fall
    // back to 0 so any legacy track without one sorts as "oldest".
    case "date-desc":     sorted.sort((a,b)=>(b.dateAdded||0)-(a.dateAdded||0)); break;
    case "date-asc":      sorted.sort((a,b)=>(a.dateAdded||0)-(b.dateAdded||0)); break;
    // Tracks without an embedded track number (trackNum===null) sort
    // to the end rather than to the front, and ties (including two
    // untagged tracks) fall back to Title so the order stays stable.
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




// The main render entry point. Clears the list container and
// redraws whichever view is currently active.
function renderTab(){
  listContainer.innerHTML="";
  virtualSongList=null;
  const q=(searchInput.value||"").toLowerCase().trim();

  // Select mode can now be entered from a flat song list OR from
  // the top-level Albums/Artists/Playlists/Folders tabs, but the
  // "kind" of thing being selected changes depending on which of
  // those we're looking at. If the view has changed to a different
  // kind since select mode was turned on (switched tabs, drilled
  // into something, etc.), turn it off automatically rather than
  // leaving stale checkboxes selecting the wrong kind of item.
  const selType=currentSelectType();
  if(state.selectMode && state.selectType!==selType){
    state.selectMode=false;
    state.selectedIds.clear();
    selectToggle.classList.remove("active");
  }
  state.selectType=selType;
  selectToggle.classList.toggle("hidden", !selType);
  updateSelectionBar();

  // The sort menu's options (title/artist/duration) describe
  // properties of songs, so they only make sense on views that are
  // either a flat song list or grouped-by-song (Albums, Artists).
  // Playlists and Folders list containers, not songs, so hide the
  // sort button there rather than showing a menu that has nothing
  // to affect.
  const sortApplies = state.filter || state.currentTab==="songs" || state.currentTab==="albums" || state.currentTab==="artists";
  $("sortToggle").classList.toggle("hidden", !sortApplies);
  // Convert is its own workspace, not a list of songs to search
  // through, so it hides the search bar the same way Home does.
  const searchApplies = state.filter || (state.currentTab!=="home" && state.currentTab!=="convert");
  searchToggle.classList.toggle("hidden", !searchApplies);
  // The locate button only makes sense where renderSongList() actually
  // draws flat, scrollable song rows — a drilled-down view (any
  // filter type) or the top-level Songs tab. Albums/Artists show
  // grids/lists of *groups*, not individual playable rows, so there's
  // nothing for it to scroll to there.
  const songListApplies = state.filter || state.currentTab==="songs";
  locatePlayingToggle.classList.toggle("hidden", !songListApplies);
  if(!searchApplies){ searchRow.classList.add("hidden"); searchInput.value=""; }

  // Drilled-down view (inside a specific album/artist/playlist/folder).
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

  // Top-level tab views.
  if(state.currentTab==="home"){
    listTitle.textContent=tr("nav.home");
    renderHomeTab();
  } else if(state.currentTab==="songs"){
    listTitle.textContent=tr("nav.songs");
    let tracks=libraryTracks();                // excludes unpersisted external tracks — see libraryTracks()
    if(q) tracks=tracks.filter(t=>matchQuery(t,q));
    renderSongList(tracks,null);                // renderSongList applies state.sortBy itself
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
    // A folder we were browsing may have just been deleted (e.g. via
    // its own "⋮" menu) — fall back to root rather than rendering a
    // view for a folder that no longer exists.
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



// True if a track's title, artist or album contains the search
// query (case-insensitive).
function matchQuery(t,q){
  return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q);
}



// Draws a flat list of songs (used by the Songs tab, and by every
// drilled-down album/artist/playlist/folder view). Always applies
// the current sort order first so the list stays consistent no
// matter where it's shown from.
//
// When state.selectMode is on, each row gets a round checkbox in
// place of its usual click-to-play behavior — clicking anywhere on
// the row toggles that song's checked state instead of playing it.
// The "⋮" menu stays available either way.
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
    row.dataset.trackId=t.id; // lets refreshPlayingHighlight() find this row later without a full re-render
    row.dataset.selectId=t.id; // lets refreshSelectionHighlight() find this row later without a full re-render
    if(state.selectMode){
      row.appendChild(el("div","row-check"));
    }
    const img=document.createElement("img");
    img.className="thumb";
    img.loading="lazy";      // defer decode/paint for rows scrolled out of view — cheaper first paint and scroll on long libraries
    img.decoding="async";    // never block the main thread waiting on image decode
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



// Moves the "now playing" highlight to whichever row(s) currently
// match state.currentTrack.id, without rebuilding the list. Used on
// every track change instead of renderTab() — a full rebuild would
// tear down and recreate every row (and every <img>) in the visible
// list just to move one highlight, which is the single biggest
// source of dropped frames during normal playback on a large
// library. Covers both the flat/drilled song list and the Home tab's
// "Recently Played"/"Top Songs" rows, since both tag their rows with
// data-track-id (see renderSongList/homeSection above) and both live
// under listContainer.
function refreshPlayingHighlight(){
  listContainer.querySelectorAll(".song-row.playing").forEach(r=>r.classList.remove("playing"));
  const id=state.currentTrack&&state.currentTrack.id;
  if(id==null) return;
  listContainer.querySelectorAll(`.song-row[data-track-id="${CSS.escape(String(id))}"]`).forEach(r=>r.classList.add("playing"));
}



// Rebuilds the exact same track list renderTab() would currently be
// feeding into renderSongList() — same filter/tab, same search query,
// same sort order — without actually re-rendering anything. Used only
// to look up *where* the playing track sits in that list. Returns
// null on views that aren't a flat song list at all (Albums/Artists/
// Playlists/Folders/Home/Convert), since there's nothing to locate.
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

// The locate ("target") button's handler. Finds whichever row is
// tagged .playing and scrolls it into view. If the library is large
// enough that the list is virtualized (see SONG_ROW_HEIGHT/
// renderSongList above), the playing row may not exist in the DOM at
// all right now — in that case this works out its index in the full
// sorted/filtered list instead and scrolls straight to where that
// index lands, which is enough to bring it into the virtual render
// window; the scroll-triggered re-render then draws the real row in.
function scrollToNowPlaying(){
  if(!state.currentTrack) return;
  const existingRow=listContainer.querySelector(".song-row.playing");
  if(existingRow){
    // Was: existingRow.scrollIntoView({block:"center",behavior:"smooth"}).
    // scrollIntoView() doesn't just scroll listContainer — it walks every
    // scrollable ancestor up to the document root and may scroll several
    // of them at once trying to satisfy block:"center" at each level. In
    // this app that's meant to be harmless (listContainer is the only
    // element meant to move), but it's still handing the browser
    // discretion this button has no business granting: only the Songs
    // list should ever move. Computing the target offset ourselves and
    // calling scrollTo() directly on listContainer — the same approach
    // the virtualized path just below already uses — makes that
    // structurally impossible instead of relying on nothing upstream
    // ever becoming scrollable.
    const target=Math.max(0, existingRow.offsetTop - (listContainer.clientHeight/2) + (existingRow.offsetHeight/2));
    listContainer.scrollTo({top:target,behavior:"smooth"});
    flashRow(existingRow);
    return;
  }
  const tracks=currentSongListTracks();
  if(!tracks) return; // not on a song-list view — nothing to scroll to
  const index=tracks.findIndex(t=>t.id===state.currentTrack.id);
  if(index===-1) return; // playing track isn't part of this view (e.g. filtered out by search, or a different playlist)
  const target=Math.max(0, (index*SONG_ROW_HEIGHT) - (listContainer.clientHeight/2) + (SONG_ROW_HEIGHT/2));
  listContainer.scrollTo({top:target,behavior:"smooth"});
  // Give the virtual window time to catch up with the scroll, then
  // flash whichever row actually landed there for the same feedback
  // the non-virtualized path gets instantly.
  setTimeout(()=>{
    const row=listContainer.querySelector(".song-row.playing");
    if(row) flashRow(row);
  },420);
}

// Brief one-shot highlight pulse so it's obvious which row the
// locate button landed on, even though .playing already tints it —
// useful on a long list where the eye needs a nudge to the right spot.
function flashRow(row){
  row.classList.remove("row-locate-flash");
  void row.offsetWidth; // restart the animation if clicked again quickly
  row.classList.add("row-locate-flash");
}



// Toggles the "selected" class (and, via CSS, its checkbox/
// highlight) on whichever row/card currently represents `id`,
// without rebuilding the list. Mirrors refreshPlayingHighlight()'s
// approach for the "now playing" highlight: every selectable row
// (song row, album card, artist/playlist/folder list-line) is
// tagged with data-select-id when it's drawn, so the exact element
// that changed can be found and flipped directly. A full renderTab()
// would tear down and recreate every visible row — and every
// <img> — just to flip one checkbox, which is what caused the
// flicker/scroll-jump during multi-select on large libraries.
function refreshSelectionHighlight(id){
  const selected=state.selectedIds.has(id);
  listContainer.querySelectorAll(`[data-select-id="${CSS.escape(String(id))}"]`).forEach(elm=>{
    elm.classList.toggle("selected",selected);
  });
}



// Flips one item's checked state in select mode (a track id, album
// key, artist name, playlist id, or folder id, depending on
// state.selectType) and updates both the affected row (so its
// checkbox/highlight updates in place) and the bulk-action bar (so
// the "N selected" count and its visibility stay correct).
function toggleItemSelected(id){
  if(state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  refreshSelectionHighlight(id);
  updateSelectionBar();
}



// Shows/hides the bulk-action bar and keeps its "N selected" count
// in sync with state.selectedIds. Called whenever a checkbox is
// toggled, and whenever select mode itself is entered or exited.
function updateSelectionBar(){
  const n=state.selectedIds.size;
  selectionBar.classList.toggle("hidden", !state.selectMode || n===0);
  const pluralKey=SELECT_TYPE_PLURAL_KEY[state.selectType]||"song";
  selCount.textContent=plural(n,pluralKey)+" "+tr("sel.selectedSuffix");
  // Adding a whole playlist "to a playlist" isn't a meaningful
  // action, so that button only makes sense while selecting songs,
  // albums, artists, or folders — hide it when selecting playlists.
  $("selAddPlaylistBtn").classList.toggle("hidden", state.selectType==="playlists");
}



// Turns select mode on/off. Entering it always starts with nothing
// checked; leaving it clears any checked items too, so re-entering
// later is always a clean slate. The label on the select button
// itself updates to match whatever's being selected (songs, albums,
// artists, playlists, or folders).
function toggleSelectMode(){
  state.selectMode=!state.selectMode;
  state.selectedIds.clear();
  selectToggle.classList.toggle("active", state.selectMode);
  selectToggle.title=tr("header.selectPrefix")+pluralWord(SELECT_TYPE_PLURAL_KEY[state.selectType]||"song");
  renderTab();
  updateSelectionBar();
}



// True whenever the list currently on screen is a flat, selectable
// song list — the top-level Songs tab, or any drilled-down album/
// artist/playlist/folder view — as opposed to a grid/list of
// non-track items (Albums/Artists/Playlists/Folders top level).
function isTrackListView(){
  return (state.currentTab==="songs" && !state.filter) || !!state.filter;
}



// What kind of item select mode would be selecting on the view
// that's currently on screen, or null if the current view isn't
// selectable at all. A drilled-down view is always "track" (you're
// looking at songs no matter which tab you drilled in from); at
// the top level it's "track" for the Songs tab and the tab name
// itself ("albums"/"artists"/"playlists"/"folders") for the rest,
// since those top-level views list albums, artists, playlists, or
// folders rather than individual songs.
function currentSelectType(){
  if(isTrackListView()) return "track";
  if(!state.filter && ["albums","artists","playlists","folders"].includes(state.currentTab)) return state.currentTab;
  return null;
}



// Draws the Home tab: three stat boxes (songs/albums/artists) side
// by side, then a "Recently Played" section (last 3 tracks played,
// most recent first) and a "Top Songs" section (3 most-played
// tracks, most-played first). Both sections read straight off each
// track's playCount/lastPlayedAt, which recordPlay() keeps updated
// every time something actually starts playing (see PLAYBACK
// below). Home never supports select mode, search, or sorting.
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



// One of the three side-by-side number+label boxes at the top of Home.
function homeStatBox(value,label){
  const box=el("div","home-stat-box");
  box.appendChild(el("div","home-stat-value",String(value)));
  box.appendChild(el("div","home-stat-label",escapeHTML(label)));
  return box;
}



// One "Recently Played" / "Top Songs" block: a heading followed by
// up to 3 song rows. "kind" is "plays" to show a play-count badge
// on the right (Top Songs) or "recent" to show the normal duration
// (Recently Played). Clicking a row plays it, queued against just
// the tracks shown in that section.
function homeSection(title,tracks,kind){
  const section=el("div","home-section");
  section.appendChild(el("div","home-section-title",escapeHTML(title)));
  if(!tracks.length){
    section.appendChild(el("div","empty-state", kind==="plays" ? tr("empty.noSongsPlayedYet") : tr("empty.nothingPlayedYet")));
    return section;
  }
  tracks.forEach(t=>{
    const row=el("div","song-row"+(state.currentTrack&&state.currentTrack.id===t.id?" playing":""));
    row.dataset.trackId=t.id; // lets refreshPlayingHighlight() find this row later without a full re-render
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



// Draws the Albums tab as a grid of cover-art cards. In select
// mode each card gets a checkbox badge over its artwork and
// clicking anywhere on the card toggles that album's checked state
// instead of drilling into it.
function renderAlbumGrid(albums){
  if(!albums.length){ listContainer.appendChild(el("div","empty-state",tr("empty.noAlbums"))); return; }
  const grid=el("div","grid-cards");
  albums.forEach(a=>{
    const selected=state.selectMode && state.selectedIds.has(a.key);
    const card=el("div","card"+(state.selectMode?" selectable":"")+(selected?" selected":""));
    card.dataset.selectId=a.key; // lets refreshSelectionHighlight() find this card later without a full re-render
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



// Draws the Artists tab as a list of round-thumbnail rows. In
// select mode each row gets a checkbox in place of its usual
// click-to-drill-in behavior, same pattern as the song list.
function renderArtistList(artists){
  if(!artists.length){ listContainer.appendChild(el("div","empty-state",tr("empty.noArtists"))); return; }
  artists.forEach(a=>{
    const selected=state.selectMode && state.selectedIds.has(a.artist);
    const line=el("div","list-line"+(state.selectMode?" selectable":"")+(selected?" selected":""));
    line.dataset.selectId=a.artist; // lets refreshSelectionHighlight() find this row later without a full re-render
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



// Draws the Playlists tab: a "+ New Playlist"/"+ New Folder"
// toolbar followed by the current level's folders and playlists —
// root by default, or whatever folder state.playlistFolderId points
// at (see openPlaylistFolder() in playlist-folders.js) — sorted
// together by their shared "order" field, file-manager style.
// Favorites is always at root (it never gets a "⋮" menu, so it can
// never be moved into a folder) and unselectable even in select
// mode, same as before; folders are never selectable at all, since
// bulk-select on this tab only ever targets playlists.
function renderPlaylistList(){
  const toolbar=el("div","playlist-toolbar");
  const newPlaylistBtn=el("button","new-playlist-btn",tr("playlists.newPlaylist"));
  // NOTE: wrapped in an arrow function rather than passed directly
  // (`btn.addEventListener("click",createPlaylistPrompt)`) — passed
  // directly, the click's native Event object becomes
  // createPlaylistPrompt's trackIdToAdd argument (addEventListener
  // always calls its handler with the event as the first argument),
  // which is truthy and so gets pushed into the new playlist's
  // trackIds. That Event object can't be saved to IndexedDB (it's
  // not structured-cloneable), so the playlist would render fine in
  // this session but silently fail to persist — gone on next launch.
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

  // Only a folder can ever end up genuinely empty — the root level
  // always has at least Favorites.
  if(parentId && !items.length){
    listContainer.appendChild(el("div","empty-state",tr("empty.emptyPlaylistFolder")));
    return;
  }

  items.forEach(({kind,data})=>{
    listContainer.appendChild(kind==="folder" ? renderPlaylistFolderRow(data) : renderPlaylistRow(data));
  });
}



// One playlist-folder row — a ".folder-line" row with the same
// square icon treatment renderFolderList() uses for library folders,
// so folders read as folders wherever they appear. Always drills in
// on click, select mode or not; see renderPlaylistList() above for
// why folders never get a checkbox.
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



// One playlist row — pulled out of renderPlaylistList() so a
// playlist nested inside a folder renders exactly like a root-level
// one; logic and markup are unchanged from before folders existed.
function renderPlaylistRow(p){
  const tracks=p.trackIds.map(id=>state.tracks.find(t=>t.id===id)).filter(Boolean);
  const isFavorites=p.id===state.favoritesId;
  const selectableRow=state.selectMode && !isFavorites;
  const selected=selectableRow && state.selectedIds.has(p.id);
  const line=el("div","list-line"+(selectableRow?" selectable":"")+(selected?" selected":""));
  line.dataset.selectId=p.id; // lets refreshSelectionHighlight() find this row later without a full re-render
  if(selectableRow) line.appendChild(el("div","row-check"));
  const img=document.createElement("img");
  img.loading="lazy"; img.decoding="async";
  img.src=(tracks[0]&&getTrackArtURL(tracks[0]))||fallbackArt();
  line.appendChild(img);
  const wrap=el("div","wrap");
  wrap.appendChild(el("div","name",escapeHTML(p.name)));
  wrap.appendChild(el("div","sub",plural(tracks.length,"song")));
  line.appendChild(wrap);
  // The built-in Favorites playlist can't be renamed, moved or
  // deleted, so it doesn't get a "⋮" menu button — every other,
  // user-created playlist does.
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



// Draws the Folders tab: a small toolbar with "Add Songs" / "Add
// Folder" buttons — MOVED HERE from the sidebar header, see the
// ".folder-toolbar" CSS rule for why — followed by one row per
// folder the user has added.
function renderFolderList(){
  const toolbar=el("div","folder-toolbar");

  // "+ Add Songs": lets the user pick one or more loose audio
  // files. They're imported with no folder attached, exactly like
  // this button behaved back when it lived in the sidebar header.
  const addSongsBtn=el("button","",`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/></svg> ${escapeHTML(tr("folder.addSongs"))}`);
  addSongsBtn.addEventListener("click",()=>$("filesInput").click());

  // "+ Add Folder": lets the user pick an entire folder from disk;
  // every audio file inside it is imported and grouped together.
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
    line.dataset.selectId=f.id; // lets refreshSelectionHighlight() find this row later without a full re-render
    if(state.selectMode) line.appendChild(el("div","row-check"));
    const iconWrap=el("div","icon-wrap","<svg viewBox='0 0 24 24' width='20' height='20' fill='none' stroke='currentColor' stroke-width='2'><path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'/></svg>");
    line.appendChild(iconWrap);
    // "wrap" (not just an empty div) stretches to fill the row and
    // pushes the "⋮" menu button all the way to the right edge —
    // same pattern the Playlists tab uses.
    const wrap=el("div","wrap");
    wrap.appendChild(el("div","name",escapeHTML(f.name)));
    wrap.appendChild(el("div","sub",plural(tracks.length,"song")));
    line.appendChild(wrap);
    // "⋮" menu — Rename / Delete / Forget this folder.
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
  SORT_OPTIONS, currentSortKey
};
