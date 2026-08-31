import { state, idbPut, idbDelete, uid, AUDIO_EXT, $ } from "./state.js";
import { renderTab } from "./library-view.js";
import { hydrateTrack, filePathToURL, resolveFilePath, deriveFolderRootPath } from "./init.js";
import { removeTrackData } from "./playlists.js";

/* ================================================================
   FILE / METADATA HANDLING
   Everything involved in turning a raw <input type="file"> File
   object into a track record: guessing title/artist from the
   filename, reading embedded ID3/metadata tags, and measuring
   how long the audio actually is.
   ================================================================ */

// Turns "Artist" + "Title" into a filesystem-safe base filename (no
// extension) — strips characters that are illegal on Windows/most
// filesystems, collapses stray whitespace, and falls back to
// "Untitled" if that leaves nothing usable. Used when renaming the
// real file on disk to match an edited title/artist (see the Edit
// modal's Save handler further down).
function sanitizeFilename(name){
  return name
    .replace(/[\\/:*?"<>|]/g,"-")
    .replace(/\s{2,}/g," ")
    .trim()
    .slice(0,180) || "Untitled";
}



// One-time migration: tracks saved before the Track Number sort
// existed have no trackNum property at all (undefined, not null —
// ingestFiles() always sets one or the other for new imports, so
// Migration: backfills trackNum for any track that doesn't have a
// real one yet — either never checked (trackNum===undefined, for
// libraries saved before this feature existed) OR checked before but
// came back empty (trackNum===null). Deliberately keeps retrying the
// null case too, not just undefined: an earlier build of this exact
// migration could only reach these files over a page fetch() to
// playnck-file://, which the CSP's connect-src silently blocked —
// so plenty of libraries already have a *confirmed-looking* null
// sitting in IndexedDB that was actually just a blocked request, not
// a real "no tag" result. Treating null as "try again" lets this
// self-heal now that path-backed tracks go through IPC instead (see
// below), without needing a one-off manual migration step. Once a
// track gets a real number back, it stays a number and is never
// touched by this again — only genuinely-still-null tracks keep
// getting retried on future launches, which is harmless.
//
// Two ways to actually read it back in, tried in this order:
//   1. Electron, path-backed tracks (the common case — these never
//      keep a fileBlob): ask the MAIN PROCESS to re-parse the file
//      with music-metadata, over the existing getAudioMetadata IPC
//      call. This is the reliable path — it's plain IPC, not a page
//      fetch()/XHR, so it's completely unaffected by the page's CSP
//      connect-src (unlike asking jsmediatags to read the track over
//      its playnck-file:// streaming URL from the renderer, which
//      depends on connect-src allowing that scheme).
//   2. Anything else (web build, or a track that still has its
//      original Blob): read tags directly off that Blob with
//      jsmediatags, same as at import time — no network/IPC
//      involved either way, so nothing here can block it.
// Runs quietly in the background; re-renders once at the end if
// anything actually changed. Logged to the console (visible under
// `npm start`; production builds have devtools locked out — see
// main.js — so this is dev-only visibility, not user-facing).
async function backfillTrackNumbers(){
  // Unpersisted external tracks (see ingestFiles()) are skipped —
  // there's nothing in the library store for a fix-up here to write
  // back to, and doing the lookup anyway would just end up calling
  // idbPut() on a track that's supposed to stay temporary.
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
    if(trackNum===t.trackNum) continue; // still unresolved — nothing to persist, will retry next launch
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



// Longest shared directory prefix across a list of absolute file
// paths, split on whichever separator the first path uses ("\\" on
// Windows, "/" elsewhere) and compared component-by-component so a
// shared string prefix like "C:\\Users\\bob\\Music2" doesn't get
// mistaken for being inside "C:\\Users\\bob\\Music" just because the
// raw strings overlap. Always returns a directory, never a path that
// includes the last (file-name) component — a folder that so far only
// has one track in it would otherwise "share" that track's own full
// path, filename included. Returns null when there's nothing to
// compare (empty list) or the paths genuinely share no directory.
function longestCommonDirectory(paths){
  if(!paths.length) return null;
  const sep=paths[0].includes("\\") ? "\\" : "/";
  const partsList=paths.map(p=>p.split(sep));
  let common=partsList[0].slice(0,-1); // drop the filename from the first path
  for(let i=1;i<partsList.length;i++){
    const parts=partsList[i].slice(0,-1);
    let j=0;
    while(j<common.length && j<parts.length && common[j]===parts[j]) j++;
    common=common.slice(0,j);
    if(!common.length) return null;
  }
  return common.length ? common.join(sep) : null;
}



// One-time-per-folder self-heal, same spirit as backfillTrackNumbers()
// above: folders saved before folder.path existed (see
// deriveFolderRootPath() up in the FILE / METADATA HANDLING section)
// have no known real directory for rescanFolders()/verifyLibraryOnDisk()
// below to check or walk. Best-effort recovery: the longest common
// directory shared by every track already known to be inside that
// folder is *usually* exactly its real root — it undershoots only in
// the one case where every single track happens to live in the same
// one subfolder, in which case the deepest shared ancestor found here
// is that subfolder rather than the true root (rescanning would then
// miss anything later added to a *different* sibling subfolder, until
// the user re-adds the folder from the Folders tab, which fixes it
// for good via deriveFolderRootPath() instead). Returns true if
// anything was actually recovered, so callers know whether the
// backfilled folders are worth persisting/using right away.
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



// Turns a batch of real absolute file paths (found by scan-folder in
// main.js — see rescanFolders() below) directly into saved tracks,
// without ever going through a browser File object. That's the one
// thing that makes this different from ingestFiles(): a file
// discovered by walking a folder on disk was never picked from a
// file dialog or drag/drop, so there's no File to read with
// jsmediatags and no size to duration-probe with an <audio> element —
// title/artist/album/trackNum/cover art and duration all come from a
// single getAudioMetadata() IPC call per file instead (see
// metadata-bridge.js). Electron only; callers already guard on
// window.electronAPI before this is ever reached.
// Returns true if anything was actually added.
async function ingestDiscoveredPaths(paths, folderId){
  if(!paths.length) return false;
  let addedAny=false;

  for(const filePath of paths){
    // Defensive re-check — the caller already filters against tracks
    // it knew about at scan time, but this loop can run long on a big
    // folder, so guard against the rare case of the same path getting
    // added some other way (e.g. drag/drop) while this was still going.
    // Excludes unpersisted external tracks (see ingestFiles()) on
    // purpose: a file living inside a library folder shouldn't stay
    // unimported forever just because it was previously opened
    // externally — the next rescan should still pick it up for real.
    if(state.tracks.some(t=>t.filePath===filePath && !t.external)) continue;

    let meta=null;
    try{ meta=await window.electronAPI.getAudioMetadata(filePath); }
    catch(e){ console.warn("ingestDiscoveredPaths: getAudioMetadata failed for",filePath,e); }
    if(!meta) continue;

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
  }
  return addedAny;
}



// Shared "the folder itself is gone from disk" cleanup, used by both
// verifyLibraryOnDisk() and handleMissingTrack() further down. Same
// removal as the "Forget folder" menu action (see forgetFolder() in
// the FOLDERS section) minus two things that don't apply here: the
// confirm() prompt (this only ever runs after already confirming with
// the OS that the directory itself is gone, so there's nothing left
// to ask the user about) and notifyTracksDeleted() (that dispatches
// trashFile calls to send real files to the Recycle Bin/Trash —
// pointless here, since the files being gone is the entire reason
// this is running). Doesn't re-render — callers do that once after
// everything they're pruning in one pass is done.
function pruneFolder(folder){
  const tracksInFolder=state.tracks.filter(t=>t.folderId===folder.id);
  tracksInFolder.forEach(t=>removeTrackData(t));

  state.folders=state.folders.filter(f=>f.id!==folder.id);
  idbDelete("folders",folder.id);

  if(state.filter && state.filter.type==="folder"){
    state.filter.tracks=state.filter.tracks.filter(t=>t.folderId!==folder.id);
  }
}



// Scans every already-added folder that has a known real root path
// (see deriveFolderRootPath()/backfillFolderPaths() above) for audio
// files that aren't in the library yet, and imports whatever it
// finds via ingestDiscoveredPaths() — this is what picks up a song
// dropped into an already-added folder from outside the app, without
// the user needing to re-run "Add Folder". Electron only; a no-op
// wherever window.electronAPI.scanFolder isn't available (plain web).
// Returns true if anything was actually added, so callers know
// whether a re-render is needed.
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



// Runs once after the library loads, and again periodically while
// the app stays open (see the setInterval/focus wiring in init()
// below), to catch tracks and folders that were moved or deleted from
// OUTSIDE the app — Explorer/Finder, another program, a sync client —
// since the app otherwise has no way to know about that on its own.
// Electron only; a total no-op on a plain web build, where a track is
// backed by an in-memory Blob rather than a live path on disk and
// can't go stale this way.
//
//   1. Any folder whose own root directory no longer exists on disk
//      is pruned entirely, along with every track that was inside it
//      (see pruneFolder() above).
//   2. Any individual path-backed track whose file no longer exists,
//      whose containing folder is otherwise still fine, is pruned on
//      its own (reuses removeTrackData() — see the PLAYLISTS section).
//   3. Every folder that's still there gets rescanned (see
//      rescanFolders() above) for audio files not in the library yet.
//
// All of this is silent/best-effort by design, same reasoning as
// backfillTrackNumbers() above: it runs in the background on every
// launch (and on a timer/window focus after that), so surfacing
// failures here would just be noise the user can't act on. It renders
// once at the end if anything actually changed.
async function verifyLibraryOnDisk(){
  if(!window.electronAPI || !window.electronAPI.checkPathsExist) return;

  backfillFolderPaths(); // best-effort; folders that get a path here are included in the checks below

  const folderPaths=state.folders.filter(f=>f.path).map(f=>f.path);
  const trackPaths=state.tracks.filter(t=>t.filePath).map(t=>t.filePath);
  if(!folderPaths.length && !trackPaths.length) return;

  let existence={};
  try{ existence=await window.electronAPI.checkPathsExist([...folderPaths, ...trackPaths]); }
  catch(e){ console.warn("verifyLibraryOnDisk: checkPathsExist failed",e); return; }

  let changed=false;

  // 1) Whole folders whose root directory is gone.
  const goneFolders=state.folders.filter(f=>f.path && existence[f.path]===false);
  goneFolders.forEach(f=>{ pruneFolder(f); changed=true; });

  // 2) Individual missing files, skipping tracks already swept up by
  // a gone folder above (pruneFolder() already removed those).
  const goneFolderIds=new Set(goneFolders.map(f=>f.id));
  state.tracks
    .filter(t=>t.filePath && existence[t.filePath]===false && !goneFolderIds.has(t.folderId))
    .forEach(t=>{ removeTrackData(t); changed=true; });

  if(changed) renderTab();

  // 3) Pick up new files in whatever folders are still valid.
  const rescanChanged=await rescanFolders();
  if(rescanChanged) renderTab();
}



// Best-effort guess at "Artist - Title" from a bare filename, used
// whenever a file has no embedded metadata tags to read from.
function guessFromName(filename){
  const base=filename.replace(/\.[^.]+$/,"");
  const parts=base.split(" - ");
  if(parts.length>=2){ return {artist:parts[0].trim(), title:parts.slice(1).join(" - ").trim()}; }
  return {artist:"Unknown Artist", title:base};
}



// Reads embedded tags (title/artist/album/cover art) from an audio
// file using the jsmediatags library. Resolves to {} (no crash) if
// the library isn't loaded or the file has no readable tags.
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



// Pulls the leading integer out of an ID3 "track" tag, which can
// arrive as a plain number, a string like "7", or "7/12" (track 7
// of 12 — jsmediatags/ID3 report it this way). Returns null when
// there's nothing usable, so tracks without an embedded track
// number can be sorted to the end instead of lumped in at "0".
function parseTrackNum(raw){
  if(raw===undefined || raw===null || raw==="") return null;
  const n=parseInt(String(raw).split("/")[0],10);
  return Number.isFinite(n) ? n : null;
}



// Measures a track's playback duration (in seconds) by loading it
// into a throwaway <audio> element just far enough to read its
// metadata.
function getDuration(url){
  return new Promise((resolve)=>{
    const a=new Audio();
    a.preload="metadata";
    a.src=url;
    a.onloadedmetadata=()=>resolve(a.duration||0);
    a.onerror=()=>resolve(0);
  });
}



// Takes a raw FileList (from either the "Add Songs" or "Add
// Folder" button in the Folders tab, or the external open-file
// handler further down) and turns every audio file in it into a
// track. When folderName is given, a matching folder is created (if
// it doesn't already exist) and every file is tagged with it.
//
// opts.persist (default true) is what separates an intentional
// library import from a track someone just opened externally
// (double-click / "Open with" / launching Playnck on a file — see
// the open-file listener below): with persist:false, a genuinely
// new file still becomes a real, playable track object and still
// goes through the same duplicate guard as everything else, but it
// is never written to IndexedDB and is flagged track.external=true
// so libraryTracks() (just below) leaves it out of the Songs/
// Albums/Artists/Home library views and it simply won't exist again
// next launch — exactly like it never happened, other than having
// played once. If that same file is later imported for real (Add
// Songs/Add Folder, persist:true) while its external copy is still
// in memory, the duplicate guard below "promotes" that existing
// object into a real library track instead of creating a second one.
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

  // Tracks produced by this call, in the same order as `files` — either
  // a freshly created track, or (if the same song is already in the
  // library) the existing track it matched, so callers like the
  // "open file" handler below can always play *something* sensible
  // without caring whether it was new or already there.
  const resultTracks=[];
  let addedAny=false;

  for(const file of files){
    const tags=await readTags(file);
    const guess=guessFromName(file.name);
    const title=tags.title || guess.title;
    const artist=tags.artist || guess.artist;

    const filePath=resolveFilePath(file);   // Electron only; null on web — see resolveFilePath()

    // Learn this folder's real root directory on disk the first
    // chance we get, so rescanFolders()/verifyLibraryOnDisk() further
    // down can find it again later — see deriveFolderRootPath() up
    // above for how. Deliberately done here, before the duplicate
    // check below, so re-running "Add Folder" over a folder that's
    // already fully imported (every file a duplicate) still backfills
    // a missing path — the main way a folder added before this
    // feature existed ever picks one up.
    if(folderId){
      const folderObj=state.folders.find(f=>f.id===folderId);
      if(folderObj && !folderObj.path){
        const rootPath=deriveFolderRootPath(file, filePath);
        if(rootPath){ folderObj.path=rootPath; idbPut("folders",folderObj); }
      }
    }

    // Duplicate guard: if this exact file on disk (by path) or a
    // track with the same title/artist/size is already in the
    // library (or already sitting in memory as a not-yet-persisted
    // external track — see opts.persist above), treat this as
    // "already there" rather than adding a second copy. This is
    // what stops re-opening a song you've already added (double-
    // click, "Open with", drag onto the app icon a second time,
    // etc.) from piling up duplicate rows in the songs list.
    const existingTrack=state.tracks.find(t=>{
      const sameTitleArtist=
        (t.title||"").trim().toLowerCase()===title.trim().toLowerCase() &&
        (t.artist||"").trim().toLowerCase()===artist.trim().toLowerCase();
      if(!sameTitleArtist) return false;
      return filePath ? t.filePath===filePath : (t.fileBlob && t.fileBlob.size===file.size);
    });
    if(existingTrack){
      // A real import (persist:true) landing on a track that only
      // existed as a temporary external one promotes it into the
      // library for real, instead of silently staying unpersisted —
      // otherwise explicitly re-adding a song you'd only ever
      // double-clicked before would look like it worked but
      // vanish again on next launch.
      if(persist && existingTrack.external){
        existingTrack.external=false;
        idbPut("tracks",{
          id:existingTrack.id, title:existingTrack.title, artist:existingTrack.artist, album:existingTrack.album,
          trackNum:existingTrack.trackNum,
          duration:existingTrack.duration, folderId:existingTrack.folderId, dateAdded:existingTrack.dateAdded,
          fileBlob:existingTrack.fileBlob, artBlob:existingTrack.artBlob, filePath:existingTrack.filePath
        });
        addedAny=true; // wasn't visible in the library before; it is now, so the Songs tab needs a repaint
      }
      resultTracks.push(existingTrack);
      continue;
    }

    // Tracks that resolve to a real path on disk (Electron only)
    // stream straight from disk via playnck-file:// (see main.js /
    // hydrateTrack() above) instead of keeping a second, duplicated
    // copy of the audio bytes in memory and in IndexedDB. That also
    // sidesteps the old problem where a File picked from a dialog
    // could later fail to read ("file has changed since it was
    // selected") after the Edit modal rewrote its tags — playback
    // now always goes straight through the current file on disk
    // rather than through a File object tied to the moment it was
    // selected. Files that don't resolve to a real path (plain web)
    // have no such disk-backed URL available, so they still keep
    // the actual Blob — it's the only way the browser can play them
    // back later.
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
      dateAdded: Date.now(),      // Shown by the Info panel as "Date added"
      fileBlob,
      artBlob: tags.artBlob||null,
      filePath,
      external: !persist          // true only for an unpersisted, externally-opened track — see libraryTracks() below
    };
    hydrateTrack(track);
    state.tracks.push(track);     // kept in state.tracks either way, so playback/queue/next-prev lookups work identically for external tracks — see libraryTracks() for the one place that needs to tell the two apart
    resultTracks.push(track);
    addedAny=true;

    // Save a plain copy to IndexedDB — deliberately WITHOUT the
    // temporary fileURL/artURL, since those blob: URLs only make
    // sense for this one page session and would be meaningless
    // (and wasteful) to persist. Skipped entirely for an external
    // track: that's the actual fix — it plays like any other track
    // this session, but there's nothing on disk for next launch to
    // find, so it's gone from the library as if it never happened.
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



// The library-facing view of state.tracks — every track EXCEPT the
// unpersisted, externally-opened ones (see the "external" flag set
// in ingestFiles() above). Anything that's showing the user "your
// music library" (Songs/Albums/Artists/Home, the add-to-playlist
// picker, library-wide stats) should read through this instead of
// state.tracks directly, so a song opened via double-click/"Open
// with" doesn't visibly show up as a library item during this
// session either — not just after a restart. Playback/queue code
// (nextTrack/prevTrack, now-playing, favorites, etc.) intentionally
// keeps using state.tracks as-is, since an external track still
// needs to actually play, seek, and skip normally while it's the
// current track.
function libraryTracks(){
  return state.tracks.filter(t=>!t.external);
}

export { sanitizeFilename, backfillTrackNumbers, pruneFolder, verifyLibraryOnDisk, ingestFiles, libraryTracks };
