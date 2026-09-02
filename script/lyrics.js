import { state, $, audioEl, idbPut, idbGet } from "./state.js";
import { tr } from "./i18n.js";
import { escapeHTML } from "./utils.js";
import { openModal, closeModal } from "./modal.js";


function parseLRC(lrc){
  const lines=lrc.split("\n");
  const out=[];
  const re=/\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for(const line of lines){
    const text=line.replace(re,"").trim();
    let m; re.lastIndex=0;
    let matched=false;
    while((m=re.exec(line))){
      matched=true;
      const time=parseInt(m[1])*60+parseFloat(m[2]);
      out.push({time,text});
    }
    if(!matched && text) {   }
  }
  return out.sort((a,b)=>a.time-b.time);
}



function stripParens(title){
  return title.replace(/\([^)]*\)/g,"").replace(/\s{2,}/g," ").trim();
}

async function searchLyrics(title,artist){
  const url=`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const res=await fetch(url);
  const data=await res.json();
  if(Array.isArray(data)&&data.length){
    const best=data.find(d=>d.syncedLyrics)||data[0];
    if(best.syncedLyrics) return parseLRC(best.syncedLyrics);
    if(best.plainLyrics) return best.plainLyrics.split("\n").map(t=>({time:null,text:t}));
  }
  return null;
}

async function fetchLyricsFor(track){
  if(state.lyricsCache[track.id]) return state.lyricsCache[track.id];
  const cached=await idbGet("lyrics",track.id).catch(()=>null);
  if(cached && cached.lines){
    state.lyricsCache[track.id]=cached.lines;
    state.lyricOffsets[track.id]=cached.offsetMs||0;
    return cached.lines;
  }
  let lines=null;
  try{
    lines=await searchLyrics(track.title,track.artist);
  }catch(err){
    lines=null;
  }
  if(!lines){
    const strippedTitle=stripParens(track.title);
    if(strippedTitle && strippedTitle!==track.title){
      try{
        lines=await searchLyrics(strippedTitle,track.artist);
      }catch(err){
        lines=null;
      }
    }
  }
  if(lines){
    state.lyricsCache[track.id]=lines;
    state.lyricOffsets[track.id]=0;
    idbPut("lyrics",{trackId:track.id,lines,offsetMs:0});
  }
  return lines;
}



function closeLyrics(){
  state.lyricsOpen=false;
  $("lyricsPane").classList.add("hidden");
  $("lyricsBtn").classList.remove("active");
  $("artWrap").classList.remove("lyrics-active");
}



async function toggleLyrics(){
  if(!state.currentTrack) return;
  if(state.lyricsOpen){ closeLyrics(); return; }
  state.lyricsOpen=true;
  state.lastLyricIdx=-2;
  $("lyricsBtn").classList.add("active");
  $("artWrap").classList.add("lyrics-active");
  const pane=$("lyricsPane");
  pane.classList.remove("hidden");
  pane.innerHTML=`<div class='lyric-status'>${escapeHTML(tr("lyrics.loading"))}</div>`;
  const lines=await fetchLyricsFor(state.currentTrack);
  if(!state.lyricsOpen) return;
  if(!lines || !lines.length){
    pane.innerHTML=`<div class='lyric-status'>${escapeHTML(tr("lyrics.notFoundShort"))}</div>`;
    return;
  }
  if(lines[0].time===null){
    pane.innerHTML=`<div class="lyric-plain">${escapeHTML(lines.map(l=>l.text||"").join("\n"))}</div>`;
    return;
  }
  pane.innerHTML='<div class="lyric-current"></div>';
  syncLyrics(audioEl.currentTime);
}



function syncLyrics(cur){
  const trackId=state.currentTrack&&state.currentTrack.id;
  const lines=state.lyricsCache[trackId];
  if(!lines || !lines.length || lines[0].time===null) return;
  const offsetSec=(state.lyricOffsets[trackId]||0)/1000;
  const adjustedCur=cur-offsetSec;
  let activeIdx=-1;
  for(let i=0;i<lines.length;i++){ if(lines[i].time<=adjustedCur) activeIdx=i; else break; }
  if(activeIdx===state.lastLyricIdx) return;
  state.lastLyricIdx=activeIdx;

  const curEl=$("lyricsPane").querySelector(".lyric-current");
  if(!curEl) return;
  const text=activeIdx>=0 ? (lines[activeIdx].text || "♪") : "";
  curEl.classList.add("swap");
  setTimeout(()=>{
    curEl.textContent=text;
    void curEl.offsetWidth;
    curEl.classList.remove("swap");
  },160);
}



async function openSyncModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingSync"))}</p>`);
    return;
  }

  openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.loading"))}</p>`);
  const lines=await fetchLyricsFor(t);
  if($("modalOverlay").classList.contains("hidden")) return;

  if(!lines || !lines.length){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.notFound"))}</p>`);
    return;
  }
  if(lines[0].time===null){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.notTimeSynced"))}</p>`);
    return;
  }

  const bodyHTML=`
    <div class="sync-form">
      <p class="sync-hint">${escapeHTML(tr("sync.hint"))}</p>
      <div class="sync-offset-display">
        <input type="text" id="syncOffsetInput" class="sync-offset-input" inputmode="numeric" autocomplete="off" aria-label="${escapeHTML(tr("lyrics.syncOffsetAriaLabel"))}" value="0">
        <span class="sync-offset-unit">ms</span>
      </div>
      <div class="sync-nudge-row">
        <button type="button" class="sync-nudge-btn" data-delta="-500">&minus;500</button>
        <button type="button" class="sync-nudge-btn" data-delta="-100">&minus;100</button>
        <button type="button" class="sync-nudge-btn" data-delta="-10">&minus;10</button>
        <button type="button" class="sync-nudge-btn" data-delta="10">+10</button>
        <button type="button" class="sync-nudge-btn" data-delta="100">+100</button>
        <button type="button" class="sync-nudge-btn" data-delta="500">+500</button>
      </div>
      <div class="edit-actions">
        <button type="button" class="edit-cancel-btn" id="syncResetBtn">${escapeHTML(tr("sync.resetTo0"))}</button>
        <button type="button" class="edit-save-btn" id="syncDoneBtn">${escapeHTML(tr("sync.done"))}</button>
      </div>
    </div>`;
  openModal(tr("side.syncLyrics"), bodyHTML);

  let offsetMs=state.lyricOffsets[t.id]||0;
  const inputEl=$("syncOffsetInput");
  const renderOffset=()=>{ inputEl.value=(offsetMs>0?"+":"")+offsetMs; };
  renderOffset();

  function applyOffset(){
    state.lyricOffsets[t.id]=offsetMs;
    idbPut("lyrics",{trackId:t.id, lines, offsetMs});
    if(state.currentTrack && state.currentTrack.id===t.id && state.lyricsOpen){
      state.lastLyricIdx=-2;
      syncLyrics(audioEl.currentTime);
    }
  }

  $("modalBody").querySelectorAll(".sync-nudge-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      offsetMs+=parseInt(btn.dataset.delta,10);
      renderOffset();
      applyOffset();
    });
  });

  const numericKeys=new Set(["Backspace","Delete","ArrowLeft","ArrowRight","Tab","Enter","Home","End"]);
  inputEl.addEventListener("keydown",(e)=>{
    if(numericKeys.has(e.key)) return;
    if(e.key==="-"){
      if(inputEl.selectionStart===0 && !inputEl.value.includes("-")) return;
      e.preventDefault();
      return;
    }
    if(!/^[0-9]$/.test(e.key)) e.preventDefault();
  });
  inputEl.addEventListener("input",()=>{
    let v=inputEl.value.replace(/[^0-9-]/g,"");
    v=v.replace(/(?!^)-/g,"");
    inputEl.value=v;
  });
  function commitOffsetInput(){
    let n=parseInt(inputEl.value,10);
    if(isNaN(n)) n=0;
    offsetMs=n;
    renderOffset();
    applyOffset();
  }
  inputEl.addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); inputEl.blur(); } });
  inputEl.addEventListener("blur",commitOffsetInput);

  $("syncResetBtn").addEventListener("click",()=>{
    offsetMs=0;
    renderOffset();
    applyOffset();
  });

  $("syncDoneBtn").addEventListener("click",closeModal);
}

export { closeLyrics, toggleLyrics, syncLyrics, openSyncModal };
