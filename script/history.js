import { state, $, audioEl, idbPut, uid } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML, fallbackArt } from "./utils.js";
import { openModal } from "./modal.js";
import { getTrackArtURL } from "./init.js";
import { playTrack } from "./player.js";


const HISTORY_MIN_SECONDS=5;
const HISTORY_RETENTION_DAYS=10;

function pruneHistoryEntries(){
  const cutoff=Date.now()-HISTORY_RETENTION_DAYS*24*60*60*1000;
  const before=state.playHistory.length;
  state.playHistory=state.playHistory.filter(entry=>entry.playedAt>=cutoff);
  if(state.playHistory.length!==before) persistHistory();
}

function persistHistory(){
  idbPut("settings",{key:"playHistory", value:state.playHistory}).catch(()=>{});
}

let historyProgress=null;

function resetHistoryProgress(trackId){
  historyProgress={trackId, accumMs:0, lastTs:null, registered:false};
}

function trackHistoryProgress(){
  const track=state.currentTrack;
  if(!track || !historyProgress || historyProgress.trackId!==track.id) return;
  if(historyProgress.registered || audioEl.paused) return;

  const now=performance.now();
  if(historyProgress.lastTs!=null){
    const delta=Math.min(2000, now-historyProgress.lastTs);
    if(delta>0) historyProgress.accumMs+=delta;
  }
  historyProgress.lastTs=now;

  if(historyProgress.accumMs>=HISTORY_MIN_SECONDS*1000){
    historyProgress.registered=true;
    recordHistoryEntry(track);
  }
}

audioEl.addEventListener("timeupdate",trackHistoryProgress);
audioEl.addEventListener("pause",()=>{ if(historyProgress) historyProgress.lastTs=null; });

function recordHistoryEntry(track){
  state.playHistory.unshift({
    id:uid(),
    trackId:track.id,
    title:track.title,
    artist:track.artist,
    album:track.album,
    playedAt:Date.now()
  });
  pruneHistoryEntries();
  persistHistory();
}


function dayLabelFor(ts){
  const d=new Date(ts), now=new Date();
  const startOfDay=(dt)=>new Date(dt.getFullYear(),dt.getMonth(),dt.getDate()).getTime();
  const diffDays=Math.round((startOfDay(now)-startOfDay(d))/86400000);
  if(diffDays===0) return tr("history.today");
  if(diffDays===1) return tr("history.yesterday");
  const opts=(d.getFullYear()===now.getFullYear()) ? {month:"long",day:"numeric"} : {month:"long",day:"numeric",year:"numeric"};
  return d.toLocaleDateString(undefined,opts);
}

function groupHistoryByDay(sortedEntries){
  const groups=[];
  let lastLabel=null, currentGroup=null;
  sortedEntries.forEach(entry=>{
    const label=dayLabelFor(entry.playedAt);
    if(label!==lastLabel){
      currentGroup={label, entries:[]};
      groups.push(currentGroup);
      lastLabel=label;
    }
    currentGroup.entries.push(entry);
  });
  return groups;
}

function historyRowHTML(entry){
  const track=state.tracks.find(t=>t.id===entry.trackId);
  const artURL=(track && getTrackArtURL(track)) || fallbackArt();
  const sub=entry.album ? `${entry.artist} • ${entry.album}` : entry.artist;
  const time=new Date(entry.playedAt).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  return `<div class="history-row" data-track-id="${escapeHTML(entry.trackId)}">
    <img class="thumb" src="${artURL}" loading="lazy" decoding="async" alt="">
    <div class="info">
      <div class="title">${escapeHTML(entry.title)}</div>
      <div class="sub">${escapeHTML(sub)}</div>
    </div>
    <span class="history-time">${escapeHTML(time)}</span>
  </div>`;
}

function bindHistoryRowClicks(){
  $("modalBody").querySelectorAll(".history-row[data-track-id]").forEach(row=>{
    row.addEventListener("click",()=>{
      const track=state.tracks.find(t=>t.id===row.dataset.trackId);
      if(track) playTrack(track,[track]);
    });
  });
}

function openHistoryModal(){
  pruneHistoryEntries();

  if(!state.playHistory.length){
    openModal(tr("history.title"), `<p class="info-empty">${escapeHTML(tr("empty.noListeningHistory"))}</p>`);
    return;
  }

  const sorted=[...state.playHistory].sort((a,b)=>b.playedAt-a.playedAt);
  const bodyHTML="<div class='history-list'>"+groupHistoryByDay(sorted).map(group=>
    `<div class="history-group">
      <div class="home-section-title">${escapeHTML(group.label)}</div>
      ${group.entries.map(historyRowHTML).join("")}
    </div>`
  ).join("")+"</div>";

  openModal(tr("history.title"), bodyHTML);
  bindHistoryRowClicks();
}

export { openHistoryModal, resetHistoryProgress, pruneHistoryEntries };
