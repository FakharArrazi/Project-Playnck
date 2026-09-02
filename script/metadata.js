import { state, idbPut, idbDelete, uid, AUDIO_EXT, $ } from "./state.js";
import { renderTab } from "./library-view.js";
import { hydrateTrack, filePathToURL, resolveFilePath, deriveFolderRootPath } from "./init.js";
import { removeTrackData } from "./playlists.js";


function sanitizeFilename(name){
  return name
    .replace(/[\\/:*?"<>|]/g,"-")
    .replace(/\s{2,}/g," ")
    .trim()
    .slice(0,180) || "Untitled";
}



async function backfillTrackNumbers(){
  const targets=state.tracks.filter(t=>t.trackNum==null && !t.external);
  if(!targets.length) return;

  let changed=false;
  for(const t of targets){
    let trackNum=null;
    if(t.filePath && window.electronAPI && window.electronAPI.getAudioMetadata){
      try{
        const meta=await window.electronAPI.getAudioMetadata(t.filePath);
        trackNum = (meta && meta.trackNum!=null) ? meta.trackNum : null;
      }catch(e){
        console.warn("backfillTrackNumbers: getAudioMetadata failed for",t.filePath,e);
        trackNum=null;
      }
    } else if(t.fileBlob){
      try{
        const tags=await readTags(t.fileBlob);
        trackNum = tags.trackNum!=null ? tags.trackNum : null;
      }catch(e){
        console.warn("backfillTrackNumbers: readTags failed for",t.title,e);
        trackNum=null;
      }
    }
    if(trackNum===t.trackNum) continue;
    t.trackNum=trackNum;
    changed=true;

    const storeCopy={
      id:t.id, title:t.title, artist:t.artist, album:t.album,
      trackNum:t.trackNum,
      duration:t.duration, folderId:t.folderId, dateAdded:t.dateAdded,
      fileBlob:t.fileBlob, artBlob:t.artBlob, filePath:t.filePath
    };
    await idbPut("tracks",storeCopy).catch(()=>{});
  }
  if(changed) renderTab();
}



function longestCommonDirectory(paths){
  if(!paths.length) return null;
  const sep=paths[0].includes("\\") ? "\\" : "/";
  const partsList=paths.map(p=>p.split(sep));
  let common=partsList[0].slice(0,-1);
  for(let i=1;i<partsList.length;i++){
    const parts=partsList[i].slice(0,-1);
    let j=0;
    while(j<common.length && j<parts.length && common[j]===parts[j]) j++;
    common=common.slice(0,j);
    if(!common.length) return null;
  }
  return common.length ? common.join(sep) : null;
}



function backfillFolderPaths(){
  let changed=false;
  state.folders.forEach(f=>{
    if(f.path) return;
    const paths=state.tracks.filter(t=>t.folderId===f.id && t.filePath).map(t=>t.filePath);
    if(!paths.length) return;
    const common=longestCommonDirectory(paths);
    if(common){ f.path=common; idbPut("folders",f); changed=true; }
  });
  return changed;
}



const INGEST_CONCURRENCY=25;

async function ingestDiscoveredPaths(paths, folderId){
  if(!paths.length) return false;
  let addedAny=false;

  const knownPaths=new Set(
    state.tracks.filter(t=>!t.external).map(t=>t.filePath)
  );

  for(let i=0;i<paths.length;i+=INGEST_CONCURRENCY){
    const batch=paths.slice(i,i+INGEST_CONCURRENCY).filter(filePath=>{
      if(knownPaths.has(filePath)) return false;
      knownPaths.add(filePath);
      return true;
    });
    if(!batch.length) continue;

    const metas=await Promise.all(batch.map(filePath=>
      window.electronAPI.getAudioMetadata(filePath).catch(e=>{
        console.warn("ingestDiscoveredPaths: getAudioMetadata failed for",filePath,e);
        return null;
      })
    ));

    batch.forEach((filePath,idx)=>{
      const meta=metas[idx];
      if(!meta) return;

      const fileName=filePath.split(/[\\/]/).pop();
      const guess=guessFromName(fileName);
      const title=meta.title || guess.title;
      const artist=meta.artist || guess.artist;
      const artBlob=(meta.picture && meta.picture.data)
        ? new Blob([new Uint8Array(meta.picture.data)],{type:meta.picture.format||"image/jpeg"})
        : null;

      const track={
        id:uid(),
        title,
        artist,
        album: meta.album || "Unknown Album",
        trackNum: meta.trackNum ?? null,
        duration: meta.duration || 0,
        folderId,
        dateAdded: Date.now(),
        fileBlob:null,
        artBlob,
        filePath
      };
      hydrateTrack(track);
      state.tracks.push(track);
      addedAny=true;

      const storeCopy={
        id:track.id, title:track.title, artist:track.artist, album:track.album,
        trackNum:track.trackNum,
        duration:track.duration, folderId:track.folderId, dateAdded:track.dateAdded,
        fileBlob:track.fileBlob, artBlob:track.artBlob, filePath:track.filePath
      };
      idbPut("tracks",storeCopy);
    });
  }
  return addedAny;
}



function pruneFolder(folder){
  const tracksInFolder=state.tracks.filter(t=>t.folderId===folder.id);
  tracksInFolder.forEach(t=>removeTrackData(t));

  state.folders=state.folders.filter(f=>f.id!==folder.id);
  idbDelete("folders",folder.id);

  if(state.filter && state.filter.type==="folder"){
    state.filter.tracks=state.filter.tracks.filter(t=>t.folderId!==folder.id);
  }
}



async function rescanFolders(){
  if(!window.electronAPI || !window.electronAPI.scanFolder) return false;
  let addedAny=false;

  for(const folder of state.folders){
    if(!folder.path) continue;

    let foundPaths=[];
    try{ foundPaths=await window.electronAPI.scanFolder(folder.path); }
    catch(e){ console.warn("rescanFolders: scanFolder failed for",folder.path,e); continue; }
    if(!foundPaths.length) continue;

    const known=new Set(state.tracks.filter(t=>t.folderId===folder.id).map(t=>t.filePath));
    const newPaths=foundPaths.filter(p=>!known.has(p));
    if(!newPaths.length) continue;

    const added=await ingestDiscoveredPaths(newPaths, folder.id);
    if(added) addedAny=true;
  }
  return addedAny;
}



async function verifyLibraryOnDisk(){
  if(!window.electronAPI || !window.electronAPI.checkPathsExist) return;

  backfillFolderPaths();

  const folderPaths=state.folders.filter(f=>f.path).map(f=>f.path);
  const trackPaths=state.tracks.filter(t=>t.filePath).map(t=>t.filePath);
  if(!folderPaths.length && !trackPaths.length) return;

  let existence={};
  try{ existence=await window.electronAPI.checkPathsExist([...folderPaths, ...trackPaths]); }
  catch(e){ console.warn("verifyLibraryOnDisk: checkPathsExist failed",e); return; }

  let changed=false;

  const goneFolders=state.folders.filter(f=>f.path && existence[f.path]===false);
  goneFolders.forEach(f=>{ pruneFolder(f); changed=true; });

  const goneFolderIds=new Set(goneFolders.map(f=>f.id));
  state.tracks
    .filter(t=>t.filePath && existence[t.filePath]===false && !goneFolderIds.has(t.folderId))
    .forEach(t=>{ removeTrackData(t); changed=true; });

  if(changed) renderTab();

  const rescanChanged=await rescanFolders();
  if(rescanChanged) renderTab();
}



function guessFromName(filename){
  const base=filename.replace(/\.[^.]+$/,"");
  const parts=base.split(" - ");
  if(parts.length>=2){ return {artist:parts[0].trim(), title:parts.slice(1).join(" - ").trim()}; }
  return {artist:"Unknown Artist", title:base};
}



function readTags(file){
  return new Promise((resolve)=>{
    if(typeof jsmediatags==="undefined"){ resolve({}); return; }
    jsmediatags.read(file,{
      onSuccess:(tag)=>{
        const t=tag.tags||{};
        let artBlob=null;
        if(t.picture){
          const {data,format}=t.picture;
          artBlob=new Blob([new Uint8Array(data)],{type:format});
        }
        resolve({title:t.title,artist:t.artist,album:t.album,trackNum:parseTrackNum(t.track),artBlob});
      },
      onError:()=>resolve({})
    });
  });
}



function parseTrackNum(raw){
  if(raw===undefined || raw===null || raw==="") return null;
  const n=parseInt(String(raw).split("/")[0],10);
  return Number.isFinite(n) ? n : null;
}



function getDuration(url){
  return new Promise((resolve)=>{
    const a=new Audio();
    a.preload="metadata";
    a.src=url;
    a.onloadedmetadata=()=>resolve(a.duration||0);
    a.onerror=()=>resolve(0);
  });
}



async function ingestFiles(fileList, folderName, opts={}){
  const persist = opts.persist!==false;
  const files=Array.from(fileList).filter(f=>{
    const ext=f.name.split(".").pop().toLowerCase();
    return AUDIO_EXT.includes(ext) || f.type.startsWith("audio/");
  });
  if(!files.length) return [];

  let folderId=null;
  if(folderName){
    let existing=state.folders.find(f=>f.name===folderName);
    if(!existing){ existing={id:uid(),name:folderName,path:null}; state.folders.push(existing); await idbPut("folders",existing); }
    folderId=existing.id;
  }

  const resultTracks=[];
  let addedAny=false;

  for(const file of files){
    const tags=await readTags(file);
    const guess=guessFromName(file.name);
    const title=tags.title || guess.title;
    const artist=tags.artist || guess.artist;

    const filePath=resolveFilePath(file);

    if(folderId){
      const folderObj=state.folders.find(f=>f.id===folderId);
      if(folderObj && !folderObj.path){
        const rootPath=deriveFolderRootPath(file, filePath);
        if(rootPath){ folderObj.path=rootPath; idbPut("folders",folderObj); }
      }
    }

    const existingTrack=state.tracks.find(t=>{
      const sameTitleArtist=
        (t.title||"").trim().toLowerCase()===title.trim().toLowerCase() &&
        (t.artist||"").trim().toLowerCase()===artist.trim().toLowerCase();
      if(!sameTitleArtist) return false;
      return filePath ? t.filePath===filePath : (t.fileBlob && t.fileBlob.size===file.size);
    });
    if(existingTrack){
      if(persist && existingTrack.external){
        existingTrack.external=false;
        idbPut("tracks",{
          id:existingTrack.id, title:existingTrack.title, artist:existingTrack.artist, album:existingTrack.album,
          trackNum:existingTrack.trackNum,
          duration:existingTrack.duration, folderId:existingTrack.folderId, dateAdded:existingTrack.dateAdded,
          fileBlob:existingTrack.fileBlob, artBlob:existingTrack.artBlob, filePath:existingTrack.filePath
        });
        addedAny=true;
      }
      resultTracks.push(existingTrack);
      continue;
    }

    const fileBlob=filePath ? null : file;
    const fileURL=filePath ? filePathToURL(filePath) : URL.createObjectURL(fileBlob);
    const duration=await getDuration(fileURL);
    const track={
      id:uid(),
      title,
      artist,
      album: tags.album || "Unknown Album",
      trackNum: tags.trackNum ?? null,
      duration,
      folderId,
      dateAdded: Date.now(),
      fileBlob,
      artBlob: tags.artBlob||null,
      filePath,
      external: !persist
    };
    hydrateTrack(track);
    state.tracks.push(track);
    resultTracks.push(track);
    addedAny=true;

    if(persist){
      const storeCopy={
        id:track.id, title:track.title, artist:track.artist, album:track.album,
        trackNum:track.trackNum,
        duration:track.duration, folderId:track.folderId, dateAdded:track.dateAdded,
        fileBlob:track.fileBlob, artBlob:track.artBlob, filePath:track.filePath
      };
      idbPut("tracks",storeCopy);
    }
  }
  if(addedAny) renderTab();
  return resultTracks;
}



function libraryTracks(){
  return state.tracks.filter(t=>!t.external);
}

export { sanitizeFilename, backfillTrackNumbers, pruneFolder, verifyLibraryOnDisk, ingestFiles, libraryTracks };
