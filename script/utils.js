import { $ } from "./state.js";


function fmtTime(sec){
  if(!isFinite(sec)||sec<0) sec=0;
  const m=Math.floor(sec/60), s=Math.floor(sec%60);
  return m+":"+String(s).padStart(2,"0");
}



function formatBytes(bytes){
  if(bytes===null || bytes===undefined) return "Unknown";
  if(bytes<1024) return bytes+" B";
  const units=["KB","MB","GB"];
  let val=bytes, i=-1;
  do{ val/=1024; i++; }while(val>=1024 && i<units.length-1);
  return val.toFixed(1)+" "+units[i];
}



function formatBitrate(bytes, seconds){
  if(!bytes || !seconds || !isFinite(seconds) || seconds<=0) return "Unknown";
  const kbps=Math.round((bytes*8)/seconds/1000);
  return kbps+" kb/s";
}




function normalizeCodecLabel(raw){
  if(!raw) return null;
  let c=String(raw).trim();
  if(!c) return null;
  if(c.includes("/")) c=c.split("/").pop().trim();
  const layerMatch=c.match(/layer\s*([123])/i);
  if(layerMatch) return "MP"+layerMatch[1];
  if(/^aac/i.test(c)) return "AAC";
  if(/^flac/i.test(c)) return "FLAC";
  if(/^alac/i.test(c)) return "ALAC";
  if(/^vorbis/i.test(c)) return "Vorbis";
  if(/^opus/i.test(c)) return "Opus";
  if(/^pcm/i.test(c)) return "PCM";
  if(/^wma/i.test(c)) return "WMA";
  return c;
}

function normalizeContainerLabel(filePath){
  if(!filePath) return null;
  const base=filePath.split(/[\\/]/).pop()||"";
  const dot=base.lastIndexOf(".");
  if(dot<0 || dot===base.length-1) return null;
  return base.slice(dot+1).toUpperCase();
}

function formatSampleRate(hz){
  if(!hz || !isFinite(hz) || hz<=0) return null;
  let str=(hz/1000).toFixed(1);
  if(str.endsWith(".0")) str=str.slice(0,-2);
  return str+" kHz";
}

function formatTechMeta(meta, filePath){
  if(!meta) return "";
  const parts=[];

  const sr=formatSampleRate(meta.sampleRate);
  if(sr) parts.push(sr);

  if(meta.lossless && meta.bitsPerSample){
    parts.push(Math.round(meta.bitsPerSample)+"-bit");
  } else if(meta.bitrate){
    parts.push(Math.round(meta.bitrate)+" kbps");
  }

  const codecLabel=normalizeCodecLabel(meta.codec);
  const containerLabel=normalizeContainerLabel(filePath);

  if(codecLabel && containerLabel && codecLabel.toUpperCase()!==containerLabel.toUpperCase()){
    parts.push(codecLabel, containerLabel);
  } else if(codecLabel || containerLabel){
    parts.push(codecLabel || containerLabel);
  }

  return parts.filter(Boolean).join(" • ");
}



function el(tag,cls,html){ const e=document.createElement(tag); if(cls)e.className=cls; if(html!==undefined)e.innerHTML=html; return e; }

function replayMotion(element,className="motion-in",duration=320){
  if(!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove(className);
  requestAnimationFrame(()=>{
    element.classList.add(className);
    setTimeout(()=>element.classList.remove(className),duration);
  });
}

function pulseCtrlBtn(btnId,svgClass,svgDuration=420,pingClass="ctrl-ping"){
  const btn=$(btnId);
  if(!btn) return;
  replayMotion(btn,pingClass,480);
  if(!svgClass) return;
  const icon=btn.querySelector("svg");
  if(icon) replayMotion(icon,svgClass,svgDuration);
}

function showWithMotion(element){
  element.classList.remove("hidden","motion-out");
  replayMotion(element);
}

function hideWithMotion(element,duration=180){
  if(element.classList.contains("hidden")) return;
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){
    element.classList.add("hidden");
    return;
  }
  element.classList.remove("motion-in");
  element.classList.add("motion-out");
  setTimeout(()=>{
    if(element.classList.contains("motion-out")) element.classList.add("hidden");
  },duration);
}

function debounce(fn,ms){
  let handle=null;
  return (...args)=>{
    clearTimeout(handle);
    handle=setTimeout(()=>fn(...args),ms);
  };
}
function escapeHTML(s){ const d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }

function fallbackArt(){
  return "data:image/svg+xml;utf8,"+encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='#1c1c25'/><circle cx='50' cy='50' r='18' fill='none' stroke='#5c5c66' stroke-width='2'/></svg>"
  );
}

export { fmtTime, formatBytes, formatBitrate, formatTechMeta, el, replayMotion, pulseCtrlBtn, showWithMotion, hideWithMotion, debounce, escapeHTML, fallbackArt };
