/*
  MY MUSIC PLAYER — SCRIPT
  Part of a 3-file split: index.html, styles.css, script.js (this file)
  Keep all three in the same folder.
*/

(function(){
"use strict";

/* ================================================================
                                    
                                ░█████                                       ░██████                       ░██              ░██    
                                  ░██                                       ░██   ░██                                       ░██    
                                  ░██   ░██████   ░██    ░██  ░██████      ░██          ░███████  ░██░████ ░██░████████  ░████████ 
                                  ░██        ░██  ░██    ░██       ░██      ░████████  ░██    ░██ ░███     ░██░██    ░██    ░██    
                            ░██   ░██   ░███████   ░██  ░██   ░███████             ░██ ░██        ░██      ░██░██    ░██    ░██    
                            ░██   ░██  ░██   ░██    ░██░██   ░██   ░██      ░██   ░██  ░██    ░██ ░██      ░██░███   ░██    ░██    
                            ░██████    ░█████░██    ░███     ░█████░██      ░██████    ░███████  ░██      ░██░██░█████      ░████ 
                                                                                                              ░██                  
                                                                                                              ░██                  
                                                                                                                                  
                                                                                            
   
   PART 3: JAVASCRIPT — APP LOGIC (how everything works)
   ----------------------------------------------------------------
   Wrapped in an IIFE ("(function(){ ... })()") so nothing in here
   leaks into the global scope. Organized top-to-bottom as:

     DB layer -> state -> DOM refs -> init -> file/metadata import
     -> format helpers -> grouping -> sorting -> render (drawing
     the sidebar lists) -> context & sort menus -> playlists
     -> playback -> progress bar -> lyrics -> side menu (info/edit)
     -> event bindings (wiring buttons up to all of the above)

   Everything is plain functions operating on the single "state"
   object below — no framework or build step involved.
   ================================================================ */



/* ================================================================
   DB LAYER
   Tiny wrapper around IndexedDB so the rest of the app can just
   call idbGet/idbPut/idbGetAll/idbDelete without touching the
   verbose native IndexedDB API directly. Everything the user adds
   (songs, playlists, folders) is saved here so it's still there
   next time the page is opened.
   ================================================================ */
const DB_NAME="music_player_db", DB_VERSION=2;
let db;



// Opens (and, on first run, creates) the IndexedDB database and
// its five object stores. Returns a promise that resolves with
// the open database connection.
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=(e)=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks",{keyPath:"id"});
      if(!d.objectStoreNames.contains("playlists")) d.createObjectStore("playlists",{keyPath:"id"});
      if(!d.objectStoreNames.contains("folders")) d.createObjectStore("folders",{keyPath:"id"});
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



/* ================================================================
   APP STATE
   One plain object holding everything the UI needs to render.
   Nothing fancy — functions read state.* directly and call
   renderTab() (or a smaller targeted update) whenever it changes.
   ================================================================ */
const state={
  tracks:[],              // every imported song: {id,title,artist,album,duration,folderId,dateAdded,fileBlob,artBlob,fileURL,artURL}
  playlists:[],           // {id,name,trackIds:[]}
  folders:[],             // {id,name}
  favoritesId:null,       // id of the auto-created "Favorites" playlist
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
   INTERNATIONALIZATION (i18n)
   A small, self-contained translation layer. Nav labels, menus, the
   Settings panel, player controls, buttons, empty states, and
   confirmations are all looked up through tr()/plural() so flipping
   state.language repaints every bit of the app's chrome at once.
   Actual library data — song/artist/album/playlist/folder names —
   is never translated, only the surrounding UI text around it.

   Named tr() rather than the more usual t() because `t` is already
   used everywhere in this file as the local variable name for
   "the current track" (see renderSongList, openInfoModal, etc.) —
   a global t() would silently get shadowed by every one of those.

   Settings > Language starts with just English installed; its
   "+ Add language" button installs the next entry from LANGUAGES
   below (today, that's just French) and switches to it right away.
   Adding another language later is just: add it to LANGUAGES, add
   its dictionary to I18N, and — only if some UI text counts it
   ("3 songs") — add its forms to PLURAL_WORDS.
   ================================================================ */
const LANGUAGES={
  en:{native:"English"},
  fr:{native:"Français"}
};

const I18N={
  en:{
    "nav.expandMenu":"Expand menu",
    "nav.home":"Home",
    "nav.songs":"Songs",
    "nav.albums":"Albums",
    "nav.artists":"Artists",
    "nav.playlists":"Playlists",
    "nav.folders":"Folders",
    "nav.convert":"Convert",
    "nav.settings":"Settings",
    "nav.aboutUs":"About Us",

    "header.addMusicToThisPlaylist":"Add music to this playlist",
    "header.search":"Search",
    "header.jumpToPlaying":"Jump to playing song",
    "header.sortSongs":"Sort songs",
    "header.selectPrefix":"Select ",

    "search.placeholder":"Search…",

    "sel.addToPlaylist":"Add to Playlist",
    "sel.delete":"Delete",
    "sel.cancelSelection":"Cancel selection",
    "sel.selectedSuffix":"selected",

    "player.lyrics":"Lyrics",
    "player.love":"Love",
    "player.visualizer":"Visualizer",
    "player.visualizerNote":"A subtle audio-reactive glow along the bottom edge of the panel, tinted with your theme's accent color.",
    "player.visualizerOpacity":"Opacity",
    "player.shuffle":"Shuffle",
    "player.previous":"Previous",
    "player.next":"Next",
    "player.repeat":"Repeat",
    "player.repeatOne":"Repeat one",
    "player.repeatAll":"Repeat all",
    "player.play":"Play",
    "player.pause":"Pause",
    "player.nothingPlaying":"Nothing playing",
    "player.addSongsToStart":"Add some songs to get started",
    "player.volume":"Volume",
    "player.muted":"Muted",

    "side.moreOptions":"More options",
    "side.info":"Info",
    "side.edit":"Edit",
    "side.syncLyrics":"Sync Lyrics",

    "modal.close":"Close",
    "modal.cancel":"Cancel",
    "modal.ok":"OK",

    "dragDrop.dropToPlay":"Drop to play",

    "empty.noSongs":"No songs here yet. Add some music to get started — go to the Folders tab and add your favorite music folder to get started.",
    "empty.noAlbums":"No albums yet.",
    "empty.noArtists":"No artists yet.",
    "empty.noFolders":"No folders added yet.",
    "empty.noSongsPlayedYet":"No songs played yet.",
    "empty.nothingPlayedYet":"Nothing played yet.",
    "empty.noPlaylistsForAdd":"You don't have any playlists yet. Create one from the Playlists tab first.",
    "empty.noLibraryForAddMusic":"No songs in your library yet. Import some from the Songs or Folders tab first.",
    "empty.nothingPlayingInfo":"Nothing is playing yet. Play a song to see its details here.",
    "empty.nothingPlayingEdit":"Nothing is playing yet. Play a song first, then use the ☰ menu to edit it.",
    "empty.nothingPlayingSync":"Nothing is playing yet. Play a song first, then use the ☰ menu to sync its lyrics.",

    "lyrics.loading":"Loading lyrics…",
    "lyrics.notFoundShort":"No lyrics found for this track.",
    "lyrics.notFound":"No lyrics found for this track, so there's nothing to sync.",
    "lyrics.notTimeSynced":"This track's lyrics aren't time-synced, so there's nothing to offset.",
    "lyrics.syncOffsetAriaLabel":"Lyric sync offset in milliseconds",

    "home.recentlyPlayed":"Recently Played",
    "home.topSongs":"Top Songs",

    "track.removeFromFavorites":"Remove from Favorites",
    "track.addToFavorites":"Add to Favorites",
    "track.info":"Info",
    "track.addToPlaylist":"Add to playlist",
    "track.newPlaylist":"+ New playlist",
    "track.removeFromThisPlaylist":"Remove from this playlist",
    "track.deleteTrack":"Delete track",

    "sort.sortSongsBy":"Sort songs by",
    "sort.titleAsc":"Title (A–Z)",
    "sort.titleDesc":"Title (Z–A)",
    "sort.artistAsc":"Artist (A–Z)",
    "sort.artistDesc":"Artist (Z–A)",
    "sort.durationAsc":"Duration (shortest first)",
    "sort.durationDesc":"Duration (longest first)",
    "sort.dateNewest":"Date added (newest first)",
    "sort.dateOldest":"Date added (oldest first)",
    "sort.trackNumber":"Track Number",

    "playlists.newPlaylist":"+ New Playlist",
    "playlist.rename":"Rename",
    "playlist.delete":"Delete",
    "playlist.export":"Export as .m3u",
    "playlist.exportUnavailable":"Exporting playlists needs the desktop app.",
    "playlist.exportedWithSkipped":"Exported ({count} song(s) without a saved file location were skipped).",
    "playlist.exported":"Exported.",
    "playlist.exportFailed":"Couldn't export playlist: {reason}",
    "prompt.newPlaylistTitle":"New Playlist",
    "prompt.playlistNameLabel":"Playlist name",
    "prompt.renamePlaylistTitle":"Rename Playlist",

    "folder.addSongs":"Add Songs",
    "folder.addFolder":"Add Folder",
    "folder.rename":"Rename folder",
    "folder.forget":"Forget folder",
    "folder.delete":"Delete folder",
    "prompt.renameFolderTitle":"Rename Folder",
    "prompt.folderNameLabel":"Folder name",

    "confirm.deleteNamed":"Delete \"{name}\"? This can't be undone.",
    "confirm.forgetNamed":"Forget \"{name}\"{label}? This can't be undone.",
    "confirm.deleteNamedWithLabel":"Delete \"{name}\"{label}? This can't be undone.",
    "confirm.deleteCountPlaylists":"Delete {label}? This can't be undone. The songs inside will stay in your library.",
    "confirm.deleteCountSongs":"Delete {label}? This can't be undone.",
    "and its":" and its ",
    "labelAnd":" and ",

    "modal.addMusic":"Add Music",
    "modal.addMusicToNamed":"Add Music to \"{name}\"",
    "modal.addCountToPlaylist":"Add {label} to Playlist",
    "btn.add":"Add",
    "btn.added":"Added",

    "info.modalTitleEmpty":"Track Info",
    "info.modalTitle":"Track & File Info",
    "info.rowTitle":"Title",
    "info.rowArtist":"Artist",
    "info.rowAlbum":"Album",
    "info.rowTrackNo":"Track No.",
    "info.rowDuration":"Duration",
    "info.rowFolder":"Folder",
    "info.rowFileName":"File name",
    "info.rowFileType":"File type",
    "info.rowFileSize":"File size",
    "info.rowBitrate":"Bitrate",
    "info.rowDateAdded":"Date added",
    "info.lossless":" (lossless)",
    "common.unknown":"Unknown",

    "edit.modalTitleEmpty":"Edit",
    "edit.modalTitle":"Edit Track",
    "edit.changeCover":"Change Cover",
    "edit.removeCover":"Remove Cover",
    "edit.autoTagFingerprint":"🎧 Identify from audio",
    "edit.autoTagText":"🔎 Search by title/artist",
    "edit.autoTaggingFingerprint":"Reading the audio fingerprint…",
    "edit.autoTaggingText":"Searching MusicBrainz…",
    "edit.autoTagFoundFingerprint":"Match found from the audio itself — review below, then save.",
    "edit.autoTagFoundMusicbrainz":"Match found from title/artist search — review below, then save.",
    "edit.autoTagNotFound":"Couldn't identify this song. {reason}",
    "edit.autoTagUnavailable":"Auto-tag needs the desktop app and a real file on disk.",
    "edit.autoTagPickMatch":"Not the right song? Choose another match:",
    "edit.saveChanges":"Save Changes",
    "edit.saving":"Saving…",
    "edit.savedRenamedAndUpdated":"Saved — the file on disk was renamed and updated too.",
    "edit.savedTagsButNotRenamed":"Saved — tags updated on disk, but the file couldn't be renamed: {reason}",
    "edit.savedToLibraryOnly":"Saved to your library. {reason}",
    "edit.savedButNotRenamed":"Saved to your library, but the file couldn't be renamed: {reason}",
    "edit.savedButNoCoverArtSupport":"Saved — tags updated on disk, but this file format can't hold embedded cover art.",
    "edit.fileNotChanged":"The file on disk wasn't changed.",
    "edit.couldntRenameGeneric":"Couldn't rename the file on disk.",
    "edit.fileWriteFailed":"The file on disk wasn't updated. {reason} Nothing has been saved yet.",
    "edit.saveLibraryOnly":"Save inside Playnck only",
    "edit.savedLibraryOnlyConfirmed":"Saved inside Playnck only — the file on disk still has the old metadata.",

    "sync.hint":"Nudge the timing until the highlighted line matches what's being sung. Positive delays the lyrics, negative shows them earlier.",
    "sync.resetTo0":"Reset to 0",
    "sync.done":"Done",

    "settings.theme":"Theme",
    "settings.updates":"Updates",
    "settings.audio":"Audio",
    "settings.player":"Player",
    "settings.backup":"Backup & Restore",
    "backup.desktopOnly":"Backup & Restore needs the desktop app.",
    "backup.note":"Saves your playlists, favorites, lyrics, and settings to a file — handy before reinstalling or moving to a new PC. Songs are referenced by their saved file location, not copied into the backup.",
    "backup.exportBtn":"Export Backup",
    "backup.importBtn":"Import Backup",
    "backup.exporting":"Saving backup…",
    "backup.exported":"Backup saved.",
    "backup.exportedWithSkipped":"Backup saved ({count} song(s) without a saved file location were skipped).",
    "backup.exportFailed":"Couldn't save backup: {reason}",
    "backup.importConfirm":"Import this backup? Matching playlists/songs will be overwritten — nothing else is deleted.",
    "backup.importing":"Restoring backup…",
    "backup.imported":"Restored {restored} song(s) ({skipped} skipped).",
    "backup.importFailed":"Couldn't import backup: {reason}",
    "backup.invalidFile":"That doesn't look like a Playnck backup file.",
    "side.sleepTimer":"Sleep Timer",
    "sleep.title":"Sleep Timer",
    "sleep.off":"Off — playback won't pause on its own.",
    "sleep.activeStatus":"Stops in about {minutes} min.",
    "sleep.presetMinutes":"{minutes} min",
    "sleep.turnOff":"Turn Off",
    "sleep.note":"Pauses playback once the time is up. Doesn't touch repeat, shuffle, or your queue — everything picks up right where it left off if you hit play again.",
    "settings.language":"Language",
    "settings.appBackground":"App background",
    "settings.accentColor":"Accent color",
    "settings.themeNote":"Changes apply instantly and last for this session.",
    "settings.audioPlaceholder":"Audio settings will go here.",
    "audio.equalizer":"Equalizer",
    "audio.equalizerNote":"A 10-band graphic EQ. Turn it on, then use a preset or drag the bands yourself.",
    "audio.eqFlat":"Flat",
    "audio.eqBassBoost":"Bass Boost",
    "audio.eqTrebleBoost":"Treble Boost",
    "audio.eqVocalBoost":"Vocal Boost",
    "audio.gapless":"Gapless Playback",
    "audio.gaplessNote":"Smooths the transition between songs with a short automatic crossfade instead of a hard cut. Doesn't affect repeat-one.",
    "settings.nowPlayingBgImage":"Now-playing background image",
    "settings.chooseImage":"Choose Image",
    "settings.remove":"Remove",
    "settings.blur":"Blur",
    "settings.playerBgNote":"Shown behind the cover art on the now-playing panel. Stored on this device only.",
    "settings.noImage":"No image",

    "updates.checking":"Checking for updates…",
    "updates.foundDownloading":"Update found (v{version}) — starting download…",
    "updates.downloading":"Downloading update…",
    "updates.readyRestart":"Update ready (v{version}) — restart to install",
    "updates.upToDate":"You're up to date",
    "updates.running":"Running {version}",
    "updates.couldntCheck":"Couldn't check for updates.",
    "updates.checkForUpdates":"Check for Updates",
    "updates.checkingBtn":"Checking…",
    "updates.downloadingBtn":"Downloading…",
    "updates.restartInstall":"Restart & Install",
    "updates.tryAgain":"Try Again",
    "updates.onlyDesktop":"Updates are only available in the installed desktop app.",

    "language.addButton":"+ Add language",
    "language.note":"Your language choice is stored on this device only.",
    "language.noMore":"More languages coming soon.",

    "about.tagline":"PLAYNCK is a fast, no-frills music player for your local library — folders in, playback, tags, cover art and time-synced lyrics out. No accounts, no streaming, no ads: just the songs already on your computer.",
    "about.buildVersion":"Build version",
    "about.communityText":"Got a bug, an idea, or just want to hang out with other people using PLAYNCK? Come say hi on Telegram — it's where updates get announced first, feature requests get discussed, and folks help each other out.",
    "about.telegramBtn":"Join the Telegram group",
    "about.supportTitle":"Support Playnck ❤️",
    "about.supportText":"Enjoying Playnck? If you'd like to support the project and its future development, you can send a small donation through Binance Pay.",
    "about.supportQrAlt":"Binance Pay donation QR code",
    "about.supportQrCaption":"Scan with Binance Pay",
    "about.donateBtn":"Donate with Binance Pay",

    "theme.bg.dark":"GitHub Black",
    "theme.bg.light":"Light",
    "theme.bg.pitchblack":"Pitch Black",
    "theme.bg.midnight":"Deep Midnight Blue",
    "theme.bg.graphite":"Graphite Gray",
    "theme.bg.forest":"Forest Green",
    "theme.accent.blue":"Blue",
    "theme.accent.red":"Red",
    "theme.accent.orange":"Orange",
    "theme.accent.green":"Green",
    "theme.accent.purple":"Purple",
    "theme.accent.yellow":"Yellow",
    "theme.accent.pink":"Pink",
    "theme.accent.teal":"Teal",
    "theme.accent.indigo":"Indigo",
    "theme.accent.cyan":"Cyan",
    "theme.accent.lime":"Lime",
    "theme.accent.rose":"Rose",

    "convert.desktopOnly":"The Convert tab needs the desktop app.",
    "convert.checkingFFmpeg":"Checking for FFmpeg…",
    "convert.ffmpegReady":"FFmpeg Ready",
    "convert.ffmpegRequired":"FFmpeg is required",
    "convert.ffmpegRequiredNote":"The Convert tab uses FFmpeg to do the actual audio conversion. It's free and open-source, and only needs to be installed once.",
    "convert.installFFmpeg":"Install FFmpeg",
    "convert.installing":"Installing FFmpeg…",
    "convert.installFailed":"Installation failed",
    "convert.tryAgain":"Try Again",
    "convert.installManually":"You can also install FFmpeg yourself from ffmpeg.org, then reopen this tab.",

    "convert.addFiles":"Add Files",
    "convert.dropHere":"Drop audio files here",
    "convert.or":"or",
    "convert.browseFiles":"Browse Files",
    "convert.addFolder":"Add Folder",
    "convert.filesAdded":"{count} file(s) added",
    "convert.noNewFiles":"No supported audio files found there.",
    "convert.alreadyQueued":"already in the queue",

    "convert.queueTitle":"Conversion Queue",
    "convert.queueEmpty":"No files added yet — drag audio files in, or use Browse Files / Add Folder above.",
    "convert.clearQueue":"Clear Queue",
    "convert.removeFile":"Remove",
    "convert.status.waiting":"Waiting",
    "convert.status.converting":"Converting",
    "convert.status.completed":"Completed",
    "convert.status.failed":"Failed",
    "convert.status.skipped":"Skipped",
    "convert.status.cancelled":"Cancelled",

    "convert.settingsTitle":"Conversion Settings",
    "convert.outputFormat":"Output Format",
    "convert.bitrate":"Bitrate",
    "convert.flacCompression":"FLAC Compression Level",
    "convert.flacCompressionNote":"Higher = smaller file, slower to encode. Doesn't affect audio quality — FLAC is always lossless.",
    "convert.bitDepth":"Bit Depth",
    "convert.losslessNote":"Lossless — nothing to lose, so there's no quality setting.",

    "convert.outputTitle":"Output",
    "convert.outputFolder":"Output Folder",
    "convert.chooseFolder":"Choose Folder",
    "convert.ifFileExists":"If a file already exists",
    "convert.collision.rename":"Rename automatically",
    "convert.collision.replace":"Replace",
    "convert.collision.skip":"Skip",

    "convert.currentFile":"Converting",
    "convert.overallProgress":"Overall Progress",
    "convert.filesOf":"{done} / {total} files",

    "convert.startConversion":"Start Conversion",
    "convert.cancel":"Cancel",
    "convert.cancelling":"Cancelling…",

    "convert.completeTitle":"Conversion Complete",
    "convert.completeSummary":"{count} file(s) converted successfully",
    "convert.completeSummaryFailed":", {count} failed",
    "convert.completeSummarySkipped":", {count} skipped",
    "convert.outputLocation":"Output: {path}",
    "convert.openOutputFolder":"Open Output Folder",
    "convert.startNewBatch":"Convert More Files"
  },
  fr:{
    "nav.expandMenu":"Développer le menu",
    "nav.home":"Accueil",
    "nav.songs":"Titres",
    "nav.albums":"Albums",
    "nav.artists":"Artistes",
    "nav.playlists":"Playlists",
    "nav.folders":"Dossiers",
    "nav.settings":"Paramètres",
    "nav.aboutUs":"À propos",

    "header.addMusicToThisPlaylist":"Ajouter de la musique à cette playlist",
    "header.search":"Rechercher",
    "header.jumpToPlaying":"Aller à la chanson en cours",
    "header.sortSongs":"Trier les titres",
    "header.selectPrefix":"Sélectionner ",

    "search.placeholder":"Rechercher…",

    "sel.addToPlaylist":"Ajouter à une playlist",
    "sel.delete":"Supprimer",
    "sel.cancelSelection":"Annuler la sélection",
    "sel.selectedSuffix":"sélectionné(s)",

    "player.lyrics":"Paroles",
    "player.love":"J'aime",
    "player.visualizer":"Visualiseur",
    "player.visualizerNote":"Une lueur discrète réagissant à l'audio le long du bord inférieur du panneau, teintée avec la couleur d'accent de votre thème.",
    "player.visualizerOpacity":"Opacité",
    "player.shuffle":"Lecture aléatoire",
    "player.previous":"Précédent",
    "player.next":"Suivant",
    "player.repeat":"Répéter",
    "player.repeatOne":"Répéter un titre",
    "player.repeatAll":"Tout répéter",
    "player.play":"Lecture",
    "player.pause":"Pause",
    "player.nothingPlaying":"Aucune lecture en cours",
    "player.addSongsToStart":"Ajoutez des titres pour commencer",
    "player.volume":"Volume",
    "player.muted":"Muet",

    "side.moreOptions":"Plus d'options",
    "side.info":"Infos",
    "side.edit":"Modifier",
    "side.syncLyrics":"Synchroniser les paroles",

    "modal.close":"Fermer",
    "modal.cancel":"Annuler",
    "modal.ok":"OK",

    "dragDrop.dropToPlay":"Déposer pour lire",

    "empty.noSongs":"Aucun titre ici pour le moment. Ajoutez de la musique pour commencer — allez dans l'onglet Dossiers et ajoutez votre dossier de musique préféré.",
    "empty.noAlbums":"Aucun album pour le moment.",
    "empty.noArtists":"Aucun artiste pour le moment.",
    "empty.noFolders":"Aucun dossier ajouté pour le moment.",
    "empty.noSongsPlayedYet":"Aucun titre écouté pour le moment.",
    "empty.nothingPlayedYet":"Rien n'a encore été écouté.",
    "empty.noPlaylistsForAdd":"Vous n'avez pas encore de playlist. Créez-en une depuis l'onglet Playlists.",
    "empty.noLibraryForAddMusic":"Aucun titre dans votre bibliothèque. Importez-en depuis l'onglet Titres ou Dossiers.",
    "empty.nothingPlayingInfo":"Rien n'est en cours de lecture. Lancez un titre pour voir ses informations ici.",
    "empty.nothingPlayingEdit":"Rien n'est en cours de lecture. Lancez d'abord un titre, puis utilisez le menu ☰ pour le modifier.",
    "empty.nothingPlayingSync":"Rien n'est en cours de lecture. Lancez d'abord un titre, puis utilisez le menu ☰ pour synchroniser ses paroles.",

    "lyrics.loading":"Chargement des paroles…",
    "lyrics.notFoundShort":"Aucune parole trouvée pour ce titre.",
    "lyrics.notFound":"Aucune parole trouvée pour ce titre, il n'y a donc rien à synchroniser.",
    "lyrics.notTimeSynced":"Les paroles de ce titre ne sont pas synchronisées, il n'y a donc rien à décaler.",
    "lyrics.syncOffsetAriaLabel":"Décalage de synchronisation des paroles en millisecondes",

    "home.recentlyPlayed":"Écoutés récemment",
    "home.topSongs":"Titres les plus écoutés",

    "track.removeFromFavorites":"Retirer des favoris",
    "track.addToFavorites":"Ajouter aux favoris",
    "track.info":"Infos",
    "track.addToPlaylist":"Ajouter à une playlist",
    "track.newPlaylist":"+ Nouvelle playlist",
    "track.removeFromThisPlaylist":"Retirer de cette playlist",
    "track.deleteTrack":"Supprimer le titre",

    "sort.sortSongsBy":"Trier les titres par",
    "sort.titleAsc":"Titre (A–Z)",
    "sort.titleDesc":"Titre (Z–A)",
    "sort.artistAsc":"Artiste (A–Z)",
    "sort.artistDesc":"Artiste (Z–A)",
    "sort.durationAsc":"Durée (la plus courte d'abord)",
    "sort.durationDesc":"Durée (la plus longue d'abord)",
    "sort.dateNewest":"Date d'ajout (plus récent d'abord)",
    "sort.dateOldest":"Date d'ajout (plus ancien d'abord)",
    "sort.trackNumber":"Numéro de piste",

    "playlists.newPlaylist":"+ Nouvelle playlist",
    "playlist.rename":"Renommer",
    "playlist.delete":"Supprimer",
    "playlist.export":"Exporter en .m3u",
    "playlist.exportUnavailable":"L'exportation des playlists nécessite l'application de bureau.",
    "playlist.exportedWithSkipped":"Exporté ({count} morceau(x) sans emplacement de fichier enregistré ont été ignorés).",
    "playlist.exported":"Exporté.",
    "playlist.exportFailed":"Impossible d'exporter la playlist : {reason}",
    "prompt.newPlaylistTitle":"Nouvelle playlist",
    "prompt.playlistNameLabel":"Nom de la playlist",
    "prompt.renamePlaylistTitle":"Renommer la playlist",

    "folder.addSongs":"Ajouter des titres",
    "folder.addFolder":"Ajouter un dossier",
    "folder.rename":"Renommer le dossier",
    "folder.forget":"Oublier le dossier",
    "folder.delete":"Supprimer le dossier",
    "prompt.renameFolderTitle":"Renommer le dossier",
    "prompt.folderNameLabel":"Nom du dossier",

    "confirm.deleteNamed":"Supprimer « {name} » ? Cette action est irréversible.",
    "confirm.forgetNamed":"Oublier « {name} »{label} ? Cette action est irréversible.",
    "confirm.deleteNamedWithLabel":"Supprimer « {name} »{label} ? Cette action est irréversible.",
    "confirm.deleteCountPlaylists":"Supprimer {label} ? Cette action est irréversible. Les titres qu'elles contiennent resteront dans votre bibliothèque.",
    "confirm.deleteCountSongs":"Supprimer {label} ? Cette action est irréversible.",
    "and its":" et ses ",
    "labelAnd":" et ",

    "modal.addMusic":"Ajouter de la musique",
    "modal.addMusicToNamed":"Ajouter de la musique à « {name} »",
    "modal.addCountToPlaylist":"Ajouter {label} à une playlist",
    "btn.add":"Ajouter",
    "btn.added":"Ajouté",

    "info.modalTitleEmpty":"Infos du titre",
    "info.modalTitle":"Infos du titre et du fichier",
    "info.rowTitle":"Titre",
    "info.rowArtist":"Artiste",
    "info.rowAlbum":"Album",
    "info.rowTrackNo":"N° de piste",
    "info.rowDuration":"Durée",
    "info.rowFolder":"Dossier",
    "info.rowFileName":"Nom du fichier",
    "info.rowFileType":"Type de fichier",
    "info.rowFileSize":"Taille du fichier",
    "info.rowBitrate":"Débit binaire",
    "info.rowDateAdded":"Date d'ajout",
    "info.lossless":" (sans perte)",
    "common.unknown":"Inconnu",

    "edit.modalTitleEmpty":"Modifier",
    "edit.modalTitle":"Modifier le titre",
    "edit.changeCover":"Changer la pochette",
    "edit.removeCover":"Supprimer la pochette",
    "edit.autoTagFingerprint":"🎧 Identifier depuis l'audio",
    "edit.autoTagText":"🔎 Rechercher par titre/artiste",
    "edit.autoTaggingFingerprint":"Analyse de l'empreinte audio…",
    "edit.autoTaggingText":"Recherche sur MusicBrainz…",
    "edit.autoTagFoundFingerprint":"Correspondance trouvée à partir de l'audio — vérifiez puis enregistrez.",
    "edit.autoTagFoundMusicbrainz":"Correspondance trouvée par recherche titre/artiste — vérifiez puis enregistrez.",
    "edit.autoTagNotFound":"Impossible d'identifier ce morceau. {reason}",
    "edit.autoTagUnavailable":"L'identification automatique nécessite l'application de bureau et un fichier réel sur le disque.",
    "edit.autoTagPickMatch":"Ce n'est pas le bon morceau ? Choisissez un autre résultat :",
    "edit.saveChanges":"Enregistrer les modifications",
    "edit.saving":"Enregistrement…",
    "edit.savedRenamedAndUpdated":"Enregistré — le fichier sur le disque a aussi été renommé et mis à jour.",
    "edit.savedTagsButNotRenamed":"Enregistré — les tags ont été mis à jour sur le disque, mais le fichier n'a pas pu être renommé : {reason}",
    "edit.savedToLibraryOnly":"Enregistré dans votre bibliothèque. {reason}",
    "edit.savedButNotRenamed":"Enregistré dans votre bibliothèque, mais le fichier n'a pas pu être renommé : {reason}",
    "edit.savedButNoCoverArtSupport":"Enregistré — les tags ont été mis à jour sur le disque, mais ce format de fichier ne peut pas contenir de pochette intégrée.",
    "edit.fileNotChanged":"Le fichier sur le disque n'a pas été modifié.",
    "edit.couldntRenameGeneric":"Impossible de renommer le fichier sur le disque.",
    "edit.fileWriteFailed":"Le fichier sur le disque n'a pas été mis à jour. {reason} Rien n'a encore été enregistré.",
    "edit.saveLibraryOnly":"Enregistrer uniquement dans Playnck",
    "edit.savedLibraryOnlyConfirmed":"Enregistré uniquement dans Playnck — le fichier sur le disque a toujours l'ancienne métadonnée.",

    "sync.hint":"Ajustez le décalage jusqu'à ce que la ligne surlignée corresponde à ce qui est chanté. Une valeur positive retarde les paroles, une valeur négative les avance.",
    "sync.resetTo0":"Réinitialiser à 0",
    "sync.done":"Terminé",

    "settings.theme":"Thème",
    "settings.updates":"Mises à jour",
    "settings.audio":"Audio",
    "settings.player":"Lecteur",
    "settings.backup":"Sauvegarde et restauration",
    "backup.desktopOnly":"La sauvegarde et la restauration nécessitent l'application de bureau.",
    "backup.note":"Enregistre vos playlists, favoris, paroles et paramètres dans un fichier — pratique avant une réinstallation ou un changement de PC. Les morceaux sont référencés par leur emplacement de fichier enregistré, pas copiés dans la sauvegarde.",
    "backup.exportBtn":"Exporter la sauvegarde",
    "backup.importBtn":"Importer une sauvegarde",
    "backup.exporting":"Enregistrement de la sauvegarde…",
    "backup.exported":"Sauvegarde enregistrée.",
    "backup.exportedWithSkipped":"Sauvegarde enregistrée ({count} morceau(x) sans emplacement de fichier enregistré ont été ignorés).",
    "backup.exportFailed":"Impossible d'enregistrer la sauvegarde : {reason}",
    "backup.importConfirm":"Importer cette sauvegarde ? Les playlists/morceaux correspondants seront remplacés — rien d'autre n'est supprimé.",
    "backup.importing":"Restauration de la sauvegarde…",
    "backup.imported":"{restored} morceau(x) restauré(s) ({skipped} ignoré(s)).",
    "backup.importFailed":"Impossible d'importer la sauvegarde : {reason}",
    "backup.invalidFile":"Ce fichier ne semble pas être une sauvegarde Playnck.",
    "side.sleepTimer":"Minuterie de veille",
    "sleep.title":"Minuterie de veille",
    "sleep.off":"Désactivée — la lecture ne se mettra pas en pause automatiquement.",
    "sleep.activeStatus":"S'arrête dans environ {minutes} min.",
    "sleep.presetMinutes":"{minutes} min",
    "sleep.turnOff":"Désactiver",
    "sleep.note":"Met la lecture en pause une fois le temps écoulé. N'affecte ni la répétition, ni la lecture aléatoire, ni votre file d'attente — tout reprend exactement là où c'était si vous relancez la lecture.",
    "settings.language":"Langue",
    "settings.appBackground":"Arrière-plan de l'application",
    "settings.accentColor":"Couleur d'accent",
    "settings.themeNote":"Les changements s'appliquent immédiatement et durent le temps de cette session.",
    "settings.audioPlaceholder":"Les paramètres audio seront bientôt disponibles ici.",
    "audio.equalizer":"Égaliseur",
    "audio.equalizerNote":"Un égaliseur graphique à 10 bandes. Activez-le, puis utilisez un préréglage ou ajustez les bandes vous-même.",
    "audio.eqFlat":"Plat",
    "audio.eqBassBoost":"Boost graves",
    "audio.eqTrebleBoost":"Boost aigus",
    "audio.eqVocalBoost":"Boost voix",
    "audio.gapless":"Lecture sans interruption",
    "audio.gaplessNote":"Adoucit la transition entre les morceaux avec un court fondu enchaîné automatique au lieu d'une coupure nette. N'affecte pas la répétition d'un seul morceau.",
    "settings.nowPlayingBgImage":"Image d'arrière-plan de lecture en cours",
    "settings.chooseImage":"Choisir une image",
    "settings.remove":"Supprimer",
    "settings.blur":"Flou",
    "settings.playerBgNote":"Affiché derrière la pochette dans le panneau de lecture. Stocké uniquement sur cet appareil.",
    "settings.noImage":"Aucune image",

    "updates.checking":"Recherche de mises à jour…",
    "updates.foundDownloading":"Mise à jour trouvée (v{version}) — téléchargement en cours…",
    "updates.downloading":"Téléchargement de la mise à jour…",
    "updates.readyRestart":"Mise à jour prête (v{version}) — redémarrez pour l'installer",
    "updates.upToDate":"Vous êtes à jour",
    "updates.running":"Version {version} en cours d'exécution",
    "updates.couldntCheck":"Impossible de vérifier les mises à jour.",
    "updates.checkForUpdates":"Vérifier les mises à jour",
    "updates.checkingBtn":"Recherche…",
    "updates.downloadingBtn":"Téléchargement…",
    "updates.restartInstall":"Redémarrer et installer",
    "updates.tryAgain":"Réessayer",
    "updates.onlyDesktop":"Les mises à jour ne sont disponibles que dans l'application de bureau installée.",

    "language.addButton":"+ Ajouter une langue",
    "language.note":"Votre choix de langue est enregistré uniquement sur cet appareil.",
    "language.noMore":"Plus de langues à venir prochainement.",

    "about.tagline":"PLAYNCK est un lecteur de musique rapide et sans fioritures pour votre bibliothèque locale — importez vos dossiers, et profitez de la lecture, des tags, des pochettes et des paroles synchronisées. Pas de compte, pas de streaming, pas de publicité : juste les titres déjà sur votre ordinateur.",
    "about.buildVersion":"Version",
    "about.communityText":"Un bug, une idée, ou juste envie de discuter avec d'autres personnes qui utilisent PLAYNCK ? Venez faire un tour sur Telegram — c'est là que les mises à jour sont annoncées en premier, que les suggestions sont discutées, et où tout le monde s'entraide.",
    "about.telegramBtn":"Rejoindre le groupe Telegram",
    "about.supportTitle":"Soutenir Playnck ❤️",
    "about.supportText":"Vous aimez Playnck ? Si vous souhaitez soutenir le projet et son développement futur, vous pouvez envoyer un petit don via Binance Pay.",
    "about.supportQrAlt":"QR code de don Binance Pay",
    "about.supportQrCaption":"Scannez avec Binance Pay",
    "about.donateBtn":"Faire un don via Binance Pay",

    "theme.bg.dark":"GitHub Black",
    "theme.bg.light":"Clair",
    "theme.bg.pitchblack":"Pitch Black",
    "theme.bg.midnight":"Bleu nuit profond",
    "theme.bg.graphite":"Gris graphite",
    "theme.bg.forest":"Vert forêt",
    "theme.accent.blue":"Bleu",
    "theme.accent.red":"Rouge",
    "theme.accent.orange":"Orange",
    "theme.accent.green":"Vert",
    "theme.accent.purple":"Violet",
    "theme.accent.yellow":"Jaune",
    "theme.accent.pink":"Rose",
    "theme.accent.teal":"Sarcelle",
    "theme.accent.indigo":"Indigo",
    "theme.accent.cyan":"Cyan",
    "theme.accent.lime":"Citron vert",
    "theme.accent.rose":"Fuchsia"
  }
};

// Plural noun forms for the handful of "N thing(s)" strings sprinkled
// through the list/selection UI (e.g. "3 songs", "1 folder"). Kept as
// its own tiny table rather than jammed into I18N above, since a
// count needs its own singular/plural pick.
const PLURAL_WORDS={
  song:    {en:["song","songs"],         fr:["chanson","chansons"]},
  album:   {en:["album","albums"],       fr:["album","albums"]},
  artist:  {en:["artist","artists"],     fr:["artiste","artistes"]},
  playlist:{en:["playlist","playlists"], fr:["playlist","playlists"]},
  folder:  {en:["folder","folders"],     fr:["dossier","dossiers"]},
  play:    {en:["play","plays"],         fr:["écoute","écoutes"]}
};

// select-mode "kind" (track/albums/artists/playlists/folders) -> the
// PLURAL_WORDS key describing what one of those actually is.
const SELECT_TYPE_PLURAL_KEY={track:"song",albums:"album",artists:"artist",playlists:"playlist",folders:"folder"};

// Looks up a translated string for the active language, falling
// back to English (then the raw key itself) if a translation is
// somehow missing. `vars`, if given, fills in "{name}"-style
// placeholders — e.g. tr("confirm.deleteNamed",{name:"Song Title"}).
function tr(key, vars){
  const dict=I18N[state.language]||I18N.en;
  let str=(dict[key]!=null) ? dict[key] : (I18N.en[key]!=null ? I18N.en[key] : key);
  if(vars){
    Object.keys(vars).forEach(k=>{ str=str.split("{"+k+"}").join(vars[k]); });
  }
  return str;
}

function pluralForms(key){
  const table=PLURAL_WORDS[key]||PLURAL_WORDS.song;
  return table[state.language]||table.en;
}
// "N song"/"N songs" (or whatever the active language's equivalent is).
function plural(n,key){
  const f=pluralForms(key);
  return n+" "+(n===1?f[0]:f[1]);
}
// Just the bare plural word, no count — e.g. for "Select songs".
function pluralWord(key){ return pluralForms(key)[1]; }

// theme.bg.<key>/theme.accent.<key> lookups for the Settings > Theme
// swatch titles — every THEME_BG/THEME_ACCENT key has a matching
// entry in I18N above.
function themeBgLabel(key){ return tr("theme.bg."+key); }
function themeAccentLabel(key){ return tr("theme.accent."+key); }

// Repaints every static bit of UI chrome for the active language —
// nav rail, header icons, player controls, side menu, and anything
// else marked up with data-i18n(-title/-placeholder/-aria-label) in
// index.html — then refreshes the handful of dynamic bits that
// aren't tagged in the HTML because blindly overwriting them could
// clobber real state (the current track, the selection count) with
// a translated placeholder instead.
function applyI18n(){
  document.documentElement.lang=state.language;
  document.querySelectorAll("[data-i18n]").forEach(el=>{ el.textContent=tr(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-title]").forEach(el=>{ el.title=tr(el.getAttribute("data-i18n-title")); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{ el.placeholder=tr(el.getAttribute("data-i18n-placeholder")); });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(el=>{ el.setAttribute("aria-label",tr(el.getAttribute("data-i18n-aria-label"))); });

  applyNowPlayingPlaceholder();
  updateSelectionBar();
  const selectToggleEl=$("selectToggle");
  if(selectToggleEl) selectToggleEl.title=tr("header.selectPrefix")+pluralWord(SELECT_TYPE_PLURAL_KEY[state.selectType]||"song");
  const repeatBtnEl=$("repeatBtn");
  if(repeatBtnEl) repeatBtnEl.title = state.repeat==="one" ? tr("player.repeatOne") : state.repeat==="all" ? tr("player.repeatAll") : tr("player.repeat");
  const playBtnEl=$("playBtn");
  if(playBtnEl){
    const playing=!audioEl.paused && !audioEl.ended;
    playBtnEl.setAttribute("aria-label", playing ? tr("player.pause") : tr("player.play"));
  }
}

// Shows the translated "nothing playing yet" placeholder in the
// now-playing panel and mini-player — but only when nothing has
// actually been loaded, so switching languages mid-song never
// overwrites the real track title/artist on screen.
function applyNowPlayingPlaceholder(){
  if(state.currentTrack) return;
  const ttEl=$("trackTitle"), taEl=$("trackArtist"), mtEl=$("miniTitle");
  if(ttEl) ttEl.textContent=tr("player.nothingPlaying");
  if(taEl) taEl.textContent=tr("player.addSongsToStart");
  if(mtEl) mtEl.textContent=tr("player.nothingPlaying");
}

// Switches the active language, remembers it (and every language
// that's been added so far) in IndexedDB, and repaints the UI in
// place — including rebuilding the Settings modal if it's the one
// open right now, so its own labels/section headers switch right
// along with everything else.
function setLanguage(code){
  if(!LANGUAGES[code]) return;
  if(!state.installedLanguages.includes(code)) state.installedLanguages.push(code);
  state.language=code;
  saveLanguage();
  applyI18n();
  renderTab();
  if($("acc-language")) openSettingsModal();
}

// Settings > Language's "+ Add language" button: installs the next
// language from LANGUAGES that isn't already installed (today,
// that's just French) and switches to it right away. Once every
// language in LANGUAGES has been added, this quietly does nothing —
// buildLanguageBodyHTML() below swaps the button for a note instead.
function addLanguage(){
  const next=Object.keys(LANGUAGES).find(code=>!state.installedLanguages.includes(code));
  if(!next) return;
  setLanguage(next);
}

function saveLanguage(){
  idbPut("settings",{key:"language",value:{active:state.language, installed:state.installedLanguages}});
}



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



/* ================================================================
   INIT
   Runs once when the page loads: opens the database, restores
   everything that was saved last time (songs, playlists, folders),
   makes sure a "Favorites" playlist exists, then does the first
   render and wires up every button.
   ================================================================ */
init();
async function init(){
  db=await openDB();

  const [tracksRaw, playlistsRaw, foldersRaw] = await Promise.all([
    idbGetAll("tracks"), idbGetAll("playlists"), idbGetAll("folders")
  ]);

  state.folders=foldersRaw||[];
  state.playlists=playlistsRaw||[];
  state.tracks=(tracksRaw||[]).map(hydrateTrack);

  // One-time migration for libraries saved before this version:
  // older builds stored a full Blob copy of the audio in IndexedDB
  // *even for* tracks that already had a resolvable real path on
  // disk (filePath). Those no longer need the duplicate now that
  // hydrateTrack() streams path-backed tracks straight from disk
  // (see playnck-file:// in main.js) — strip fileBlob back out and
  // re-save the slimmer record so existing installs reclaim that
  // IndexedDB space too, not just new imports going forward. Wrapped
  // so a failure here (e.g. private-browsing quota weirdness) can
  // never block startup.
  (tracksRaw||[]).forEach(raw=>{
    if(raw.filePath && raw.fileBlob){
      const slim={...raw};
      delete slim.fileBlob;
      idbPut("tracks",slim).catch(()=>{});
    }
  });

  // Restore the saved theme (if any) and paint it before the first
  // render, so the UI never flashes the default theme first.
  const savedTheme=await idbGet("settings","theme");
  if(savedTheme && savedTheme.value){
    state.theme.bg=THEME_BG[savedTheme.value.bg] ? savedTheme.value.bg : state.theme.bg;
    state.theme.accent=THEME_ACCENT[savedTheme.value.accent] ? savedTheme.value.accent : state.theme.accent;
  }
  applyTheme();
  cacheThemeForNextBoot(); // keeps theme-boot.js's synchronous cache in sync with IndexedDB's authoritative value, even if the user never opens Settings this session

  // Restore the saved Player background image + blur (if any) and
  // paint it before the first render, same reasoning as the theme
  // restore just above — no flash of a bare panel then a pop-in image.
  const savedPlayerBg=await idbGet("settings","playerBg");
  if(savedPlayerBg && savedPlayerBg.value){
    state.playerBg.image=savedPlayerBg.value.image||null;
    state.playerBg.blur=typeof savedPlayerBg.value.blur==="number" ? savedPlayerBg.value.blur : 0;
  }
  applyPlayerBg();

  // Restore the saved language (and whatever other languages had
  // been added via "+ Add language") before the first render, same
  // reasoning as theme/playerBg above — no flash of the wrong
  // language before this settles in.
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

  // Restore the saved volume level + mute flag (if any), same
  // reasoning as theme/playerBg/language above — applied before the
  // first render so the slider/icon never flash the default 80%
  // then jump to whatever was saved last time.
  const savedVolume=await idbGet("settings","volume");
  if(savedVolume && savedVolume.value){
    if(typeof savedVolume.value.level==="number") state.volume=Math.min(1,Math.max(0,savedVolume.value.level));
    state.muted=!!savedVolume.value.muted;
  }
  applyVolume();

  // Settings > Audio: EQ gains/on-off and Gapless Playback's on-off,
  // same "settings" key/value store as everything else here. Just
  // restoring the plain values into state — the actual Web Audio
  // graph these feed into (ensureAudioGraph/applyEqGains, see the
  // EQUALIZER section further down) isn't built yet at this point,
  // since that only happens lazily on first real use.
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
  updateVisualizerState(); // just syncs the canvas's hidden class at this point — nothing plays yet, so the render loop itself won't start until playback does

  // Every install gets exactly one built-in "Favorites" playlist,
  // created the first time the app ever runs.
  let fav=state.playlists.find(p=>p.name==="Favorites");
  if(!fav){ fav={id:uid(),name:"Favorites",trackIds:[]}; state.playlists.unshift(fav); idbPut("playlists",fav); }
  state.favoritesId=fav.id;

  renderTab();
  bindEvents();
  updateRepeatBadge();     // make sure the repeat badge starts out correctly hidden

  // One-time migration for libraries saved before the Track Number
  // sort existed: those track records have no trackNum field at all
  // (not even null), so re-read each file's tags in the background
  // to backfill it. Fired-and-forgotten here (not awaited) so it
  // never delays startup — see backfillTrackNumbers() below.
  backfillTrackNumbers();

  // Self-heals the library against changes made outside the app
  // (files/folders moved, renamed, or deleted on disk; new songs
  // dropped into an already-added folder) — see verifyLibraryOnDisk()
  // above. Fired-and-forgotten at startup for the same reason as
  // backfillTrackNumbers() just above, then re-run periodically and
  // whenever the window regains focus (the common case: the user
  // switches to Explorer/Finder, changes something, switches back).
  // Total no-op on a plain web build (verifyLibraryOnDisk() bails
  // immediately without window.electronAPI).
  verifyLibraryOnDisk();
  setInterval(verifyLibraryOnDisk, 10*60*1000); // every 10 minutes while the app stays open
  window.addEventListener("focus", verifyLibraryOnDisk);

  // --- Settings > Updates (Electron only, total no-op elsewhere) ---
  // Grabs the running version once (for the "up to date" label) and
  // subscribes to live status pushed from main.js's autoUpdater
  // listeners. refreshUpdateUI() safely no-ops whenever the Settings
  // modal isn't currently showing the Updates section.
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



// Builds the playnck-file:// URL (see main.js) that streams a track
// straight off disk by its real path — supports seeking (range
// requests) the same as any other streamed audio URL. Electron
// only; nothing calls this unless t.filePath is already set, which
// only ever happens when resolveFilePath() succeeded.
function filePathToURL(filePath){
  return "playnck-file://local/?p="+encodeURIComponent(filePath);
}

// Turns a raw track record from IndexedDB into a "hydrated" one
// with a real, playable URL for its audio and cover art.
//   - Tracks with a known real path on disk (Electron only) stream
//     straight from disk via playnck-file:// — no Blob involved, so
//     nothing needs to be duplicated into IndexedDB for these.
//   - Everything else (plain web, or a file Electron couldn't
//     resolve a path for) falls back to a blob: URL built from the
//     stored Blob, exactly as before.
// blob: URLs are NOT saved to the database — only the underlying
// Blob is (when there is one).
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



// Best-effort lookup of a File's real absolute path on disk.
// Total no-op (returns null) outside the Electron build, so this
// is safe to call unconditionally from anywhere.
//   - Files picked via <input type=file> or drag/drop: resolved
//     through webUtils.getPathForFile(), bridged from preload.js.
//   - Files rebuilt from IPC bytes (the "Open with" flow in
//     script.js's DESKTOP OPEN WITH INTEGRATION block below):
//     webUtils can't help since that File wasn't picked from a
//     dialog, so main.js's original path is stashed directly on
//     the object as file.__electronPath before it reaches here.
function resolveFilePath(file){
  if(window.electronAPI && window.electronAPI.getPathForFile){
    const p=window.electronAPI.getPathForFile(file);
    if(p) return p;
  }
  return file.__electronPath || null;
}



// Best-effort derivation of a folder's real absolute root directory
// on disk from one of the files inside it, so it can be found again
// later (see rescanFolders()/verifyLibraryOnDisk() further down) —
// state.folders otherwise only ever knows a folder by the display
// name taken from its top path segment, which isn't enough to walk
// the real directory again.
//   file.webkitRelativePath — only set on Files that came from the
//   "Add Folder" <input webkitdirectory> picker (see the folderInput
//   handler below) — looks like "MyMusic/Rock/song.mp3", always with
//   forward slashes regardless of OS. filePath is that same file's
//   real absolute path, e.g. "C:\Users\bob\Music\MyMusic\Rock\song.mp3"
//   (Electron only — resolveFilePath() above). Stripping as many
//   trailing path components off filePath as webkitRelativePath has
//   *beyond* its first segment leaves exactly the folder's own root:
//   "C:\Users\bob\Music\MyMusic".
// Returns null for anything that didn't come from that picker (plain
// "Add Songs"/drag-drop, or a file resolveFilePath() couldn't place
// on disk at all) — those never had a real folder selection to
// derive a root from in the first place.
function deriveFolderRootPath(file, filePath){
  const rel=file.webkitRelativePath;
  if(!rel || !filePath) return null;
  const relParts=rel.split("/");                              // webkitRelativePath is always forward-slash
  const sep=filePath.includes("\\") ? "\\" : "/";           // filePath uses the OS's real separator
  const pathParts=filePath.split(sep);
  const trimCount=relParts.length-1;                           // everything in rel beyond the folder root itself
  if(trimCount<=0 || trimCount>=pathParts.length) return null;
  return pathParts.slice(0, pathParts.length-trimCount).join(sep);
}



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



/* ================================================================
   DRAG & DROP TO PLAY
   Dropping audio file(s) anywhere on the app window adds them to
   the library the same way "Add Songs" does (skipping any that are
   already there — see the duplicate guard in ingestFiles above) and
   immediately starts playing the first one, queued together with
   the rest in drop order. Purely window-level: no dedicated drop
   zone element, since the whole app should accept a drop.
   ================================================================ */
function wireDragAndDropPlay(){
  const overlay=$("dragDropOverlay");
  if(!overlay) return;

  // dragenter/dragleave both fire once per element boundary crossed,
  // including every child under the pointer — not just once for the
  // whole window. A plain depth counter is the standard fix: only
  // hide the overlay once it's back down to zero, i.e. the pointer
  // has actually left the window rather than just passed over a
  // child element on its way across it.
  let dragDepth=0;

  // Only react to an actual OS file drag (dataTransfer.types
  // includes "Files") — text/link drags from elsewhere in the page,
  // if any exist elsewhere later, are left alone.
  function isFileDrag(e){
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes("Files"));
  }

  window.addEventListener("dragenter",(e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    // The Convert tab has its own drop zone with its own visual
    // feedback (see renderConvertAddFilesSection() further down) —
    // stepping aside here (no overlay, no depth tracking) is what
    // stops this window-level handler from also firing on a file
    // dropped there and importing it into the library, which is
    // exactly what the Convert tab must never do.
    if(state.currentTab==="convert") return;
    dragDepth++;
    overlay.classList.remove("hidden");
  });

  window.addEventListener("dragover",(e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault(); // required regardless of tab — without this the browser/Electron just navigates to/opens the file itself instead of firing "drop"
  });

  window.addEventListener("dragleave",(e)=>{
    if(!isFileDrag(e)) return;
    if(state.currentTab==="convert") return;
    dragDepth=Math.max(0,dragDepth-1);
    if(dragDepth===0) overlay.classList.add("hidden");
  });

  window.addEventListener("drop", async (e)=>{
    if(!isFileDrag(e)) return;
    e.preventDefault();
    // See the dragenter comment above — the Convert tab's own drop
    // zone handles this drop entirely on its own.
    if(state.currentTab==="convert") return;
    dragDepth=0;
    overlay.classList.add("hidden");

    const files=e.dataTransfer.files;
    if(!files || !files.length) return;

    // ingestFiles() already filters down to real audio files, skips
    // anything already in the library (returning the existing track
    // instead of a duplicate), and hands back one track record per
    // dropped file in order — exactly what's needed to build a
    // queue and start playback the same way clicking a song row does.
    const tracks=await ingestFiles(files,null);
    if(tracks.length) playTrack(tracks[0], tracks);
  });
}



/* ================================================================
   FORMAT HELPERS
   Small pure functions that turn raw numbers into display strings.
   ================================================================ */

// Formats seconds as "m:ss", e.g. 65 -> "1:05".
function fmtTime(sec){
  if(!isFinite(sec)||sec<0) sec=0;
  const m=Math.floor(sec/60), s=Math.floor(sec%60);
  return m+":"+String(s).padStart(2,"0");
}



// Formats a byte count as a human-readable size, e.g. 4200000 ->
// "4.0 MB". Used by the new Info modal to show a track's file size.
function formatBytes(bytes){
  if(bytes===null || bytes===undefined) return "Unknown";
  if(bytes<1024) return bytes+" B";
  const units=["KB","MB","GB"];
  let val=bytes, i=-1;
  do{ val/=1024; i++; }while(val>=1024 && i<units.length-1);
  return val.toFixed(1)+" "+units[i];
}



// Estimates a simple average bitrate from file size and duration,
// e.g. a 4MB file that's 2 minutes long -> "273 kb/s". This is an
// approximation (file size includes container/tag overhead), which
// is why it's labeled as an average rather than an exact figure.
function formatBitrate(bytes, seconds){
  if(!bytes || !seconds || !isFinite(seconds) || seconds<=0) return "Unknown";
  const kbps=Math.round((bytes*8)/seconds/1000);
  return kbps+" kb/s";
}



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




/* ================================================================
   RENDER
   Everything involved in drawing the sidebar's list area. renderTab()
   is the single entry point — it looks at state.currentTab (or
   state.filter, if the user has drilled into an album/artist/
   playlist/folder) and delegates to the right render* function.
   ================================================================ */

// Tiny helper for building a DOM element with a class and
// (optionally) some inner HTML in one line, used everywhere below
// instead of the more verbose createElement/className/innerHTML
// dance.
function el(tag,cls,html){ const e=document.createElement(tag); if(cls)e.className=cls; if(html!==undefined)e.innerHTML=html; return e; }

// Replays a composited enter animation without changing an element's
// resting appearance. Kept separate from the Play/Pause morph on purpose.
function replayMotion(element,className="motion-in",duration=320){
  if(!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove(className);
  requestAnimationFrame(()=>{
    element.classList.add(className);
    setTimeout(()=>element.classList.remove(className),duration);
  });
}

// Shared tactile "press" feedback for the transport row (shuffle/
// prev/next/repeat, desktop + mini-player) — a soft accent ripple
// behind the icon, plus an optional per-button flourish class on the
// icon itself (e.g. "skip-kick", "shuffle-spin"). Deliberately never
// called on #playBtn, which keeps its own liquid-glass morph as-is.
// Shared tactile "press" feedback for the transport row (shuffle/
// prev/next/repeat, desktop + mini-player) — a ripple behind the
// icon (circular by default, or "ctrl-streak" for a directional
// glow that shoots toward the skip direction on Prev/Next), plus an
// optional per-button flourish class on the icon itself (e.g.
// "skip-kick", "shuffle-spin", "repeat-flip"). Deliberately never
// called on #playBtn, which keeps its own liquid-glass morph as-is.
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

// Wraps fn so rapid repeated calls (e.g. every keystroke) only run it
// once, ms after the last call — used to keep fast typing from
// triggering a full list rebuild on every single character.
function debounce(fn,ms){
  let handle=null;
  return (...args)=>{
    clearTimeout(handle);
    handle=setTimeout(()=>fn(...args),ms);
  };
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
    listTitle.textContent=tr("nav.playlists");
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
    existingRow.scrollIntoView({block:"center",behavior:"smooth"});
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



// Draws the Playlists tab: a "+ New Playlist" button followed by
// one row per existing playlist (Favorites is always first, since
// it's unshifted onto state.playlists in init()). In select mode
// every playlist except the built-in Favorites gets a checkbox —
// Favorites can't be deleted so it's excluded from bulk selection
// too, and stays tap-to-open even while selecting.
function renderPlaylistList(){
  const btn=el("button","new-playlist-btn",tr("playlists.newPlaylist"));
  // NOTE: wrapped in an arrow function rather than passed directly
  // (`btn.addEventListener("click",createPlaylistPrompt)`) — passed
  // directly, the click's native Event object becomes
  // createPlaylistPrompt's trackIdToAdd argument (addEventListener
  // always calls its handler with the event as the first argument),
  // which is truthy and so gets pushed into the new playlist's
  // trackIds. That Event object can't be saved to IndexedDB (it's
  // not structured-cloneable), so the playlist would render fine in
  // this session but silently fail to persist — gone on next launch.
  btn.addEventListener("click",()=>createPlaylistPrompt());
  listContainer.appendChild(btn);
  state.playlists.forEach(p=>{
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
    // The built-in Favorites playlist can't be renamed or
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
    listContainer.appendChild(line);
  });
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



/* ================================================================
   FOLDERS — RENAME / DELETE / FORGET
   The "⋮" menu on each folder row, plus the three actions it
   offers. "Delete" and "Forget" both remove the folder AND every
   song inside it — "Forget" is kept as a second, identically-
   behaving entry point to the same cleanup (see forgetFolder()
   below), while "Delete" remains as-is.
   ================================================================ */

// Opens the "⋮" menu for a single folder row. Reuses the same
// shared ".ctx-menu" popup style/behavior as the track and
// playlist menus above.
function openFolderMenu(e,folder){
  closeMenu();
  const menu=el("div","ctx-menu");

  const renameBtn=el("button","",tr("folder.rename"));
  renameBtn.addEventListener("click",()=>{ closeMenu(); renameFolder(folder); });
  menu.appendChild(renameBtn);

  const forgetBtn=el("button","",tr("folder.forget"));
  forgetBtn.addEventListener("click",()=>{ closeMenu(); forgetFolder(folder); });
  menu.appendChild(forgetBtn);

  menu.appendChild(el("div","divider"));

  const delBtn=el("button","danger",tr("folder.delete"));
  delBtn.addEventListener("click",()=>{ closeMenu(); deleteFolder(folder); });
  menu.appendChild(delBtn);

  document.body.appendChild(menu);
  replayMotion(menu);
  const rect=e.currentTarget.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.right-170;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";
  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



// Prompts for a new name and renames the folder in place.
async function renameFolder(folder){
  const name=await promptModal(tr("prompt.renameFolderTitle"),tr("prompt.folderNameLabel"),folder.name);
  if(!name) return;
  folder.name=name;
  idbPut("folders",folder);
  renderTab();
}



// "Forgets" a folder: removes the folder entry itself AND every
// song that was inside it — same cleanup as deleteFolder() below
// (reuses removeTrackData() so playlists, queue, playback, blob
// URLs, and IndexedDB all stay in sync). Kept as a separate
// function/menu entry from "Delete folder" even though the
// behavior is now identical.
function forgetFolder(folder){
  const tracksInFolder=state.tracks.filter(t=>t.folderId===folder.id);
  const label=tracksInFolder.length ? tr("and its")+plural(tracksInFolder.length,"song") : "";
  if(!confirm(tr("confirm.forgetNamed",{name:folder.name,label}))) return;

  tracksInFolder.forEach(t=>removeTrackData(t));

  state.folders=state.folders.filter(f=>f.id!==folder.id);
  idbDelete("folders",folder.id);

  if(state.filter && state.filter.type==="folder"){
    state.filter.tracks=state.filter.tracks.filter(t=>t.folderId!==folder.id);
  }
  renderTab();
}



// Permanently deletes a folder AND every song inside it — reuses
// removeTrackData() (defined up in the PLAYLISTS section) for each
// track so the cleanup (playlists, queue, playback, blob URLs,
// IndexedDB) stays identical to deleting a single song one at a
// time from the Songs tab.
function deleteFolder(folder){
  const tracksInFolder=state.tracks.filter(t=>t.folderId===folder.id);
  const label=tracksInFolder.length ? tr("and its")+plural(tracksInFolder.length,"song") : "";
  if(!confirm(tr("confirm.deleteNamedWithLabel",{name:folder.name,label}))) return;

  notifyTracksDeleted(tracksInFolder);
  tracksInFolder.forEach(t=>removeTrackData(t));

  state.folders=state.folders.filter(f=>f.id!==folder.id);
  idbDelete("folders",folder.id);

  if(state.filter && state.filter.type==="folder"){
    state.filter.tracks=state.filter.tracks.filter(t=>t.folderId!==folder.id);
  }
  renderTab();
}



// A generic placeholder cover-art image (a simple circle icon),
// shown whenever a track/album/artist has no real artwork.
function fallbackArt(){
  return "data:image/svg+xml;utf8,"+encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='#1c1c25'/><circle cx='50' cy='50' r='18' fill='none' stroke='#5c5c66' stroke-width='2'/></svg>"
  );
}



/* ================================================================
   CONVERT TAB
   A bulk audio-conversion workspace powered by a real, locally
   installed FFmpeg — entirely separate from the music library:
   nothing added here ever touches state.tracks, libraryTracks(), or
   the "tracks" IndexedDB store. See ffmpeg-bridge.js (main process)
   for FFmpeg detection/one-click install/the actual conversion
   work; everything below is the UI plus a simple sequential queue
   runner (the "Conversion Manager" from the spec) that calls it one
   file at a time — see startConversion() further down.

   state.convert (see APP STATE above) holds everything: FFmpeg
   readiness, the queued files and their statuses, the chosen
   format/quality settings, the output folder + collision mode, and
   the most recent run's summary. It's plain renderer state, never
   written to IndexedDB, so closing and reopening Playnck always
   starts this tab fresh — exactly right for what's meant to be a
   one-off workspace, not a saved project.
   ================================================================ */

// Mirrors ffmpeg-bridge.js's FORMAT_INFO (main process) — kept as a
// small static duplicate here rather than an extra IPC round trip
// for data that never changes at runtime. If a format's behavior
// changes in one place, it needs the same change in the other.
const CONVERT_FORMATS={
  mp3:  {ext:"mp3",  label:"MP3"},
  aac:  {ext:"m4a",  label:"AAC"},
  flac: {ext:"flac", label:"FLAC", lossless:true},
  wav:  {ext:"wav",  label:"WAV",  lossless:true},
  alac: {ext:"m4a",  label:"ALAC", lossless:true},
  opus: {ext:"opus", label:"Opus"}
};
const CONVERT_FORMAT_ORDER=["mp3","aac","flac","wav","alac","opus"];
const CONVERT_BITRATES={
  mp3:  [128,160,192,224,256,320],
  aac:  [128,160,192,224,256,320],
  opus: [96,128,160,192,256]
};

let convertFFmpegCheckInFlight=false;
let convertOutputFolderFetchInFlight=false;

// Entry point — called from renderTab() every time the Convert tab
// is (re)drawn (switching to it, adding/removing a file, changing a
// setting, a run finishing, etc. — see the many renderTab() calls
// sprinkled through the functions below).
function renderConvertTab(){
  const wrap=el("div","convert-view");
  listContainer.appendChild(wrap);

  // FFmpeg conversion needs a real child process — there's no
  // meaningful version of this tab in a plain browser tab. Mirrors
  // how the Backup/Auto-Tag features already tell the person this is
  // a desktop-app-only feature rather than silently doing nothing.
  if(!window.electronAPI){
    wrap.appendChild(el("div","empty-state",escapeHTML(tr("convert.desktopOnly"))));
    return;
  }

  const c=state.convert;

  // First time this tab has ever been opened this session — kick off
  // the "is FFmpeg actually runnable" check described in the spec.
  // checkFFmpegStatus() re-renders itself once it has an answer (if
  // this is still the active tab by then), so nothing more happens
  // here on this pass.
  if(c.ffmpegStatus==="unknown"){
    c.ffmpegStatus="checking";
    checkFFmpegStatus();
  }

  if(c.ffmpegStatus!=="ready"){
    renderConvertFFmpegSetup(wrap, c.ffmpegStatus);
    return;
  }

  // FFmpeg is confirmed ready. Fill in a sensible default output
  // folder the first time that becomes true this session (see
  // get-default-convert-output in main.js) — after this, whatever the
  // person actually chooses via "Choose Folder" sticks for the rest
  // of the session.
  if(!c.outputFolder && !convertOutputFolderFetchInFlight){
    convertOutputFolderFetchInFlight=true;
    window.electronAPI.getDefaultConvertOutput().then(dir=>{
      convertOutputFolderFetchInFlight=false;
      c.outputFolder=dir;
      if(state.currentTab==="convert") renderTab();
    });
  }

  renderConvertReadyBanner(wrap);

  // The completion banner sits ABOVE the queue rather than replacing
  // it — every file's final status is still right there in the list
  // below (see req #13, "the user should be able to see which files
  // succeeded and which failed"), this is just the at-a-glance summary
  // plus the one-click "Open Output Folder".
  if(c.lastRunSummary && !c.isConverting) renderConvertCompletionBanner(wrap);

  renderConvertAddFilesSection(wrap);
  renderConvertQueueSection(wrap);
  if(c.queue.length){
    renderConvertSettingsSection(wrap);
    renderConvertOutputSection(wrap);
  }
  if(c.isConverting) renderConvertProgressSection(wrap);
  if(c.queue.length) renderConvertControlsRow(wrap);
}



// The very first question this tab asks, every time it's opened —
// runs ffmpeg -version for real (see detectFFmpeg() in
// ffmpeg-bridge.js) rather than assuming anything from a file just
// existing somewhere.
async function checkFFmpegStatus(){
  if(convertFFmpegCheckInFlight) return;
  convertFFmpegCheckInFlight=true;
  const c=state.convert;
  try{
    const result=await window.electronAPI.ffmpegDetect();
    c.ffmpegStatus = result && result.available ? "ready" : "missing";
    c.ffmpegVersion = (result && result.version) || null;
  } catch(e){
    console.warn("ffmpegDetect failed:",e);
    c.ffmpegStatus="missing";
  }
  convertFFmpegCheckInFlight=false;
  if(state.currentTab==="convert") renderTab();
}



// "Install FFmpeg" button — see installFFmpeg() in ffmpeg-bridge.js
// for what actually happens (winget, Windows-only). Real status
// lines stream in via onFFmpegInstallProgress (wired once, near the
// bottom of this file) straight into state.convert.installLog while
// this runs, instead of a fake progress percentage.
async function startFFmpegInstall(){
  const c=state.convert;
  c.ffmpegStatus="installing";
  c.installLog=[];
  c.installError=null;
  renderTab();

  const result=await window.electronAPI.ffmpegInstall();
  if(result && result.success){
    c.ffmpegStatus="ready";
    c.ffmpegVersion=result.version || c.ffmpegVersion;
  } else {
    c.ffmpegStatus="install-failed";
    c.installError=(result && result.reason) || null;
  }
  if(state.currentTab==="convert") renderTab();
}



// ----------------------------------------------------------------
// FFMPEG STATUS UI (checking / missing / installing / install-failed)
// ----------------------------------------------------------------

const CONVERT_WRENCH_ICON="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'/></svg>";

function renderConvertFFmpegSetup(wrap, mode){
  const section=el("div","convert-section convert-setup");

  if(mode==="checking"){
    const dot=el("div","convert-ffmpeg-dot");
    dot.dataset.state="checking";
    section.appendChild(dot);
    section.appendChild(el("p","",escapeHTML(tr("convert.checkingFFmpeg"))));
    wrap.appendChild(section);
    return;
  }

  section.appendChild(el("div","",CONVERT_WRENCH_ICON));

  if(mode==="installing"){
    section.appendChild(el("h3","",escapeHTML(tr("convert.installing"))));
    const log=el("div","convert-install-log");
    log.id="convertInstallLog";
    state.convert.installLog.forEach(line=>log.appendChild(el("div","",escapeHTML(line))));
    section.appendChild(log);
    wrap.appendChild(section);
    // Keep the log scrolled to the newest line.
    log.scrollTop=log.scrollHeight;
    return;
  }

  if(mode==="install-failed"){
    section.appendChild(el("h3","",escapeHTML(tr("convert.installFailed"))));
    if(state.convert.installError){
      section.appendChild(el("div","convert-install-error",escapeHTML(state.convert.installError)));
    }
    const retryBtn=el("button","amr-add-btn",escapeHTML(tr("convert.tryAgain")));
    retryBtn.addEventListener("click",startFFmpegInstall);
    section.appendChild(retryBtn);
    section.appendChild(el("p","",escapeHTML(tr("convert.installManually"))));
    wrap.appendChild(section);
    return;
  }

  // mode==="missing"
  section.appendChild(el("h3","",escapeHTML(tr("convert.ffmpegRequired"))));
  section.appendChild(el("p","",escapeHTML(tr("convert.ffmpegRequiredNote"))));
  const installBtn=el("button","edit-save-btn",escapeHTML(tr("convert.installFFmpeg")));
  installBtn.addEventListener("click",startFFmpegInstall);
  section.appendChild(installBtn);
  wrap.appendChild(section);
}



// Small "FFmpeg Ready • vX.X.X" strip shown above the workspace once
// it's confirmed available — deliberately subtle (no card/border),
// per the spec's "should be subtle and fit the Playnck UI".
function renderConvertReadyBanner(wrap){
  const banner=el("div","convert-ffmpeg-banner is-ready");
  const left=el("div","convert-ffmpeg-ready-text");
  const dot=el("span","convert-ffmpeg-dot");
  dot.dataset.state="ready";
  left.appendChild(dot);
  left.appendChild(el("b","",escapeHTML(tr("convert.ffmpegReady"))));
  if(state.convert.ffmpegVersion) left.appendChild(el("span","",escapeHTML("v"+state.convert.ffmpegVersion)));
  banner.appendChild(left);
  wrap.appendChild(banner);
}



// ----------------------------------------------------------------
// ADD FILES — drag & drop zone + Browse Files + Add Folder
// ----------------------------------------------------------------

function renderConvertAddFilesSection(wrap){
  const section=el("div","convert-section");
  section.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.addFiles"))));

  const zone=el("div","convert-dropzone");
  zone.appendChild(el("div","","<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 16V4'/><path d='M7 9l5-5 5 5'/><path d='M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'/></svg>"));
  zone.appendChild(el("p","",escapeHTML(tr("convert.dropHere"))));
  zone.appendChild(el("span","convert-or",escapeHTML(tr("convert.or"))));
  const browseBtn=el("button","amr-add-btn",escapeHTML(tr("convert.browseFiles")));
  zone.appendChild(browseBtn);

  const openPicker=(e)=>{ if(e) e.stopPropagation(); $("convertFilesInput").click(); };
  browseBtn.addEventListener("click",openPicker);
  zone.addEventListener("click",openPicker);

  // Local to this drop zone only — see the note on wireDragAndDropPlay()
  // further up for how the window-level "drop to play" handler steps
  // aside entirely while state.currentTab==="convert", so a file
  // dropped here is never also imported into the library.
  zone.addEventListener("dragover",(e)=>{ e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave",()=>zone.classList.remove("drag-over"));
  zone.addEventListener("drop",(e)=>{
    e.preventDefault();
    zone.classList.remove("drag-over");
    if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
      addFilesToConvertQueue(e.dataTransfer.files);
    }
  });

  section.appendChild(zone);

  const addRow=el("div","convert-add-row");
  const addFolderBtn=el("button","amr-add-btn",`<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'/></svg> ${escapeHTML(tr("convert.addFolder"))}`);
  addFolderBtn.addEventListener("click",addFolderToConvertQueue);
  addRow.appendChild(addFolderBtn);
  section.appendChild(addRow);

  wrap.appendChild(section);
}



// Turns picked/dropped File objects into queue entries. Reuses
// resolveFilePath() (see FILE/METADATA HANDLING above) for a real
// absolute path — FFmpeg needs an actual file on disk, not a blob:
// URL — and getAudioMetadata() (the same IPC the library's Info
// panel and tag-backfill already use) purely for display (duration/
// size/title/artist in the queue row below); nothing here ever
// touches state.tracks or "tracks" in IndexedDB.
async function addFilesToConvertQueue(fileList){
  const c=state.convert;
  const files=Array.from(fileList).filter(f=>{
    const ext=f.name.split(".").pop().toLowerCase();
    return AUDIO_EXT.includes(ext) || f.type.startsWith("audio/");
  });

  let added=0;
  for(const file of files){
    const filePath=resolveFilePath(file);
    if(!filePath){
      console.warn("Convert: couldn't resolve a real path for",file.name,"— skipping.");
      continue;
    }
    if(c.queue.some(q=>q.path===filePath)) continue; // already queued — see req #5/#7-equivalent, "avoid duplicate entries"
    let meta=null;
    try{ meta=await window.electronAPI.getAudioMetadata(filePath); } catch(e){ /* fine — the row just shows less detail */ }
    const ext=filePath.split(".").pop().toLowerCase();
    c.queue.push({
      id:uid(),
      path:filePath,
      name:file.name.replace(/\.[^.]+$/,""),
      ext,
      sizeBytes:(meta && meta.fileSize!=null) ? meta.fileSize : (file.size||null),
      duration:(meta && meta.duration) || 0,
      title:(meta && meta.title) || null,
      artist:(meta && meta.artist) || null,
      status:"waiting", progressPercent:0, error:null, outputPath:null
    });
    added++;
  }
  if(added && state.currentTab==="convert") renderTab();
}



// "Add Folder" — a native folder picker (see select-folder in
// main.js) paired with the exact same scan-folder IPC handler the
// library's own "Add Folder" already uses to enumerate every audio
// file inside it, rather than the webkitdirectory <input> trick the
// library uses (which can't resolve a path at all for an empty
// folder — no good for a picker that also has to work as the
// *output* folder chooser below).
async function addFolderToConvertQueue(){
  const dir=await window.electronAPI.selectFolder();
  if(!dir) return;
  const paths=await window.electronAPI.scanFolder(dir);
  if(!paths || !paths.length){
    openModal(tr("convert.addFolder"), `<p class="info-empty">${escapeHTML(tr("convert.noNewFiles"))}</p>`);
    return;
  }

  const c=state.convert;
  let added=0;
  for(const filePath of paths){
    if(c.queue.some(q=>q.path===filePath)) continue;
    let meta=null;
    try{ meta=await window.electronAPI.getAudioMetadata(filePath); } catch(e){ /* fine */ }
    const ext=filePath.split(".").pop().toLowerCase();
    const base=filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/,"");
    c.queue.push({
      id:uid(), path:filePath, name:base, ext,
      sizeBytes:(meta && meta.fileSize!=null) ? meta.fileSize : null,
      duration:(meta && meta.duration) || 0,
      title:(meta && meta.title) || null,
      artist:(meta && meta.artist) || null,
      status:"waiting", progressPercent:0, error:null, outputPath:null
    });
    added++;
  }
  if(added && state.currentTab==="convert") renderTab();
}



// ----------------------------------------------------------------
// CONVERSION QUEUE
// ----------------------------------------------------------------

const CONVERT_QUEUE_ICON="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/></svg>";
const CONVERT_REMOVE_ICON="<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><path d='M18 6 6 18'/><path d='M6 6l12 12'/></svg>";

function renderConvertQueueSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section");

  const header=el("div","convert-queue-header");
  header.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.queueTitle"))));
  if(c.queue.length && !c.isConverting){
    const clearBtn=el("button","edit-cancel-btn",escapeHTML(tr("convert.clearQueue")));
    clearBtn.addEventListener("click",clearConvertQueue);
    header.appendChild(clearBtn);
  }
  section.appendChild(header);

  if(!c.queue.length){
    section.appendChild(el("div","empty-state",escapeHTML(tr("convert.queueEmpty"))));
    wrap.appendChild(section);
    return;
  }

  const list=el("div","convert-queue-list");
  list.id="convertQueueList";
  c.queue.forEach(item=>list.appendChild(buildConvertQueueRow(item)));
  section.appendChild(list);
  wrap.appendChild(section);
}



function buildConvertQueueRow(item){
  const row=el("div","convert-queue-row status-"+item.status);
  row.dataset.jobRowId=item.id; // lets updateConvertRowProgress() find this row later without a full re-render

  row.appendChild(el("div","convert-queue-icon",CONVERT_QUEUE_ICON));

  const info=el("div","convert-queue-info");
  const displayTitle=item.title || item.name;
  const displaySub=[item.ext.toUpperCase(), item.artist, formatBytes(item.sizeBytes), fmtTime(item.duration)].filter(Boolean).join(" • ");
  info.appendChild(el("div","convert-queue-title",escapeHTML(displayTitle)));
  info.appendChild(el("div","convert-queue-sub",escapeHTML(displaySub)));
  if(item.status==="converting"){
    const bar=el("div","convert-queue-row-progress");
    const fill=el("div","convert-queue-row-progress-fill");
    fill.style.width=(item.progressPercent||0)+"%";
    bar.appendChild(fill);
    info.appendChild(bar);
  }
  if(item.status==="failed" && item.error){
    info.appendChild(el("div","convert-queue-row-error",escapeHTML(item.error)));
  }
  row.appendChild(info);

  const status=el("span","convert-queue-status",escapeHTML(tr("convert.status."+item.status)));
  status.dataset.status=item.status;
  row.appendChild(status);

  if(item.status==="waiting" || item.status==="failed" || item.status==="skipped" || item.status==="cancelled"){
    const removeBtn=el("button","convert-queue-remove",CONVERT_REMOVE_ICON);
    removeBtn.title=tr("convert.removeFile");
    removeBtn.addEventListener("click",()=>removeFromConvertQueue(item.id));
    row.appendChild(removeBtn);
  }

  return row;
}



function removeFromConvertQueue(id){
  const c=state.convert;
  c.queue=c.queue.filter(q=>q.id!==id);
  renderTab();
}



function clearConvertQueue(){
  const c=state.convert;
  c.queue=[];
  c.lastRunSummary=null;
  c.overallDone=0;
  c.overallTotal=0;
  renderTab();
}



// ----------------------------------------------------------------
// CONVERSION SETTINGS — output format + the quality control that
// actually applies to whichever format is currently selected
// ----------------------------------------------------------------

function renderConvertSettingsSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section");
  section.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.settingsTitle"))));

  const grid=el("div","convert-settings-grid");

  // --- Output Format ---
  const formatBlock=el("div","");
  formatBlock.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.outputFormat"))));
  const formatRow=el("div","convert-chip-row");
  CONVERT_FORMAT_ORDER.forEach(fmt=>{
    const info=CONVERT_FORMATS[fmt];
    const chip=el("button","lang-chip"+(c.format===fmt?" active":""),escapeHTML(info.label));
    chip.type="button";
    chip.addEventListener("click",()=>{ c.format=fmt; renderTab(); });
    formatRow.appendChild(chip);
  });
  formatBlock.appendChild(formatRow);
  grid.appendChild(formatBlock);

  // --- Quality (shape depends entirely on the selected format —
  // bitrate for lossy formats, compression level for FLAC, bit depth
  // for WAV, nothing at all for ALAC, which has no knob worth
  // exposing at this level of simplicity). ---
  const info=CONVERT_FORMATS[c.format];
  if(info.lossless && c.format!=="flac" && c.format!=="wav"){
    // ALAC
    grid.appendChild(el("p","convert-lossless-note",escapeHTML(tr("convert.losslessNote"))));
  } else if(c.format==="flac"){
    const block=el("div","");
    block.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.flacCompression"))));
    const row=el("div","convert-chip-row");
    for(let level=0;level<=8;level++){
      const chip=el("button","lang-chip"+(c.settings.flac.compressionLevel===level?" active":""),String(level));
      chip.type="button";
      chip.addEventListener("click",()=>{ c.settings.flac.compressionLevel=level; renderTab(); });
      row.appendChild(chip);
    }
    block.appendChild(row);
    block.appendChild(el("p","convert-lossless-note",escapeHTML(tr("convert.flacCompressionNote"))));
    grid.appendChild(block);
  } else if(c.format==="wav"){
    const block=el("div","");
    block.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.bitDepth"))));
    const row=el("div","convert-chip-row");
    [16,24].forEach(depth=>{
      const chip=el("button","lang-chip"+(c.settings.wav.bitDepth===depth?" active":""),depth+"-bit");
      chip.type="button";
      chip.addEventListener("click",()=>{ c.settings.wav.bitDepth=depth; renderTab(); });
      row.appendChild(chip);
    });
    block.appendChild(row);
    grid.appendChild(block);
  } else {
    // mp3 / aac / opus — bitrate
    const block=el("div","");
    block.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.bitrate"))));
    const row=el("div","convert-chip-row");
    CONVERT_BITRATES[c.format].forEach(kbps=>{
      const chip=el("button","lang-chip"+(c.settings[c.format].bitrateKbps===kbps?" active":""),kbps+" kbps");
      chip.type="button";
      chip.addEventListener("click",()=>{ c.settings[c.format].bitrateKbps=kbps; renderTab(); });
      row.appendChild(chip);
    });
    block.appendChild(row);
    grid.appendChild(block);
  }

  section.appendChild(grid);
  wrap.appendChild(section);
}



// ----------------------------------------------------------------
// OUTPUT — destination folder + what to do about a name collision
// ----------------------------------------------------------------

function renderConvertOutputSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section");
  section.appendChild(el("div","theme-group-label",escapeHTML(tr("convert.outputTitle"))));

  section.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.outputFolder"))));
  const pathRow=el("div","convert-output-path-row");
  pathRow.appendChild(el("div","convert-output-path",escapeHTML(c.outputFolder||"")));
  const chooseBtn=el("button","amr-add-btn",escapeHTML(tr("convert.chooseFolder")));
  chooseBtn.addEventListener("click",chooseConvertOutputFolder);
  pathRow.appendChild(chooseBtn);
  section.appendChild(pathRow);

  const collisionBlock=el("div","convert-collision-row");
  collisionBlock.appendChild(el("div","convert-field-label",escapeHTML(tr("convert.ifFileExists"))));
  const collisionRow=el("div","convert-chip-row");
  [["rename","convert.collision.rename"],["replace","convert.collision.replace"],["skip","convert.collision.skip"]].forEach(([mode,key])=>{
    const chip=el("button","lang-chip"+(c.collisionMode===mode?" active":""),escapeHTML(tr(key)));
    chip.type="button";
    chip.addEventListener("click",()=>{ c.collisionMode=mode; renderTab(); });
    collisionRow.appendChild(chip);
  });
  collisionBlock.appendChild(collisionRow);
  section.appendChild(collisionBlock);

  wrap.appendChild(section);
}



async function chooseConvertOutputFolder(){
  const dir=await window.electronAPI.selectFolder(state.convert.outputFolder||undefined);
  if(!dir) return;
  state.convert.outputFolder=dir;
  renderTab();
}



// ----------------------------------------------------------------
// PROGRESS — current file + overall, two independent bars
// ----------------------------------------------------------------

function renderConvertProgressSection(wrap){
  const c=state.convert;
  const section=el("div","convert-section convert-progress-block");

  const current=c.queue.find(q=>q.id===c.currentJobId);

  const currentBlock=el("div","");
  const currentLabelRow=el("div","convert-progress-label-row");
  currentLabelRow.id="convertCurrentLabelRow";
  currentLabelRow.appendChild(el("span","",escapeHTML(tr("convert.currentFile")+(current?": "+(current.title||current.name):""))));
  currentLabelRow.appendChild(el("span","","0%"));
  currentBlock.appendChild(currentLabelRow);
  const currentTrack=el("div","convert-progress-track");
  const currentFill=el("div","convert-progress-fill");
  currentFill.id="convertCurrentFill";
  currentFill.style.width=(current ? (current.progressPercent||0) : 0)+"%";
  currentTrack.appendChild(currentFill);
  currentBlock.appendChild(currentTrack);
  section.appendChild(currentBlock);

  const overallBlock=el("div","");
  const overallLabelRow=el("div","convert-progress-label-row");
  overallLabelRow.id="convertOverallLabelRow";
  overallLabelRow.appendChild(el("span","",escapeHTML(tr("convert.overallProgress"))));
  overallLabelRow.appendChild(el("span","",escapeHTML(tr("convert.filesOf",{done:c.overallDone,total:c.overallTotal}))));
  overallBlock.appendChild(overallLabelRow);
  const overallTrack=el("div","convert-progress-track");
  const overallFill=el("div","convert-progress-fill");
  overallFill.id="convertOverallFill";
  const overallPct=c.overallTotal ? (c.overallDone/c.overallTotal)*100 : 0;
  overallFill.style.width=overallPct+"%";
  overallTrack.appendChild(overallFill);
  overallBlock.appendChild(overallTrack);
  section.appendChild(overallBlock);

  wrap.appendChild(section);
}



// ----------------------------------------------------------------
// CONTROLS — Start / Cancel
// ----------------------------------------------------------------

function renderConvertControlsRow(wrap){
  const c=state.convert;
  const row=el("div","convert-controls-row");

  if(c.isConverting){
    const cancelBtn=el("button","edit-cancel-btn",escapeHTML(tr("convert.cancel")));
    cancelBtn.addEventListener("click",cancelConversion);
    row.appendChild(cancelBtn);
  } else {
    const startBtn=el("button","edit-save-btn",escapeHTML(tr("convert.startConversion")));
    const hasWaiting=c.queue.some(q=>q.status==="waiting");
    if(!hasWaiting || !c.outputFolder) startBtn.disabled=true;
    startBtn.addEventListener("click",startConversion);
    row.appendChild(startBtn);
  }

  wrap.appendChild(row);
}



// ----------------------------------------------------------------
// COMPLETION
// ----------------------------------------------------------------

function renderConvertCompletionBanner(wrap){
  const summary=state.convert.lastRunSummary;
  const section=el("div","convert-section convert-complete");
  section.appendChild(el("div","convert-complete-icon","<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6 9 17l-5-5'/></svg>"));
  section.appendChild(el("h3","",escapeHTML(tr("convert.completeTitle"))));

  let summaryText=tr("convert.completeSummary",{count:summary.succeeded});
  if(summary.failed) summaryText+=tr("convert.completeSummaryFailed",{count:summary.failed});
  if(summary.skipped) summaryText+=tr("convert.completeSummarySkipped",{count:summary.skipped});
  section.appendChild(el("p","",escapeHTML(summaryText)));
  section.appendChild(el("div","convert-complete-path",escapeHTML(tr("convert.outputLocation",{path:summary.outputFolder}))));

  const actions=el("div","convert-complete-actions");
  const openBtn=el("button","amr-add-btn",escapeHTML(tr("convert.openOutputFolder")));
  openBtn.addEventListener("click",()=>window.electronAPI.openFolder(summary.outputFolder));
  actions.appendChild(openBtn);
  const dismissBtn=el("button","edit-cancel-btn",escapeHTML(tr("convert.startNewBatch")));
  dismissBtn.addEventListener("click",()=>{ state.convert.lastRunSummary=null; renderTab(); });
  actions.appendChild(dismissBtn);
  section.appendChild(actions);

  wrap.appendChild(section);
}



// ----------------------------------------------------------------
// THE CONVERSION MANAGER — a plain sequential queue runner. Every
// file is sent to FFmpeg one at a time (see req #17 — "a sequential
// queue is perfectly acceptable for the first implementation"); the
// per-file heavy lifting is entirely convertFile() in
// ffmpeg-bridge.js. This just walks the queue, updates each item's
// status, and keeps the two progress bars current.
// ----------------------------------------------------------------

async function startConversion(){
  const c=state.convert;
  if(c.isConverting) return;
  const pending=c.queue.filter(q=>q.status==="waiting");
  if(!pending.length || !c.outputFolder) return;

  c.isConverting=true;
  c.overallDone=0;
  c.overallTotal=pending.length;
  c.lastRunSummary=null;
  renderTab();

  let succeeded=0, failed=0, skipped=0;

  for(const item of pending){
    // Cancel button flips isConverting straight back to false — bail
    // out of the loop the moment that happens rather than starting
    // another file.
    if(!state.convert.isConverting) break;

    // A still-"waiting" item's remove button stays active even
    // mid-run (see buildConvertQueueRow) — if the person used it on
    // something further down this exact list, honor that as "don't
    // convert this one after all" instead of silently converting it
    // anyway once its turn comes up. overallDone still advances
    // either way, below, outside this if — so the Overall Progress
    // bar still reaches 100% by the time the run ends instead of
    // stalling short of it just because a removed item was never
    // counted.
    if(c.queue.includes(item)){
      item.status="converting";
      item.progressPercent=0;
      c.currentJobId=item.id;
      if(state.currentTab==="convert") renderTab();

      const resolved=await window.electronAPI.convertResolveOutputPath(
        c.outputFolder, item.name, CONVERT_FORMATS[c.format].ext, c.collisionMode
      );

      if(resolved.skip){
        item.status="skipped";
        skipped++;
      } else {
        const jobId=item.id; // reuse the queue item's own id as the FFmpeg job id — already unique, one job per item
        const result=await window.electronAPI.convertFile({
          jobId,
          inputPath:item.path,
          outputPath:resolved.path,
          format:c.format,
          settings:c.settings[c.format],
          durationSec:item.duration||0
        });

        if(result.success){
          item.status="completed";
          item.progressPercent=100;
          item.outputPath=result.outputPath;
          succeeded++;
        } else if(result.cancelled){
          item.status="cancelled";
        } else {
          item.status="failed";
          item.error=result.reason || null;
          failed++;
        }
      }
      c.currentJobId=null;
    }

    c.overallDone++;
    if(state.currentTab==="convert") renderTab();
  }

  // If Cancel was pressed mid-run, every item that never got a
  // chance to start is still sitting at "waiting" — leave those
  // alone rather than relabeling them "cancelled", since they're
  // exactly where they'd need to be to just press Start again.
  c.isConverting=false;
  c.lastRunSummary={succeeded, failed, skipped, outputFolder:c.outputFolder};
  renderTab();
}



function cancelConversion(){
  const c=state.convert;
  if(!c.isConverting) return;
  c.isConverting=false; // the running loop in startConversion() checks this and stops after the current file
  if(c.currentJobId) window.electronAPI.convertCancel(c.currentJobId);
}



// Live per-tick progress from ffmpeg-bridge.js's -progress pipe:1
// parsing (see convert-progress in main.js/preload.js). Deliberately
// mutates the DOM directly instead of calling renderTab() on every
// single tick — a full rebuild of the whole Convert tab several
// times a second would be wasteful and would fight the CSS
// transition on the progress bar fill. state.convert is still kept
// current either way, so switching tabs and back (or any other,
// unrelated renderTab() call) always redraws with the right numbers.
function handleConvertProgressTick({jobId, percent}){
  const c=state.convert;
  const item=c.queue.find(q=>q.id===jobId);
  if(!item || percent==null) return;
  item.progressPercent=percent;

  if(state.currentTab!=="convert") return;

  const fill=$("convertCurrentFill");
  if(fill) fill.style.width=percent+"%";
  const labelRow=$("convertCurrentLabelRow");
  if(labelRow && labelRow.lastElementChild) labelRow.lastElementChild.textContent=Math.round(percent)+"%";

  const row=document.querySelector('.convert-queue-row[data-job-row-id="'+CSS.escape(jobId)+'"] .convert-queue-row-progress-fill');
  if(row) row.style.width=percent+"%";
}



// Escapes user-provided text (titles, artist names, etc.) before
// it's inserted as innerHTML, so a song literally titled e.g.
// "<b>hi</b>" can't inject markup into the page.
function escapeHTML(s){ const d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }



/* ================================================================
   CONTEXT MENU & SORT MENU
   Both the per-song "⋮" menu and the new sort-button menu are
   small floating ".ctx-menu" popups built fresh each time they're
   opened and thrown away when closed. openMenuEl always points at
   whichever one is currently on screen (or null), so opening a
   new one automatically closes any other that was already open.
   ================================================================ */
let openMenuEl=null;



// Removes whichever floating menu is currently open, if any.
function closeMenu(){ if(openMenuEl){ openMenuEl.remove(); openMenuEl=null; } }



// Opens the "⋮" menu for a single song row: add/remove favorite,
// view track/file info, add to any playlist (or a brand new one),
// — only when this row is being shown inside a playlist — remove
// it from that playlist, and finally delete the track from the
// library entirely. Edit and Sync Lyrics are deliberately NOT here —
// they only act on whatever's currently playing (openEditModal()/
// openSyncModal() with no argument), so they live exclusively in the
// now-playing panel's top-right ☰ side menu instead (see
// menuEditBtn/menuSyncBtn wiring further down).
function openTrackMenu(e,track,currentPlaylistId){
  closeMenu();
  const menu=el("div","ctx-menu");
  const favBtn=el("button","","&#9829; "+(isInFavorites(track)?tr("track.removeFromFavorites"):tr("track.addToFavorites")));
  favBtn.addEventListener("click",()=>{ toggleFavorite(track); closeMenu(); renderTab(); });
  menu.appendChild(favBtn);
  const infoBtn=el("button","","&#9432; "+tr("track.info"));
  infoBtn.addEventListener("click",()=>{ closeMenu(); openInfoModal(track); });
  menu.appendChild(infoBtn);
  menu.appendChild(el("div","divider"));
  menu.appendChild(el("div","submenu-label",tr("track.addToPlaylist")));
  state.playlists.forEach(p=>{
    // Favorites is skipped here on purpose — it's already covered
    // by the "Add/Remove Favorites" button right above, so listing
    // it again under "Add to playlist" would just be a duplicate.
    if(p.id===state.favoritesId) return;
    const b=el("button","",escapeHTML(p.name));
    b.addEventListener("click",()=>{ addToPlaylist(p.id,track.id); closeMenu(); });
    menu.appendChild(b);
  });
  const newB=el("button","",tr("track.newPlaylist"));
  newB.addEventListener("click",()=>{ closeMenu(); createPlaylistPrompt(track.id); });
  menu.appendChild(newB);
  if(currentPlaylistId){
    menu.appendChild(el("div","divider"));
    const rem=el("button","",tr("track.removeFromThisPlaylist"));
    rem.addEventListener("click",()=>{ removeFromPlaylist(currentPlaylistId,track.id); closeMenu(); });
    menu.appendChild(rem);
  }
  menu.appendChild(el("div","divider"));
  const delBtn=el("button","danger",tr("track.deleteTrack"));
  delBtn.addEventListener("click",()=>{ closeMenu(); deleteTrack(track); });
  menu.appendChild(delBtn);
  document.body.appendChild(menu);
  replayMotion(menu);
  const rect=e.target.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.left-150;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";
  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



// Opens the new sort-order menu, anchored under the sort icon
// button. Reuses the exact same ".ctx-menu" styling and single-
// menu-at-a-time behavior as openTrackMenu() above. Uses
// e.currentTarget (not e.target) because a click could land on
// the button's nested <svg>/<line> icon rather than the button
// itself — currentTarget is always the button the listener is on.
function openSortMenu(e){
  closeMenu();

  const menu=el("div","ctx-menu");
  menu.appendChild(el("div","submenu-label",tr("sort.sortSongsBy")));

  SORT_OPTIONS.forEach(opt=>{
    const isActive=state[currentSortKey()]===opt.value;
    const btn=el("button","",(isActive?"✓ ":"")+escapeHTML(tr(opt.key)));
    if(isActive) btn.classList.add("selected");
    btn.addEventListener("click",()=>{ setSortBy(opt.value); closeMenu(); });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  replayMotion(menu);

  // Right-align the menu under the button so it never spills past
  // the edge of the sidebar.
  const rect=e.currentTarget.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.right-190;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";

  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



// Changes the active sort order (album-specific or general —
// see currentSortKey()) and immediately re-renders the current list
// so the new order is visible right away.
function setSortBy(value){
  state[currentSortKey()]=value;
  renderTab();
}



/* ================================================================
   PLAYLISTS
   Creating playlists, and adding/removing individual tracks to
   and from them (including the special built-in Favorites list).
   ================================================================ */

// Stand-in for window.prompt(), which Electron's renderer never
// implements — unlike alert()/confirm(), which show a real native
// dialog, prompt() silently does nothing and the call returns right
// away with no dialog ever appearing on screen (this has been true
// since Electron's earliest releases: https://github.com/electron/electron/issues/472).
// Every call site that used to call prompt() for a text value
// (new playlist name, rename playlist, rename folder) now calls
// this instead. Reuses the same modal overlay and .edit-* styling
// as the Edit Track modal so it looks native to the app. Resolves
// with the trimmed text, or null if the user cancels/submits empty.
function promptModal(title, label, defaultValue){
  return new Promise(resolve=>{
    const bodyHTML=`
      <div class="edit-form">
        <div class="edit-field">
          <label class="edit-label" for="promptModalInput">${escapeHTML(label)}</label>
          <input type="text" class="edit-input" id="promptModalInput" autocomplete="off">
        </div>
        <div class="edit-actions">
          <button type="button" class="edit-cancel-btn" id="promptModalCancelBtn">${escapeHTML(tr("modal.cancel"))}</button>
          <button type="button" class="edit-save-btn" id="promptModalOkBtn">${escapeHTML(tr("modal.ok"))}</button>
        </div>
      </div>`;
    openModal(title, bodyHTML);

    const input=$("promptModalInput");
    input.value=defaultValue||"";
    input.focus();
    input.select();

    let settled=false;
    function finish(value){
      if(settled) return;
      settled=true;
      $("modalCloseBtn").removeEventListener("click",onOutsideCancel);
      $("modalOverlay").removeEventListener("click",onOverlayClick);
      closeModal();
      resolve(value);
    }
    function onOutsideCancel(){ finish(null); }
    function onOverlayClick(e){ if(e.target.id==="modalOverlay") finish(null); }

    $("promptModalCancelBtn").addEventListener("click",()=>finish(null));
    $("promptModalOkBtn").addEventListener("click",()=>finish(input.value.trim()||null));
    input.addEventListener("keydown",(e)=>{
      if(e.key==="Enter"){ e.preventDefault(); finish(input.value.trim()||null); }
      else if(e.key==="Escape"){ e.preventDefault(); finish(null); }
    });
    // Also resolve (as a cancel) if the modal gets closed via the
    // "✕" button or by clicking the dark backdrop, so the promise
    // never hangs unresolved.
    $("modalCloseBtn").addEventListener("click",onOutsideCancel);
    $("modalOverlay").addEventListener("click",onOverlayClick);
  });
}



// Prompts the user for a playlist name and creates it. If
// trackIdToAdd is given (e.g. from the "+ New playlist" option
// inside a song's "⋮" menu), that track is added to it immediately.
async function createPlaylistPrompt(trackIdToAdd){
  const name=await promptModal(tr("prompt.newPlaylistTitle"),tr("prompt.playlistNameLabel"));
  if(!name) return;
  const p={id:uid(),name,trackIds:trackIdToAdd?[trackIdToAdd]:[]};
  state.playlists.push(p);
  idbPut("playlists",p);
  renderTab();
}



// Opens the "⋮" menu for a single playlist row (Rename /
// Delete). Reuses the exact same ".ctx-menu" popup styling and
// single-menu-at-a-time behavior as openTrackMenu()/openSortMenu().
function openPlaylistMenu(e,playlist){
  closeMenu();
  const menu=el("div","ctx-menu");

  const renameBtn=el("button","",tr("playlist.rename"));
  renameBtn.addEventListener("click",()=>{ closeMenu(); renamePlaylist(playlist); });
  menu.appendChild(renameBtn);

  const exportBtn=el("button","",tr("playlist.export"));
  exportBtn.addEventListener("click",()=>{ closeMenu(); exportPlaylistAsM3U(playlist); });
  menu.appendChild(exportBtn);

  const delBtn=el("button","danger",tr("playlist.delete"));
  delBtn.addEventListener("click",()=>{ closeMenu(); deletePlaylist(playlist); });
  menu.appendChild(delBtn);

  document.body.appendChild(menu);
  replayMotion(menu);
  const rect=e.currentTarget.getBoundingClientRect();
  let top=rect.bottom+6, left=rect.right-150;
  if(left<8) left=8;
  if(top+menu.offsetHeight>window.innerHeight) top=rect.top-menu.offsetHeight-6;
  menu.style.top=top+"px"; menu.style.left=left+"px";
  openMenuEl=menu;
  setTimeout(()=>document.addEventListener("click",closeMenu,{once:true}),0);
}



// Prompts for a new name and renames the playlist in place.
async function renamePlaylist(playlist){
  const name=await promptModal(tr("prompt.renamePlaylistTitle"),tr("prompt.playlistNameLabel"),playlist.name);
  if(!name) return;
  playlist.name=name;
  idbPut("playlists",playlist);
  renderTab();
}



// Confirms, then removes the playlist entirely (its tracks
// stay in the library — only the playlist itself is deleted).
function deletePlaylist(playlist){
  if(!confirm(tr("confirm.deleteNamed",{name:playlist.name}))) return;
  state.playlists=state.playlists.filter(p=>p.id!==playlist.id);
  idbDelete("playlists",playlist.id);
  // If the person is currently looking inside the playlist that
  // was just deleted, back out to the Playlists list instead of
  // showing a now-broken filtered view.
  if(state.filter&&state.filter.type==="playlist"&&state.filter.playlistId===playlist.id){
    state.filter=null;
  }
  renderTab();
}



// Exports a playlist as a standard Extended M3U (.m3u8) file — just
// file-path references, not the actual audio — so it opens directly
// in VLC/Winamp/foobar2000/etc, or can be re-imported into another
// player entirely. Electron-only (needs a native Save dialog and a
// real path per track). Tracks with no filePath (picked via a plain
// <input type=file>/drag-drop with nothing real on disk behind them
// — see hydrateTrack()) can't be referenced this way and are skipped,
// with a count reported back so the person knows some were left out
// rather than silently getting a shorter playlist than expected.
async function exportPlaylistAsM3U(playlist){
  if(!(window.electronAPI && window.electronAPI.saveTextFile)){
    alert(tr("playlist.exportUnavailable"));
    return;
  }

  const tracks=playlist.trackIds.map(id=>state.tracks.find(t=>t.id===id)).filter(Boolean);
  const withPaths=tracks.filter(t=>t.filePath);
  const skipped=tracks.length-withPaths.length;

  const lines=["#EXTM3U"];
  withPaths.forEach(t=>{
    const secs=t.duration?Math.round(t.duration):-1;
    lines.push(`#EXTINF:${secs},${t.artist||"Unknown Artist"} - ${t.title||"Unknown Title"}`);
    lines.push(t.filePath);
  });

  const safeName=(playlist.name||"playlist").replace(/[\\/:*?"<>|]+/g,"_");
  const result=await window.electronAPI.saveTextFile(`${safeName}.m3u8`, lines.join("\n")+"\n", "M3U Playlist", ["m3u8","m3u"]);

  if(result && result.saved){
    alert(skipped>0 ? tr("playlist.exportedWithSkipped",{count:skipped}) : tr("playlist.exported"));
  } else if(result && result.reason && result.reason!=="canceled"){
    alert(tr("playlist.exportFailed",{reason:result.reason}));
  }
}



// Adds a track to a playlist (no-op if it's already in there).
function addToPlaylist(playlistId,trackId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;
  if(!p.trackIds.includes(trackId)) p.trackIds.push(trackId);
  idbPut("playlists",p);
  if(state.filter && state.filter.playlistId===playlistId && !state.filter.tracks.some(t=>t.id===trackId)){
    const t=state.tracks.find(t=>t.id===trackId);
    if(t) state.filter.tracks.push(t);
  }
  renderTab();
}



// Opens the shared modal with a full list of every song in the
// library so the user can add any of them to the given playlist.
// Rows already in the playlist show a disabled "Added" state;
// clicking "Add" on any other row adds it immediately and flips
// that row to "Added" too, without closing the modal — so several
// songs can be added in one go.
function openAddMusicModal(playlistId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;

  if(!libraryTracks().length){
    openModal(tr("modal.addMusic"), `<p class='info-empty'>${escapeHTML(tr("empty.noLibraryForAddMusic"))}</p>`);
    return;
  }

  const sorted=libraryTracks().sort((a,b)=>a.title.localeCompare(b.title));
  const bodyHTML="<div class='add-music-list' id='addMusicList'>"+sorted.map(t=>{
    const already=p.trackIds.includes(t.id);
    return `<div class="add-music-row${already?" added":""}" data-track-id="${t.id}">
      <div class="amr-text">
        <div class="amr-title">${escapeHTML(t.title)}</div>
        <div class="amr-artist">${escapeHTML(t.artist)}</div>
      </div>
      <button class="amr-add-btn" ${already?"disabled":""}>${already?escapeHTML(tr("btn.added")):escapeHTML(tr("btn.add"))}</button>
    </div>`;
  }).join("")+"</div>";

  openModal(tr("modal.addMusicToNamed",{name:p.name}), bodyHTML);

  // Wire up each row's Add button after the HTML is in the DOM.
  $("addMusicList").querySelectorAll(".add-music-row").forEach(row=>{
    const trackId=row.dataset.trackId;
    const addBtn=row.querySelector(".amr-add-btn");
    addBtn.addEventListener("click",()=>{
      addToPlaylist(playlistId,trackId);
      row.classList.add("added");
      addBtn.textContent=tr("btn.added");
      addBtn.disabled=true;
    });
  });
}




// Removes a track from a playlist, and — if that playlist is the
// one currently being viewed — updates the on-screen list too.
function removeFromPlaylist(playlistId,trackId){
  const p=state.playlists.find(pl=>pl.id===playlistId);
  if(!p) return;
  p.trackIds=p.trackIds.filter(id=>id!==trackId);
  idbPut("playlists",p);
  if(state.filter && state.filter.playlistId===playlistId){
    state.filter.tracks=state.filter.tracks.filter(t=>t.id!==trackId);
  }
  renderTab();
}



// True if a track is currently inside the Favorites playlist.
function isInFavorites(track){
  const fav=state.playlists.find(p=>p.id===state.favoritesId);
  return fav && fav.trackIds.includes(track.id);
}



// Adds/removes a track from Favorites and refreshes the heart icon.
function toggleFavorite(track){
  const fav=state.playlists.find(p=>p.id===state.favoritesId);
  if(!fav) return;
  let liked;
  if(fav.trackIds.includes(track.id)){ fav.trackIds=fav.trackIds.filter(id=>id!==track.id); liked=false; }
  else { fav.trackIds.push(track.id); liked=true; }
  idbPut("playlists",fav);
  updateLoveButton();
  animateLoveIcon(liked);
}



// The heart's reaction to actually being toggled by the user (as
// opposed to updateLoveButton() elsewhere just silently syncing its
// resting state on a track change) — liking sends it up on a bouncy
// overshoot with a little scatter of hearts/sparks; unliking lets it
// visibly droop and sag back down instead.
function animateLoveIcon(liked){
  const btn=$("loveBtn");
  if(!btn) return;
  const icon=btn.querySelector("svg");
  if(icon) replayMotion(icon, liked?"heart-rise":"heart-sink", liked?640:620);
  if(liked && !window.matchMedia("(prefers-reduced-motion: reduce)").matches){
    replayMotion(btn,"heart-glow",640);
    spawnHeartSparks(btn);
  }
}

// Scatters a handful of tiny hearts/sparks off the Love button that
// float up and fade, each on a slightly randomized drift/rotation/
// delay so the burst doesn't look mechanically identical every time.
function spawnHeartSparks(btn){
  const glyphs=["♥","✦","♥","✦","♥","♥"];
  glyphs.forEach(g=>{
    const spark=document.createElement("span");
    spark.className="heart-spark";
    spark.textContent=g;
    spark.style.setProperty("--dx",Math.round(Math.random()*46-23)+"px");
    spark.style.setProperty("--rot",Math.round(Math.random()*50-25)+"deg");
    spark.style.animationDelay=Math.round(Math.random()*80)+"ms";
    btn.appendChild(spark);
    spark.addEventListener("animationend",()=>spark.remove(),{once:true});
    setTimeout(()=>spark.remove(),900); // fail-safe in case animationend doesn't fire
  });
}



// Fires a plain DOM event listing the real disk paths of tracks
// that are being PERMANENTLY deleted (not just removed from the
// library). Called only from actual "Delete" actions (deleteTrack,
// deleteFolder, and the bulk "Delete" selection below) — deliberately
// NOT from forgetFolder(), which only ever removes library entries
// and must leave files on disk untouched.
//
// This is a generic, platform-agnostic hook: it doesn't reference
// window.electronAPI or anything Electron-specific, and is a no-op
// with zero listeners on a web/Android build. Right now only
// renderer-bridge.js listens for it, to send those files to the
// Recycle Bin/Trash on Electron.
function notifyTracksDeleted(tracks){
  const paths=tracks.map(t=>t.filePath).filter(Boolean);
  if(paths.length) document.dispatchEvent(new CustomEvent("playnck:tracks-deleted",{detail:{paths}}));
}



// Shared cleanup used by both deleteTrack() (single song,
// below) and deleteFolder() (a whole batch of songs at once, see
// the FOLDERS section further down): strips the track out of
// every playlist it's in, out of the current play queue, stops
// playback if it's the track currently loaded, and removes it
// from both the in-memory library and IndexedDB. Doesn't confirm
// or re-render — callers are responsible for both.
function removeTrackData(track){
  if(state.currentTrack && state.currentTrack.id===track.id){
    audioEl.pause();
    audioEl.src="";
    state.currentTrack=null;
    updateNowPlayingUI();
  }

  state.playlists.forEach(p=>{
    if(p.trackIds.includes(track.id)){
      p.trackIds=p.trackIds.filter(id=>id!==track.id);
      idbPut("playlists",p);
    }
  });

  const qIdx=state.queue.indexOf(track.id);
  if(qIdx!==-1){
    state.queue.splice(qIdx,1);
    if(state.queueIndex>qIdx) state.queueIndex--;
    // Any memoized shuffle pick (see shuffleNextPick above) stored a
    // raw queue *index* — if the removed track sat before that index,
    // the number now points at a different track entirely. Safer to
    // just force a fresh roll than risk a wrong-but-in-range index.
    shuffleNextPick=null;
    refreshNextPreview();
  }

  // Release its temporary blob: URLs — nothing else is using them
  // once the track record itself is gone.
  if(track.fileURL) URL.revokeObjectURL(track.fileURL);
  if(track.artURL) URL.revokeObjectURL(track.artURL);

  state.tracks=state.tracks.filter(t=>t.id!==track.id);
  idbDelete("tracks",track.id);
  idbDelete("lyrics",track.id).catch(()=>{});
}



// Permanently deletes a single track from the library, after
// confirming with the user first since this can't be undone.
function deleteTrack(track){
  if(!confirm(tr("confirm.deleteNamed",{name:track.title}))) return;
  notifyTracksDeleted([track]);
  removeTrackData(track);
  // If we're currently drilled into a view that included this
  // track (album/artist/playlist/folder), drop it from there too.
  if(state.filter) state.filter.tracks=state.filter.tracks.filter(t=>t.id!==track.id);
  renderTab();
}



// Resolves the currently checked ids into an actual list of track
// ids to act on, based on what kind of thing is selected:
//   track   -> the checked ids ARE track ids already
//   albums  -> every track belonging to each checked album
//   artists -> every track belonging to each checked artist
//   folders -> every track belonging to each checked folder
//   playlists -> not applicable (a playlist selection acts on the
//                playlists themselves, never on their songs — see
//                deleteSelectedItems())
// Used by both the bulk "Delete" and "Add to Playlist" actions so
// selecting 3 albums and hitting Delete removes every song in them,
// the same way selecting songs directly would.
function getSelectedTrackIds(){
  const ids=[...state.selectedIds];
  if(state.selectType==="track") return ids;
  if(state.selectType==="albums"){
    const chosen=computeAlbums().filter(a=>ids.includes(a.key));
    return [...new Set(chosen.flatMap(a=>a.tracks.map(t=>t.id)))];
  }
  if(state.selectType==="artists"){
    const chosen=computeArtists().filter(a=>ids.includes(a.artist));
    return [...new Set(chosen.flatMap(a=>a.tracks.map(t=>t.id)))];
  }
  if(state.selectType==="folders"){
    return state.tracks.filter(t=>ids.includes(t.folderId)).map(t=>t.id);
  }
  return [];
}



// Permanently deletes everything currently checked (the selection
// bar's "Delete" button), with wording and behavior that adapt to
// what's actually selected:
//   track/albums/artists -> deletes every underlying song
//   folders   -> deletes the folders AND every song inside them
//                (same as the per-folder "Delete folder" menu entry)
//   playlists -> deletes just the playlists themselves; their songs
//                stay in the library, same as the per-playlist
//                "Delete" menu entry
// Same one-time confirmation pattern throughout, then drops out of
// select mode and refreshes the list.
function deleteSelectedItems(){
  const ids=[...state.selectedIds];
  if(!ids.length) return;
  const pluralKey=SELECT_TYPE_PLURAL_KEY[state.selectType]||"song";

  if(state.selectType==="playlists"){
    const label=plural(ids.length,pluralKey);
    if(!confirm(tr("confirm.deleteCountPlaylists",{label}))) return;
    ids.forEach(id=>{
      state.playlists=state.playlists.filter(p=>p.id!==id);
      idbDelete("playlists",id);
    });
  } else if(state.selectType==="folders"){
    const tracksToDelete=state.tracks.filter(t=>ids.includes(t.folderId));
    const trackCount=tracksToDelete.length;
    const label=plural(ids.length,pluralKey)
      + (trackCount ? tr("labelAnd")+plural(trackCount,"song") : "");
    if(!confirm(tr("confirm.deleteCountSongs",{label}))) return;
    notifyTracksDeleted(tracksToDelete);
    tracksToDelete.forEach(t=>removeTrackData(t));
    ids.forEach(id=>{
      state.folders=state.folders.filter(f=>f.id!==id);
      idbDelete("folders",id);
    });
  } else {
    const trackIds=getSelectedTrackIds();
    if(!trackIds.length) return;
    const label=plural(trackIds.length,"song");
    if(!confirm(tr("confirm.deleteCountSongs",{label}))) return;
    const tracksToDelete=trackIds.map(id=>state.tracks.find(t=>t.id===id)).filter(Boolean);
    notifyTracksDeleted(tracksToDelete);
    tracksToDelete.forEach(track=>removeTrackData(track));
    if(state.filter) state.filter.tracks=state.filter.tracks.filter(t=>!trackIds.includes(t.id));
  }

  state.selectMode=false;
  state.selectedIds.clear();
  selectToggle.classList.remove("active");
  renderTab();
}



// Opens a modal listing every playlist so the checked songs (or,
// for an album/artist/folder selection, every song inside those)
// can be added to one in a single tap (the selection bar's "Add to
// Playlist" button — hidden entirely when selecting playlists,
// since adding a playlist "to a playlist" isn't a real action).
// Reuses the same visual style as the per-song "Add to Playlist"
// submenu, but each row adds ALL resolved tracks at once and the
// modal stays open so you can add to more than one playlist before
// closing it.
function openAddSelectedToPlaylistModal(){
  const trackIds=getSelectedTrackIds();
  if(!trackIds.length) return;

  if(!state.playlists.length){
    openModal(tr("sel.addToPlaylist"), `<p class='info-empty'>${escapeHTML(tr("empty.noPlaylistsForAdd"))}</p>`);
    return;
  }

  const bodyHTML="<div class='add-music-list' id='selPlaylistList'>"+state.playlists.map(p=>{
    const allIn=trackIds.every(id=>p.trackIds.includes(id));
    return `<div class="add-music-row${allIn?" added":""}" data-playlist-id="${p.id}">
      <div class="amr-text">
        <div class="amr-title">${escapeHTML(p.name)}</div>
        <div class="amr-artist">${escapeHTML(plural(p.trackIds.length,"song"))}</div>
      </div>
      <button class="amr-add-btn" ${allIn?"disabled":""}>${allIn?escapeHTML(tr("btn.added")):escapeHTML(tr("btn.add"))}</button>
    </div>`;
  }).join("")+"</div>";

  const label=plural(trackIds.length,"song");
  openModal(tr("modal.addCountToPlaylist",{label}), bodyHTML);

  $("selPlaylistList").querySelectorAll(".add-music-row").forEach(row=>{
    const playlistId=row.dataset.playlistId;
    const addBtn=row.querySelector(".amr-add-btn");
    addBtn.addEventListener("click",()=>{
      trackIds.forEach(id=>addToPlaylist(playlistId,id));
      row.classList.add("added");
      addBtn.textContent=tr("btn.added");
      addBtn.disabled=true;
    });
  });
}




/* ================================================================
   PLAYBACK
   Everything that actually drives the <audio> element: starting a
   track, play/pause, and moving to the next/previous track
   (respecting shuffle and repeat mode).
   ================================================================ */

// Starts playing "track", and remembers the full list it came from
// as the queue (so next/prev/shuffle know what else is playable).
function playTrack(track, queueTracks){
  cancelCrossfade(); // a fresh explicit track pick always wins over any in-flight gapless fade — see GAPLESS PLAYBACK below
  state.queue = queueTracks.map(t=>t.id);
  state.queueIndex = state.queue.indexOf(track.id);
  state.shuffleHistory = [];   // starting a fresh queue/context — old shuffle trail no longer applies
  loadAndPlay(track);
}



// Loads a track into the <audio> element and starts playback,
// updating every bit of "now playing" UI to match.
function loadAndPlay(track){
  ensureAudioGraph(); // lazy first-use init of the EQ/gapless Web Audio graph — see EQUALIZER below
  state.currentTrack=track;
  audioEl.src=track.fileURL;
  audioEl.play().catch(()=>{});
  updateNowPlayingUI();
  closeLyrics();
  resetPlayProgress(track.id); // starts the MIN_PLAY_SECONDS countdown fresh — see PLAY PROGRESS below
  refreshPlayingHighlight(); // just moves the highlight — a full renderTab() here would rebuild every row/image in the visible list on every track change
}



// Bumps a track's play count and last-played timestamp (used by the
// Home tab's "Recently Played" / "Top Songs" sections) and persists
// both onto the saved copy in IndexedDB, deliberately excluding the
// session-only fileURL/artURL blob: URLs the same way every other
// save-to-DB spot in this file does. Called from trackPlayProgress()
// below once a track has actually been listened to for long enough
// to count — never directly from loadAndPlay/completeCrossfadeHandoff
// anymore, so skipping a track after a second or two no longer bumps
// its count.
function recordPlay(track){
  track.playCount=(track.playCount||0)+1;
  track.lastPlayedAt=Date.now();
  // An unpersisted external track (see ingestFiles()) just plays —
  // simply listening to it isn't the explicit "add this to my
  // library" action the rest of this fix is trying to preserve, so
  // don't let hitting MIN_PLAY_SECONDS silently write it to disk.
  // playCount/lastPlayedAt still update in memory above; they just
  // never reach a view, since libraryTracks() leaves this track out
  // of Home's Recently Played/Top Songs anyway.
  if(track.external) return;
  const storeCopy={...track};
  delete storeCopy.fileURL;
  delete storeCopy.artURL;
  idbPut("tracks",storeCopy).catch(()=>{});
}

/* ================================================================
   PLAY PROGRESS
   A track only counts as "1 play" — bumping playCount and
   lastPlayedAt via recordPlay() above — once it's actually been
   listened to for MIN_PLAY_SECONDS. Progress is tracked as real
   wall-clock time accrued between consecutive "timeupdate" ticks
   while audioEl is actively playing (not paused), reset whenever a
   new track is loaded (see resetPlayProgress(), called from
   loadAndPlay() and completeCrossfadeHandoff()).

   Using wall-clock deltas rather than audioEl.currentTime means a
   seek can't be used to fast-forward the countdown — jumping around
   the track doesn't advance real time — and each tick's delta is
   capped so a big gap (backgrounded tab, throttled timers) can't
   silently count as listened time either.
   ================================================================ */

const MIN_PLAY_SECONDS=30;
let playProgress=null; // {trackId, accumMs, lastTs, registered}

function resetPlayProgress(trackId){
  playProgress={trackId, accumMs:0, lastTs:null, registered:false};
}

function trackPlayProgress(){
  const track=state.currentTrack;
  if(!track || !playProgress || playProgress.trackId!==track.id) return;
  if(playProgress.registered || audioEl.paused) return;

  const now=performance.now();
  if(playProgress.lastTs!=null){
    const delta=Math.min(2000, now-playProgress.lastTs); // cap: only count plausible real elapsed time between ticks
    if(delta>0) playProgress.accumMs+=delta;
  }
  playProgress.lastTs=now;

  if(playProgress.accumMs>=MIN_PLAY_SECONDS*1000){
    playProgress.registered=true;
    recordPlay(track);
  }
}



// Play/pause button behavior: starts the first track if nothing
// has been played yet, otherwise just flips play/pause.
function togglePlay(){
  if(!state.currentTrack){
    if(state.tracks.length){ playTrack(state.tracks[0], state.tracks); }
    return;
  }
  if(audioEl.paused) audioEl.play().catch(()=>{});
  else audioEl.pause();
}



// Which way the cover art should swipe on the *next* updateNowPlayingUI()
// call — set right before an actual track change from nextTrack()/
// prevTrack()/completeCrossfadeHandoff() below, consumed (and reset)
// by updateNowPlayingUI() itself. Left null for track changes with no
// real "direction" (picking a song straight from a list, editing tags,
// etc.), which fall back to the plain track-change pop instead of a
// swipe — a swipe implies "next" or "previous", and those cases aren't.
let navSwipeDir=null;

// Advances to the next track. "auto" is true when this was
// triggered by a track finishing on its own (vs. the user pressing
// the next button) — that distinction matters for repeat-one,
// which should only restart the same track on auto-advance, not
// when the user explicitly asks to skip.
function nextTrack(auto){
  cancelCrossfade(); // a manual/normal advance always wins over any in-flight gapless fade — see GAPLESS PLAYBACK below
  if(!state.queue.length) return;
  if(state.repeat==="one" && auto){ audioEl.currentTime=0; audioEl.play(); return; }
  const idx=resolveNextIndex();
  if(idx===null) return;
  if(state.shuffle && state.queue.length>1) state.shuffleHistory.push(state.queueIndex); // remember where we came from so prevTrack can retrace it
  state.queueIndex=idx;
  const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(t){ navSwipeDir="next"; loadAndPlay(t); }
}



// Goes to the previous track — or, if more than 3 seconds into the
// current one, just restarts it instead (the same behavior most
// music players use for the "previous" button).
//
// When shuffle is on, "previous" doesn't pick a new random track —
// it steps back through shuffleHistory, i.e. the actual sequence of
// tracks shuffle already played, so you retrace your steps instead
// of shuffling backwards into something new. If there's no history
// left (we're back at the start of this shuffle session), it just
// restarts the current track.
function prevTrack(){
  cancelCrossfade(); // see GAPLESS PLAYBACK below
  if(!state.queue.length) return;
  if(audioEl.currentTime>3){ audioEl.currentTime=0; return; }

  if(state.shuffle){
    if(state.shuffleHistory.length){
      const idx=state.shuffleHistory.pop();
      state.queueIndex=idx;
      const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
      if(t){ navSwipeDir="prev"; loadAndPlay(t); }
    } else {
      audioEl.currentTime=0;
    }
    return;
  }

  let idx=state.queueIndex-1;
  if(idx<0) idx = state.repeat==="all" ? state.queue.length-1 : 0;
  state.queueIndex=idx;
  const t=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(t){ navSwipeDir="prev"; loadAndPlay(t); }
}



/* ================================================================
   EQUALIZER
   A 10-band graphic EQ sitting between the <audio> element(s) and
   the speakers, via the Web Audio API. Both audioEl (the primary
   element) and fadeAudioEl (the hidden second element Gapless
   Playback's crossfade uses — see below) are routed through the
   exact same filter chain, so EQ applies consistently no matter
   which one is currently producing sound, including during a
   crossfade where both are briefly audible at once.

   Built lazily — on first real playback, or the first time the
   person touches an EQ control, whichever comes first — rather than
   at startup: creating an AudioContext before any user gesture has
   happened leaves it stuck "suspended" under the browser's autoplay
   policy, and there's no reason to pay for any of this for someone
   who never opens Settings > Audio.

   "Off" doesn't disconnect anything — every band's gain is just set
   to 0 dB (a true pass-through). That's simpler than physically
   rewiring the graph, and can't glitch whatever's currently playing
   the way disconnecting/reconnecting live nodes could.
   ================================================================ */

const EQ_BANDS=[
  {freq:32,    type:"lowshelf"},
  {freq:64,    type:"peaking"},
  {freq:125,   type:"peaking"},
  {freq:250,   type:"peaking"},
  {freq:500,   type:"peaking"},
  {freq:1000,  type:"peaking"},
  {freq:2000,  type:"peaking"},
  {freq:4000,  type:"peaking"},
  {freq:8000,  type:"peaking"},
  {freq:16000, type:"highshelf"}
];
// A few reasonable starting points shown as one-click buttons in
// Settings > Audio, on top of the 10 sliders for manual adjustment.
// Each array is one gain in dB (-12..12) per EQ_BANDS entry, in order.
const EQ_PRESETS={
  flat:        [0,0,0,0,0,0,0,0,0,0],
  bassBoost:   [6,5,4,2,0,0,0,0,0,0],
  trebleBoost: [0,0,0,0,0,0,2,4,5,6],
  vocalBoost:  [-2,-2,-1,1,3,3,2,0,-1,-2]
};

let audioCtx=null;
let eqFilters=null;    // array of EQ_BANDS.length BiquadFilterNodes, wired in series
let eqInputNode=null;  // the first filter — anything that wants EQ applied connects its source here
let analyserNode=null; // passive tap for the Visualizer — see ensureAudioGraph and the VISUALIZER section below
let fadeAudioEl=null;  // hidden second <audio> element, used only by Gapless Playback's crossfade (see getFadeAudioEl below)

// "1000" -> "1k", "125" -> "125" — just for the band labels in Settings.
function formatEqFreq(hz){
  return hz>=1000 ? (hz/1000)+"k" : String(hz);
}

// Builds the Web Audio graph the first time it's actually needed
// (see the file header comment above for why this is lazy). Safe to
// call any number of times from anywhere — every call after the
// first is a no-op.
function ensureAudioGraph(){
  if(audioCtx) return;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx) return; // very old/unusual environment — EQ/gapless quietly do nothing rather than throwing

  audioCtx=new Ctx();
  if(audioCtx.state==="suspended") audioCtx.resume().catch(()=>{});

  eqFilters=EQ_BANDS.map(band=>{
    const f=audioCtx.createBiquadFilter();
    f.type=band.type;
    f.frequency.value=band.freq;
    if(band.type==="peaking") f.Q.value=1;
    f.gain.value=0;
    return f;
  });
  for(let i=0;i<eqFilters.length-1;i++) eqFilters[i].connect(eqFilters[i+1]);
  const eqOutput=eqFilters[eqFilters.length-1];
  eqOutput.connect(audioCtx.destination);
  eqInputNode=eqFilters[0];

  // Visualizer tap: a passive listener on the exact same post-EQ
  // signal everyone actually hears — including whichever element is
  // contributing sound mid-crossfade during a Gapless Playback
  // transition, since both merge into eqOutput already. Doesn't need
  // a downstream .connect() of its own; getByteFrequencyData() below
  // just reads whatever's currently flowing through it.
  analyserNode=audioCtx.createAnalyser();
  analyserNode.fftSize=64; // coarse on purpose — a handful of chunky bars, not a fine spectrum
  analyserNode.smoothingTimeConstant=0.75; // heavier smoothing so the bars ease rather than flicker
  eqOutput.connect(analyserNode);

  applyEqGains();
  connectMediaElementToEq(audioEl);
}

// Routes one <audio> element's output through the shared EQ filter
// chain instead of straight to the speakers. A given element can
// only ever have createMediaElementSource() called on it once for
// its whole lifetime (a hard Web Audio API rule), so this is only
// ever called once per element: once for audioEl (from
// ensureAudioGraph just above) and once for fadeAudioEl, the first
// time Gapless Playback actually needs it (see getFadeAudioEl
// further below).
function connectMediaElementToEq(mediaEl){
  const source=audioCtx.createMediaElementSource(mediaEl);
  source.connect(eqInputNode);
}

// Pushes state.eq onto the real filter nodes — 0 dB (flat/pass-
// through) on every band while state.eq.enabled is false, regardless
// of what's saved in state.eq.gains, so switching the toggle off is
// a true bypass without needing to touch the graph's wiring itself.
function applyEqGains(){
  if(!eqFilters) return;
  eqFilters.forEach((f,i)=>{
    f.gain.value = state.eq.enabled ? (state.eq.gains[i]||0) : 0;
  });
}

// Persists state.eq (on/off + all 10 gains) to IndexedDB — the same
// "settings" key/value store already used for theme/volume/language.
function saveEqSettings(){
  idbPut("settings",{key:"equalizer", value:{enabled:state.eq.enabled, gains:state.eq.gains}}).catch(()=>{});
}



/* ================================================================
   GAPLESS PLAYBACK
   Smooths the transition between tracks with a short automatic
   crossfade instead of the small stutter/silence that comes from
   only starting to load the next file after the current one has
   already fully ended. Implemented with a second, hidden <audio>
   element (fadeAudioEl) that starts playing the upcoming track a
   few seconds early, faded in while the primary element (audioEl)
   fades out — audioEl itself is never repurposed for a different
   track mid-fade, so everything else that watches it (the progress
   bar, lyrics sync, OS media keys in renderer-bridge.js) keeps
   working normally for the entire crossfade window, since audioEl
   is genuinely still playing the outgoing track, just at falling
   volume, right up until the handoff below.

   Deliberately NOT attempted for repeat:"one" (looping a track into
   a crossfaded copy of itself adds real edge-case complexity for
   little benefit — that mode already loops instantly, see
   nextTrack()'s own special case for it) or for tracks shorter than
   twice the crossfade window (nothing sensible to fade against that
   early in something that short).
   ================================================================ */

const GAPLESS_CROSSFADE_SECONDS=3;

let crossfadeState=null; // {nextIndex, nextTrack, rafHandle} while a crossfade is in flight, else null

// Under shuffle, resolveNextIndex() below has to pick a *random*
// index — but it's now also called speculatively, before any click,
// just to paint the carousel's "next" preview (see peekNextEntry()
// and the ALBUM CAROUSEL section further down). Without memoizing
// that pick, every extra speculative call would re-roll the dice,
// so the album the user sees sitting on the right could be a
// different one than what Next/crossfade actually lands on.
// Memoized per state.currentTrack.id — the moment the current track
// actually changes, the old pick is no longer for "what comes after
// THIS track" and naturally falls out of date on its own.
let shuffleNextPick=null; // {forId, index} | null

// Figures out which queue index playback would move to next if
// nextTrack() ran right now, respecting shuffle/repeat — WITHOUT
// moving there or touching shuffleHistory. Used by nextTrack() itself
// (which commits to the result), maybeStartCrossfade() below (which
// needs to know what's coming before the current track actually
// ends, without any side effects, in case it never gets used — e.g.
// the person pauses, skips manually, or picks a different track
// before the crossfade would complete), and peekNextEntry() (which
// paints the carousel's "next" preview with this same result, so
// what's on screen always matches what a click actually does).
// Returns null when there's nowhere to go (end of a non-repeating
// queue). Doesn't handle repeat:"one" — that's a same-track loop,
// not a "next track" in the sense this function's callers care about.
function resolveNextIndex(){
  if(!state.queue.length) return null;
  if(state.shuffle){
    if(state.queue.length>1){
      const forId=state.currentTrack?state.currentTrack.id:null;
      if(shuffleNextPick && shuffleNextPick.forId===forId) return shuffleNextPick.index;
      let r; do{ r=Math.floor(Math.random()*state.queue.length); }while(r===state.queueIndex);
      shuffleNextPick={forId, index:r};
      return r;
    }
    return state.queueIndex; // only one track in the queue — nowhere else to shuffle to
  }
  const idx=state.queueIndex+1;
  if(idx>=state.queue.length){
    if(state.repeat==="all") return 0;
    return null;
  }
  return idx;
}

// Mirror of resolveNextIndex() for the carousel's "previous" preview
// (there's no prevTrack()-side equivalent to memoize against, since
// non-shuffle "previous" is already fully deterministic and shuffle
// "previous" already reads from the deterministic shuffleHistory
// stack rather than picking randomly — see prevTrack() above).
// Returns null exactly where prevTrack() itself would just restart
// the current track rather than genuinely move to a different one
// (no shuffle history yet, or repeat is off and already at index 0):
// the carousel intentionally shows "no previous album" rather than a
// fake one in that case — see peekPrevEntry() and requirement #16 in
// the ALBUM CAROUSEL section below.
function resolvePrevIndex(){
  if(!state.queue.length) return null;
  if(state.shuffle){
    if(!state.shuffleHistory.length) return null;
    return state.shuffleHistory[state.shuffleHistory.length-1];
  }
  const idx=state.queueIndex-1;
  if(idx<0){
    if(state.repeat==="all") return state.queue.length-1;
    return null;
  }
  return idx;
}

// Resolves resolveNextIndex()/resolvePrevIndex() all the way to the
// actual track object (or null), for the carousel to paint directly.
function peekNextEntry(){
  if(!state.currentTrack || !state.queue.length) return null;
  const idx=resolveNextIndex();
  if(idx===null) return null;
  const track=state.tracks.find(tt=>tt.id===state.queue[idx]);
  return track ? {index:idx, track} : null;
}
function peekPrevEntry(){
  if(!state.currentTrack || !state.queue.length) return null;
  const idx=resolvePrevIndex();
  if(idx===null) return null;
  const track=state.tracks.find(tt=>tt.id===state.queue[idx]);
  return track ? {index:idx, track} : null;
}

// Lazily creates the hidden crossfade-partner element, connecting it
// into the shared EQ graph exactly once (see connectMediaElementToEq
// above). Safe to call repeatedly — later calls just reuse it.
function getFadeAudioEl(){
  if(fadeAudioEl) return fadeAudioEl;
  fadeAudioEl=new Audio();
  fadeAudioEl.preload="auto";
  fadeAudioEl.crossOrigin="anonymous"; // must be set before any src is ever assigned — see the crossorigin note on #audioEl in index.html
  fadeAudioEl.addEventListener("error",()=>{
    // The upcoming file failed to load for some reason (moved/
    // deleted since it was added, etc). Cancel cleanly and let the
    // current track's own "ended" event fall back to a normal
    // nextTrack(true) — handleMissingTrack() (see PLAYBACK above)
    // will sort the library entry out at that point, same as it
    // would for any other track.
    cancelCrossfade();
  });
  ensureAudioGraph();
  if(audioCtx) connectMediaElementToEq(fadeAudioEl);
  return fadeAudioEl;
}

// Checked on every timeupdate tick of the primary element while
// Gapless Playback is on. Starts a crossfade into whatever track
// would play next once we're within GAPLESS_CROSSFADE_SECONDS of
// the current track's natural end.
function maybeStartCrossfade(){
  if(!state.gapless.enabled) return;
  if(crossfadeState) return; // already mid-crossfade for this track
  if(state.repeat==="one") return; // same-track loop — see the file header comment above
  const dur=audioEl.duration;
  if(!dur || !isFinite(dur) || dur<GAPLESS_CROSSFADE_SECONDS*2) return;
  if(dur-audioEl.currentTime>GAPLESS_CROSSFADE_SECONDS) return;

  const idx=resolveNextIndex();
  if(idx===null) return;
  const nextTrackObj=state.tracks.find(tt=>tt.id===state.queue[idx]);
  if(!nextTrackObj || !nextTrackObj.fileURL) return;

  startCrossfade(idx, nextTrackObj);
}

// Begins fading from the currently-playing track into nextTrackObj,
// resolved once here and reused as-is at handoff time — resolveNextIndex()
// is never called a second time for the same transition, since doing
// so under shuffle could pick a *different* random track than the one
// that's actually now playing quietly on fadeAudioEl.
function startCrossfade(nextIndex, nextTrackObj){
  const fe=getFadeAudioEl();
  fe.src=nextTrackObj.fileURL;
  fe.currentTime=0;
  fe.volume=0;
  fe.play().catch(()=>{});

  const startVolume=audioEl.volume;
  const targetVolume=state.muted?0:state.volume;
  const startedAt=performance.now();
  const durationMs=Math.min(GAPLESS_CROSSFADE_SECONDS, Math.max(0.2, audioEl.duration-audioEl.currentTime))*1000;

  crossfadeState={nextIndex, nextTrack:nextTrackObj, rafHandle:null};

  function tick(){
    if(!crossfadeState) return; // canceled mid-fade
    const p=Math.min(1, (performance.now()-startedAt)/durationMs);
    audioEl.volume=startVolume*(1-p);
    fe.volume=targetVolume*p;
    if(p<1) crossfadeState.rafHandle=requestAnimationFrame(tick);
  }
  tick();
}

// Cancels any in-flight crossfade, restoring the primary element's
// volume to where it should actually be. Called before any manual
// track change (playTrack/nextTrack/prevTrack) and before volume/
// mute changes (applyVolume), so a fade never ends up fighting with
// something else it doesn't know about. Safe to call when no
// crossfade is running (a plain no-op) — every one of those call
// sites calls this unconditionally rather than checking first.
function cancelCrossfade(){
  if(!crossfadeState) return;
  if(crossfadeState.rafHandle) cancelAnimationFrame(crossfadeState.rafHandle);
  if(fadeAudioEl){ fadeAudioEl.pause(); fadeAudioEl.src=""; }
  crossfadeState=null;
  audioEl.volume = state.muted?0:state.volume;
}

// Called from the "ended" listener instead of nextTrack(true) when a
// crossfade is already in flight for this transition — hands
// playback over to the track that's already been playing quietly on
// fadeAudioEl for the past few seconds, carrying its position across
// instead of restarting from 0 on the primary element.
function completeCrossfadeHandoff(){
  const {nextIndex, nextTrack:nextTrackObj}=crossfadeState;
  const fe=fadeAudioEl;
  if(crossfadeState.rafHandle) cancelAnimationFrame(crossfadeState.rafHandle);

  if(state.shuffle && state.queue.length>1) state.shuffleHistory.push(state.queueIndex);
  state.queueIndex=nextIndex;
  state.currentTrack=nextTrackObj;
  audioEl.src=nextTrackObj.fileURL;
  audioEl.currentTime=fe.currentTime;
  audioEl.volume=state.muted?0:state.volume;
  audioEl.play().catch(()=>{});
  fe.pause();
  fe.src="";

  crossfadeState=null;
  navSwipeDir="next"; // gapless handoff is still a forward advance — swipe the same way a manual Next would
  updateNowPlayingUI();
  closeLyrics();
  resetPlayProgress(nextTrackObj.id); // same MIN_PLAY_SECONDS countdown as a normal track start — see PLAY PROGRESS above
  refreshPlayingHighlight(); // see loadAndPlay — a full renderTab() here would rebuild the whole visible list on every crossfade too
}



/* ================================================================
   VISUALIZER
   A subtle, audio-reactive layer of bars pinned to the absolute
   bottom edge of the player panel (see #visualizerCanvas in
   index.html and .visualizer-canvas in styles.css) — not a separate
   view, just a quiet background wash that pulses with whatever's
   actually playing. Reads off the same AnalyserNode tapped into the
   shared EQ graph (see ensureAudioGraph above), so it reflects the
   real, post-EQ signal — including whichever element is contributing
   sound mid-crossfade during a Gapless Playback transition.

   The render loop only ever runs while there's something worth
   drawing — the toggle is on in Settings > Player AND a track is
   actually playing — and stops itself the instant either stops
   being true, rather than looping in the background for no reason.
   ================================================================ */

let visualizerRafHandle=null;
let visualizerFreqData=null; // reused Uint8Array sized to analyserNode.frequencyBinCount

// Persists both the on/off toggle and the opacity/intensity slider
// together, so neither setting can drift out of sync in storage.
function saveVisualizerSettings(){
  idbPut("settings",{key:"visualizer", value:{enabled:state.visualizer.enabled, intensity:state.visualizer.intensity}}).catch(()=>{});
}

// Starts or stops the render loop to match reality. Called from the
// Settings > Player toggle and from audioEl's play/pause listeners
// below — cheap and idempotent, safe to call as often as needed.
function updateVisualizerState(){
  const canvas=$("visualizerCanvas");
  if(!canvas) return;
  canvas.classList.toggle("hidden", !state.visualizer.enabled);

  const shouldRun = state.visualizer.enabled && !audioEl.paused && !!state.currentTrack;
  if(shouldRun && !visualizerRafHandle){
    ensureAudioGraph();
    sizeVisualizerCanvas(canvas);
    visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame);
  } else if(!shouldRun && visualizerRafHandle){
    cancelAnimationFrame(visualizerRafHandle);
    visualizerRafHandle=null;
  }
}

// Matches the canvas's pixel buffer to its actual on-screen size,
// including devicePixelRatio so bars stay crisp on hi-DPI displays.
// Called once whenever the loop (re)starts and on window resize —
// the row's size only changes then, not on every animation tick.
function sizeVisualizerCanvas(canvas){
  const dpr=window.devicePixelRatio||1;
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(1,Math.round(rect.width*dpr));
  canvas.height=Math.max(1,Math.round(rect.height*dpr));
}

function drawVisualizerFrame(){
  const canvas=$("visualizerCanvas");
  if(!canvas || !analyserNode || !state.visualizer.enabled || audioEl.paused){
    visualizerRafHandle=null;
    return; // loop stops here — updateVisualizerState() restarts it once conditions are true again
  }

  if(!visualizerFreqData || visualizerFreqData.length!==analyserNode.frequencyBinCount){
    visualizerFreqData=new Uint8Array(analyserNode.frequencyBinCount);
  }
  analyserNode.getByteFrequencyData(visualizerFreqData);

  const ctx=canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);
  if(w<=0||h<=0){ visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame); return; }

  // Reads the app's own theme accent color rather than a fixed one,
  // so this matches whatever's picked in Settings > Theme.
  const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue("--accent1-rgb")||"").trim() || "138,92,246";
  const barCount=Math.min(28, analyserNode.frequencyBinCount);
  const gap=w*0.012;
  const barWidth=(w-gap*(barCount-1))/barCount;

  for(let i=0;i<barCount;i++){
    // Skip the first couple of bins — mostly sub-bass/DC offset that
    // tends to sit near-maxed regardless of the song, which would
    // otherwise make the left edge look stuck instead of reactive.
    const v=visualizerFreqData[i+2]/255;
    const barH=Math.max(h*0.05, Math.min(h*0.6, v*h*0.6)); // capped — a wash behind the buttons, never fills the row
    const x=i*(barWidth+gap);
    const y=h-barH;
    const r=Math.min(barWidth/2,4*(window.devicePixelRatio||1));
    // Base alpha stays the same subtle 0.12–0.34 wash; the Settings > Player
    // opacity slider (state.visualizer.intensity, 0–2) scales it up or down
    // from there — 1 is the original look, 2 pushes bars toward fully solid.
    const alpha=Math.max(0,Math.min(1,(0.12+v*0.22)*state.visualizer.intensity));
    ctx.fillStyle=`rgba(${accentRgb},${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(x,h);
    ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r);
    ctx.lineTo(x+barWidth-r,y);
    ctx.arcTo(x+barWidth,y,x+barWidth,y+r,r);
    ctx.lineTo(x+barWidth,h);
    ctx.closePath();
    ctx.fill();
  }

  visualizerRafHandle=requestAnimationFrame(drawVisualizerFrame);
}

window.addEventListener("resize",()=>{
  if(!visualizerRafHandle) return;
  const canvas=$("visualizerCanvas");
  if(canvas) sizeVisualizerCanvas(canvas);
});



// Picks playback back up after handleMissingTrack() (below) has just
// removed the track that was loaded — deliberately NOT the same as a
// normal nextTrack() call. nextTrack() assumes the currently-loaded
// track is still sitting in the queue and steps forward from it
// (queueIndex+1); that assumption is already broken here, since the
// track at queueIndex was just spliced out. removeTrackData() (called
// for every track this removes, including indirectly via
// pruneFolder()) keeps state.queueIndex correctly aligned as tracks
// disappear out from under it — see its own comment — so by the time
// this runs, queueIndex already points at exactly the track that
// should play next; using nextTrack()'s +1 on top of that would skip
// over it. Shuffle mode is the one case that's fine to hand off to
// nextTrack() as-is: its random-pick branch only needs *a* valid
// current index to avoid re-picking it and to push onto
// shuffleHistory, which queueIndex still is.
function resumeAfterRemoval(){
  if(!state.queue.length) return;

  if(state.shuffle){ nextTrack(false); return; }

  if(state.queueIndex>=state.queue.length){
    if(state.repeat==="all") state.queueIndex=0;
    else return; // ran off the end of the queue — same as nextTrack() does normally
  }
  const t=state.tracks.find(tt=>tt.id===state.queue[state.queueIndex]);
  if(t) loadAndPlay(t);
}



// Handles a track failing to actually load into <audio> — see the
// "error" listener on audioEl further down in the PROGRESS section.
// The usual cause on a path-backed track: the real file behind it was
// moved, renamed, or deleted outside the app since it was added, so
// the playnck-file:// protocol handler in main.js 404s and the
// browser reports that here as a bare "error" event with no further
// detail. Before touching the library this re-confirms with the main
// process that the file (and, if known, its containing folder) is
// really gone — the same check verifyLibraryOnDisk() uses on its
// periodic sweep — so a transient/codec-related failure that isn't
// actually about a missing file never causes a false cleanup.
//   - If the track's whole containing folder is gone too (moved or
//     deleted as a unit), the entire folder is pruned with it — same
//     as verifyLibraryOnDisk() (see pruneFolder() above).
//   - Otherwise just this one track is removed (removeTrackData(),
//     same as everywhere else in the app).
// Either way, playback then picks back up via resumeAfterRemoval()
// above rather than being left stuck on a dead track — this is what
// turns "clicked play, nothing happens" into "clicked play, it just
// starts the next song". Electron only; a no-op wherever
// window.electronAPI.checkPathsExist isn't available (plain web,
// where a track's bytes live in memory and can't go stale this way).
async function handleMissingTrack(track){
  if(!window.electronAPI || !window.electronAPI.checkPathsExist) return;

  const folder=state.folders.find(f=>f.id===track.folderId);
  const checkPaths=[track.filePath];
  if(folder && folder.path) checkPaths.push(folder.path);

  let existence={};
  try{ existence=await window.electronAPI.checkPathsExist(checkPaths); }
  catch(e){ console.warn("handleMissingTrack: checkPathsExist failed",e); return; }

  // Not actually missing — false alarm (some other playback error).
  // Leave the library alone.
  if(existence[track.filePath]!==false) return;

  if(folder && folder.path && existence[folder.path]===false){
    pruneFolder(folder);
  } else {
    removeTrackData(track);
  }

  renderTab();
  resumeAfterRemoval();
}



// Cycles the repeat button through its three modes in order:
// off -> all -> one -> off -> ... and updates both the button's
// active/title state and the new small "A"/"1" badge on it.
function cycleRepeatMode(){
  if(state.repeat==="off") state.repeat="all";
  else if(state.repeat==="all") state.repeat="one";
  else state.repeat="off";

  const btn=$("repeatBtn");
  btn.classList.toggle("active", state.repeat!=="off");
  btn.title = state.repeat==="one" ? tr("player.repeatOne") : state.repeat==="all" ? tr("player.repeatAll") : tr("player.repeat");

  updateRepeatBadge();
  refreshNextPreview(); // repeat mode can change what resolveNextIndex() returns at the end of the queue
}



/* ================================================================
   ALBUM CAROUSEL
   Drives the three persistent ".art-slot" elements in #artCarousel
   (see index.html) that replace the old single cover image. Exactly
   three DOM slots exist for the app's entire lifetime — nothing is
   ever cloned or thrown away (see requirement #18: no ghost-card
   system) — and at any moment each one is doing one of three jobs,
   tracked via its .role property (kept in sync with its data-role
   attribute, which is what styles.css's COVER ART CAROUSEL rules
   actually animate):

     "prev"    — the track that was just playing
     "current" — the track playing right now (full size/opacity)
     "next"    — the track that would start if Next were pressed

   Rotating which physical slot holds which role (rotateCarousel(),
   below) — rather than swapping one slot's image — is what lets the
   album already visible on the right glide into the center instead
   of popping in as a freshly-loaded image, per this file's core
   requirement. peekNextEntry()/peekPrevEntry() (see just above
   nextTrack()) are what let this paint the next/previous slots
   *before* the user ever clicks anything.
   ================================================================ */
let carouselSlots=null; // [{el,img,ph,role}, ...] — populated once, lazily

function initCarouselSlots(){
  if(carouselSlots) return carouselSlots;
  const nodes=Array.from(document.querySelectorAll("#artCarousel .art-slot"));
  carouselSlots=nodes.map(el=>({
    el,
    img: el.querySelector(".art-slot-img"),
    ph: el.querySelector(".art-placeholder"),
    role: el.dataset.role // "prev" | "current" | "next", matches the HTML's initial data-role
  }));
  return carouselSlots;
}

function slotWithRole(role){ return carouselSlots.find(s=>s.role===role); }

// Paints a single slot's img/placeholder to match `entry`
// ({index,track} from peekNextEntry()/peekPrevEntry(), or null).
// hideWhenEmpty controls what an empty result looks like: the
// "current" slot falls back to the app's generic placeholder icon
// (matching the player's original no-track-loaded look), while the
// previous/next slots instead disappear entirely — see requirement
// #16, no fake album at the start/end of the queue.
function paintCarouselSlot(slot, entry, hideWhenEmpty){
  const track=entry && entry.track;
  if(!track){
    slot.el.classList.toggle("art-slot-empty", !!hideWhenEmpty);
    slot.img.classList.add("hidden");
    slot.img.removeAttribute("src");
    slot.ph.classList.remove("hidden");
    return;
  }
  slot.el.classList.remove("art-slot-empty");
  // Requirement #15: a real track with no embedded art still uses
  // the app's existing fallback icon rather than an empty hole.
  const artURL=getTrackArtURL(track);
  if(artURL){
    slot.img.src=artURL;
    slot.img.classList.remove("hidden");
    slot.ph.classList.add("hidden");
  } else {
    slot.img.classList.add("hidden");
    slot.img.removeAttribute("src");
    slot.ph.classList.remove("hidden");
  }
}

// Instantly (no transition) reassigns a slot to a new role and
// repaints it — used only for the "recycle" half of rotateCarousel():
// an old previous/next slot that's no longer relevant silently
// becomes the new next/previous, in place, rather than visibly
// sliding all the way across the carousel to get there.
function recycleSlotInstant(slot, role, entry){
  slot.el.classList.add("art-slot-instant");
  slot.role=role;
  slot.el.dataset.role=role;
  paintCarouselSlot(slot, entry, true);
  void slot.el.offsetWidth; // commit transition:none before the next frame, so nothing tweens
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ slot.el.classList.remove("art-slot-instant"); });
  });
}

// Non-directional (re)sync: repaints all three slots straight to
// their resting content with no slide, for anything that isn't a
// genuine Next/Previous — first paint, picking a track directly from
// a list, a tag edit refreshing the currently-playing track's art,
// etc. (navSwipeDir stays null in all of those — see just above
// nextTrack()).
function syncCarouselStatic(){
  initCarouselSlots();
  const current=slotWithRole("current") || carouselSlots[0];
  const others=carouselSlots.filter(s=>s!==current);
  const prev=others[0], next=others[1];

  const currentEntry=state.currentTrack ? {track:state.currentTrack} : null;
  const prevEntry=peekPrevEntry();
  const nextEntry=peekNextEntry();

  [current,prev,next].forEach(s=>s.el.classList.add("art-slot-instant"));
  current.role="current"; current.el.dataset.role="current";
  prev.role="prev";       prev.el.dataset.role="prev";
  next.role="next";       next.el.dataset.role="next";
  paintCarouselSlot(current, currentEntry, false);
  paintCarouselSlot(prev, prevEntry, true);
  paintCarouselSlot(next, nextEntry, true);
  void current.el.offsetWidth;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ [current,prev,next].forEach(s=>s.el.classList.remove("art-slot-instant")); });
  });
}

// Repaints ONLY the prev/next preview slots to match whatever
// resolveNextIndex()/resolvePrevIndex() would return right now — no
// slide, and the "current" slot is untouched. This is the single
// place responsible for keeping the background "next" artwork in
// sync with anything that changes what the next track actually is
// WITHOUT the current track itself changing: toggling Shuffle,
// cycling Repeat, or the live queue being edited (e.g. deleting the
// track that was the shuffle pick). A genuine track change (Next/
// Previous/picking a song) already goes through rotateCarousel()/
// syncCarouselStatic() via updateNowPlayingUI() and doesn't need this.
//
// Root cause this exists to fix: resolveNextIndex() already
// recalculates correctly the moment it's called (it reads
// state.shuffle/state.repeat/state.queue live, so it's never itself
// "wrong") — but nothing was re-invoking it to repaint the carousel
// when Shuffle/Repeat changed with no accompanying track change, so
// the "next" slot kept showing whatever artwork the LAST recalculation
// had painted (e.g. the shuffle pick from before Shuffle was turned
// off). The fix is to call this wherever that could happen, not to
// give the artwork its own separate state to patch up.
function refreshNextPreview(){
  initCarouselSlots();
  const prev=slotWithRole("prev"), next=slotWithRole("next");
  [prev,next].forEach(s=>{
    if(!s) return;
    s.el.classList.add("art-slot-instant");
  });
  if(prev) paintCarouselSlot(prev, peekPrevEntry(), true);
  if(next) paintCarouselSlot(next, peekNextEntry(), true);
  if(prev) void prev.el.offsetWidth;
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{ [prev,next].forEach(s=>{ if(s) s.el.classList.remove("art-slot-instant"); }); });
  });
}

// The actual carousel rotation: current->prev, next->current, and
// the old prev is recycled into the new next (mirrored for "prev").
// Reads/writes carouselSlots' .role purely in JS, synchronously, so
// repeated rapid calls (fast repeated Next/Previous presses — see
// requirement #17) always rotate from whatever the *logical* state
// currently is, regardless of whether an earlier rotation's CSS
// transition has visually finished yet.
function rotateCarousel(dir){
  initCarouselSlots();
  if(!slotWithRole("current")){ syncCarouselStatic(); return; }

  if(dir==="next"){
    const oldPrev=slotWithRole("prev"), oldCurrent=slotWithRole("current"), oldNext=slotWithRole("next");
    // The art already showing in oldCurrent/oldNext is already
    // correct for their new roles — see the file header comment
    // above — so only their role/position changes; nothing is
    // repainted, which is what makes the next album glide into the
    // center instead of being swapped in.
    oldCurrent.role="prev"; oldCurrent.el.dataset.role="prev";
    oldNext.role="current"; oldNext.el.dataset.role="current";
    // state.currentTrack/queueIndex have already been advanced by
    // nextTrack()/completeCrossfadeHandoff() by the time this runs
    // (updateNowPlayingUI() below is called after that), so this is
    // "next after the new current" — exactly the new next slot.
    recycleSlotInstant(oldPrev, "next", peekNextEntry());
  } else {
    const oldPrev=slotWithRole("prev"), oldCurrent=slotWithRole("current"), oldNext=slotWithRole("next");
    oldCurrent.role="next"; oldCurrent.el.dataset.role="next";
    oldPrev.role="current"; oldPrev.el.dataset.role="current";
    recycleSlotInstant(oldNext, "prev", peekPrevEntry());
  }
}



// Refreshes every piece of "now playing" UI (title/artist/album,
// mini-player, cover art carousel) to match state.currentTrack.
function updateNowPlayingUI(){
  const t=state.currentTrack;
  if(!t) return;
  $("trackTitle").textContent=t.title;
  $("trackArtist").textContent=t.artist;
  $("trackAlbum").textContent=t.album;
  $("miniTitle").textContent=t.title;
  $("miniArtist").textContent=t.artist;

  // Consume navSwipeDir (set by nextTrack()/prevTrack()/the gapless
  // handoff — see just above nextTrack()) up front: only THIS update
  // gets to use it, so a later unrelated refresh doesn't replay a
  // stale rotation.
  const dir=navSwipeDir;
  navSwipeDir=null;

  const artURL=getTrackArtURL(t);
  $("miniArt").src = artURL || fallbackArt();

  // Requirement #14: keep the artwork move and the title/artist/
  // album text change perfectly in sync — both happen right here,
  // synchronously, in the same tick, so there's never a moment with
  // new text over old art (or vice versa). A real Next/Previous
  // rotates the existing prev/current/next slots into their new
  // roles (see rotateCarousel() above); anything else just repaints
  // all three fresh with no slide (syncCarouselStatic()).
  if(dir==="next" || dir==="prev"){
    rotateCarousel(dir);
  } else {
    syncCarouselStatic();
    replayMotion($("artWrap"),"track-change",360);
  }

  updateLoveButton();
  $("miniBar").style.display = state.currentTrack ? "flex" : "none";
  replayMotion(document.querySelector(".track-meta"),"track-change",300);
  replayMotion($("miniBar"),"track-change",260);
}



// Syncs the heart/"Love" button's active state with whether the
// current track is in Favorites.
function updateLoveButton(){
  const active = state.currentTrack && isInFavorites(state.currentTrack);
  $("loveBtn").classList.toggle("active",!!active);
}



/* ----------------------------------------------------------------
   LIQUID GLASS PLAY / PAUSE MORPH
   Builds two "rounded quad" glyphs — two bars for pause, a triangle
   for play — that share the exact same path command structure
   (M, Q,L,Q,L,Q,L,Q, Z) so they interpolate cleanly into each other,
   then morphs between them from updatePlayIcons() below whenever
   playback actually starts/stops.
   ---------------------------------------------------------------- */
function edgeLen(a,b){ return Math.hypot(b[0]-a[0], b[1]-a[1]); }

function roundedQuad(pts, r){
  const n=pts.length;
  const inPts=[], outPts=[];
  for(let i=0;i<n;i++){
    const prev=pts[(i-1+n)%n], curr=pts[i], next=pts[(i+1)%n];
    const lenPrev=edgeLen(prev,curr), lenNext=edgeLen(curr,next);
    const rIn = lenPrev<1e-6 ? 0 : Math.min(r, lenPrev/2);
    const rOut = lenNext<1e-6 ? 0 : Math.min(r, lenNext/2);
    const dirPrev = lenPrev<1e-6 ? [0,0] : [(curr[0]-prev[0])/lenPrev, (curr[1]-prev[1])/lenPrev];
    const dirNext = lenNext<1e-6 ? [0,0] : [(next[0]-curr[0])/lenNext, (next[1]-curr[1])/lenNext];
    inPts.push([curr[0]-dirPrev[0]*rIn, curr[1]-dirPrev[1]*rIn]);
    outPts.push([curr[0]+dirNext[0]*rOut, curr[1]+dirNext[1]*rOut]);
  }
  const f=v=>Math.round(v*100)/100;
  let d=`M${f(inPts[0][0])},${f(inPts[0][1])} `;
  for(let i=0;i<n;i++){
    d+=`Q${f(pts[i][0])},${f(pts[i][1])} ${f(outPts[i][0])},${f(outPts[i][1])} `;
    if(i<n-1){ const nxt=inPts[i+1]; d+=`L${f(nxt[0])},${f(nxt[1])} `; }
  }
  return d+'Z';
}

function buildD(quadA, quadB, r){ return roundedQuad(quadA,r)+' '+roundedQuad(quadB,r); }

// Rescales every number in a `d` string by k. Used to turn the glyphs'
// 0-100 design coordinates into the 0-1 fractional range an
// objectBoundingBox clipPath expects, so the glass clip always matches
// #playBtn's actual rendered size.
function scaleD(d, k){
  return d.replace(/-?\d+(\.\d+)?/g, m => (parseFloat(m)*k).toFixed(4));
}

const PLAY_GLYPH_R = 6;

// pause: two bars
const pauseGlyphD = buildD(
  [[30,24],[30,76],[42,76],[42,24]],
  [[58,24],[58,76],[70,76],[70,24]],
  PLAY_GLYPH_R
);

// play: left bar's outer corners collapse into a triangle tip — both
// converge on the *same* point (76,50) so the rounding on the top and
// bottom edges leading into the tip stays mirrored. The right bar
// collapses entirely into that same invisible point.
const playGlyphD = buildD(
  [[30,24],[30,76],[76,50],[76,50]],
  [[76,50],[76,50],[76,50],[76,50]],
  PLAY_GLYPH_R
);

function setPlayGlyph(d){
  $("glassClipPath").setAttribute("d", scaleD(d, 0.01));
  $("rimGlow").setAttribute("d", d);
  $("rimCrisp").setAttribute("d", d);
}

// initial paint — matches #playBtn's default "Play" state on load
setPlayGlyph(playGlyphD);



// Morphs the big liquid-glass button between "pause" and "play" glyphs,
// and swaps the mini-player's simple icon, to match whether audio is
// actually playing right now.
function updatePlayIcons(){
  const playing = !audioEl.paused && !audioEl.ended;

  setPlayGlyph(playing ? pauseGlyphD : playGlyphD);

  const playBtn=$("playBtn");
  playBtn.setAttribute("aria-pressed", String(playing));
  playBtn.setAttribute("aria-label", playing ? tr("player.pause") : tr("player.play"));

  const glassWrap=$("glassWrap");
  glassWrap.classList.remove("is-morphing");
  void glassWrap.offsetWidth; // restart the squish animation
  glassWrap.classList.add("is-morphing");

  $("miniPlayIcon").innerHTML = playing
    ? "<rect x='6' y='4' width='4' height='16'/><rect x='14' y='4' width='4' height='16'/>"
    : "<polygon points='6 3 20 12 6 21'/>";
}



// Shows/hides and sets the text of the new little "A"/"1" badge
// on the repeat button based on the current repeat mode. "A" means
// repeat-all is active; "1" means only the current song repeats;
// no badge at all means repeat is off.
function updateRepeatBadge(){
  const badge=$("repeatBadge");
  if(state.repeat==="all"){ badge.textContent="A"; badge.classList.add("show"); }
  else if(state.repeat==="one"){ badge.textContent="1"; badge.classList.add("show"); }
  else { badge.textContent=""; badge.classList.remove("show"); }
  if(badge.classList.contains("show")) replayMotion(badge,"badge-pop",380);
}



/* ================================================================
   PROGRESS
   Keeps the seek bar and time labels in sync with actual playback,
   and lets the user drag the seek bar to jump to a new position.
   ================================================================ */
audioEl.addEventListener("timeupdate",()=>{
  const cur=audioEl.currentTime, dur=audioEl.duration||state.currentTrack&&state.currentTrack.duration||0;
  $("curTime").textContent=fmtTime(cur);
  $("durTime").textContent=fmtTime(dur);
  const pct = dur ? (cur/dur)*1000 : 0;
  const seek=$("seek");
  seek.value=pct;
  seek.style.background=`linear-gradient(to right, var(--accent1) ${pct/10}%, var(--elevated) ${pct/10}%)`;
  if(state.lyricsOpen) syncLyrics(cur);
});
audioEl.addEventListener("play",updatePlayIcons);
audioEl.addEventListener("pause",updatePlayIcons);
audioEl.addEventListener("play",updateVisualizerState);
audioEl.addEventListener("pause",updateVisualizerState);

// PLAY PROGRESS (see the function definitions above, near recordPlay):
// accrue real listening time on every tick while playing, and break
// the delta chain on pause so the paused duration is never counted
// as listened time once playback resumes.
audioEl.addEventListener("timeupdate",trackPlayProgress);
audioEl.addEventListener("pause",()=>{ if(playProgress) playProgress.lastTs=null; });
// A track shorter than MIN_PLAY_SECONDS can never accrue enough
// listening time to cross the threshold via trackPlayProgress() alone —
// if it played all the way through, that's unambiguously a play, so
// credit it here instead. Registered BEFORE the "ended" listener below
// that advances to the next track — that listener can synchronously
// reset playProgress for the next track, so checking after it fired
// would mean reading the wrong track's state.
audioEl.addEventListener("ended",()=>{
  if(!playProgress || playProgress.registered) return;
  const t=state.currentTrack;
  if(!t || playProgress.trackId!==t.id) return;
  const dur=audioEl.duration;
  if(isFinite(dur) && dur>0 && dur<MIN_PLAY_SECONDS){
    playProgress.registered=true;
    recordPlay(t);
  }
});

// If a crossfade is already in flight when the primary track hits
// its natural end, hand off to the track that's already been fading
// in on fadeAudioEl instead of restarting it from 0 the normal way —
// see GAPLESS PLAYBACK above.
audioEl.addEventListener("ended",()=>{ if(crossfadeState) completeCrossfadeHandoff(); else nextTrack(true); });
// Gapless Playback: check on every tick whether it's time to start
// fading into the next track (see maybeStartCrossfade above), and
// keep the hidden fade partner in sync with manual pause/resume —
// otherwise a track paused mid-crossfade would keep quietly playing
// the *next* song in the background.
audioEl.addEventListener("timeupdate",maybeStartCrossfade);
audioEl.addEventListener("pause",()=>{ if(fadeAudioEl && crossfadeState) fadeAudioEl.pause(); });
audioEl.addEventListener("play",()=>{ if(fadeAudioEl && crossfadeState && fadeAudioEl.paused) fadeAudioEl.play().catch(()=>{}); });

// A track's <audio> src can fail to load if the real file behind it
// was moved, renamed, or deleted outside the app since it was added —
// see handleMissingTrack() up in the PLAYBACK section for what
// happens next. Path-backed tracks only: a blob:-backed track (plain
// web build, or a File that couldn't resolve to a real path) has its
// bytes already in memory and can't fail to load this way, so this
// is a no-op for those.
audioEl.addEventListener("error",()=>{
  const t=state.currentTrack;
  if(!t || !t.filePath) return;
  handleMissingTrack(t);
});

$("seek").addEventListener("input",(e)=>{
  const dur=audioEl.duration||0;
  audioEl.currentTime=(e.target.value/1000)*dur;
});

// Left/Right arrow keys (no Ctrl held) — see the keyboard shortcuts
// in bindEvents. Jumps the current track backward/forward by
// `seconds`, clamped so it can't go negative or past the end.
function seekBy(seconds){
  if(!state.currentTrack) return;
  const dur=audioEl.duration||state.currentTrack.duration||0;
  audioEl.currentTime=Math.min(Math.max(0,audioEl.currentTime+seconds), dur||Infinity);
}



/* ================================================================
   VOLUME
   Keeps audioEl.volume, the vertical slider's fill/thumb, the "NN%"
   label, and the speaker icon glyph all in sync, and persists the
   chosen level + mute flag to IndexedDB (the same "settings"
   key/value store already used for theme/playerBg/language — see
   INIT above for the restore side of this) so it survives a
   restart.
   ================================================================ */

// Pushes state.volume/state.muted onto the real <audio> element and
// repaints the UI to match. Called after anything changes either
// field, and once at startup right after the saved level is
// restored (see init()).
function applyVolume(){
  cancelCrossfade(); // a manual volume/mute change always wins over an in-flight gapless fade's own volume ramp — see GAPLESS PLAYBACK above
  audioEl.volume = state.muted ? 0 : state.volume;
  updateVolumeUI();
}

// Purely visual — repaints the slider's fill + thumb position, the
// percentage label (or "Muted"), and swaps the speaker icon between
// muted/low/high glyphs. Never touches audioEl.volume itself;
// applyVolume() above is what actually does that.
function updateVolumeUI(){
  const level=state.muted ? 0 : state.volume;
  const pct=Math.round(level*100);

  volumeSlider.value=pct;
  // Same "paint the fill up to the current value, everything past
  // it plain elevated" trick #seek uses in the timeupdate listener
  // above — "to right" here becomes "bottom-to-top" once the
  // -90deg-rotated slider (see styles.css) turns it sideways.
  volumeSlider.style.background=`linear-gradient(to right, var(--accent1) ${pct}%, var(--elevated) ${pct}%)`;
  volumePct.textContent = state.muted ? tr("player.muted") : `${pct}%`;

  const speaker='<polygon points="4 9 8 9 12 5 12 19 8 15 4 15" fill="currentColor" stroke="none"/>';
  let waves;
  if(level<=0) waves='<line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/>';       // muted: an "X" instead of sound waves
  else if(level<0.5) waves='<path d="M16 8a5 5 0 0 1 0 8"/>';                                              // quiet: one wave arc
  else waves='<path d="M16 8a5 5 0 0 1 0 8"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';                          // loud: two wave arcs
  volumeIcon.innerHTML=speaker+waves;
}

// Saves the current level + mute flag so it's still set next launch.
function persistVolume(){
  idbPut("settings",{key:"volume",value:{level:state.volume, muted:state.muted}}).catch(()=>{});
}

// Slider drags and ArrowUp/ArrowDown both funnel through here.
// Raising the level off zero while muted always un-mutes first —
// same as every other player, since otherwise dragging the slider
// up while muted would visibly move but silently do nothing.
function setVolume(level){
  state.volume=Math.min(1,Math.max(0,level));
  if(state.muted && state.volume>0) state.muted=false;
  applyVolume();
  persistVolume();
}

// ArrowUp/ArrowDown: nudges the level by `delta` (positive or
// negative) starting from 0 if currently muted, so raising the
// volume from a muted state starts from silence rather than
// jumping back to whatever it was before muting. Also briefly shows
// the popup so the percentage is visible even though nothing was
// clicked — see showVolumeOSD() below.
function adjustVolume(delta){
  setVolume((state.muted?0:state.volume)+delta);
  showVolumeOSD();
}

// Reuses the same popup as the speaker-icon click, just auto-hides
// itself a moment later instead of waiting for an outside click —
// same idea as the volume overlay every OS shows when you tap a
// hardware volume key. Repeated key presses (holding Up/Down) keep
// resetting the timer, so it only disappears once you actually stop.
let volumeOSDTimer=null;
function showVolumeOSD(){
  openVolumePopup();
  clearTimeout(volumeOSDTimer);
  volumeOSDTimer=setTimeout(closeVolumePopup,1400);
}

// The M key. Flips state.muted without touching the remembered
// level, so unmuting restores exactly where the slider was.
function toggleMute(){
  state.muted=!state.muted;
  applyVolume();
  persistVolume();
}

// Same open/close/toggle pattern as the Info/Edit side dropdown
// (see toggleSideDropdown/openSideDropdown/closeSideDropdown above
// it) — click the speaker icon to reveal the vertical slider, click
// anywhere else (or the icon again) to close it.
function toggleVolumePopup(){
  if(volumePopup.classList.contains("hidden")) openVolumePopup();
  else closeVolumePopup();
}
function openVolumePopup(){
  const wasHidden=volumePopup.classList.contains("hidden");
  showWithMotion(volumePopup);
  if(wasHidden){
    setTimeout(()=>document.addEventListener("click",closeVolumePopup,{once:true}),0);
  }
}
function closeVolumePopup(){
  hideWithMotion(volumePopup);
}



/* ================================================================
   LYRICS
   Fetches time-synced (or plain) lyrics from the free lrclib.net
   API, caches them (in memory + IndexedDB) so we never re-fetch
   the same song twice, and highlights the current line as the
   song plays.
   ================================================================ */

// Parses the ".lrc" synced-lyrics format ("[mm:ss.xx]some words")
// into an array of {time, text} objects sorted by time.
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
    if(!matched && text) { /* skip metadata-only lines without timestamp */ }
  }
  return out.sort((a,b)=>a.time-b.time);
}



// Removes any "(...)" parenthetical from a title — e.g. "Song Title
// (Remastered 2011)" -> "Song Title" — used as a fallback query when
// the exact title returns no matches, since bracketed extras like
// "(Live)", "(Remastered)", "(feat. X)" etc. are often not how the
// track is actually tagged on lrclib.net.
function stripParens(title){
  return title.replace(/\([^)]*\)/g,"").replace(/\s{2,}/g," ").trim();
}

// Does a single lrclib.net search for the given title/artist. Returns
// parsed {time,text} lines (synced if available, else plain), or
// null if nothing usable came back.
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

// Fetches (and caches) lyrics for a track. Checks the in-memory
// cache first, then IndexedDB, and only hits the network as a
// last resort. Tries the title as-is first; if that comes back
// empty, retries once with any "(...)" part stripped out of the
// title (e.g. "(Remastered 2011)", "(Live)"), since that's often
// what's tripping up the lookup. Returns null if no lyrics could
// be found either way.
//
// IMPORTANT: only a *successful* lookup (lines truthy) gets written
// into state.lyricsCache / IndexedDB. A "not found" result is never
// cached — so it's never mistaken for "already checked, nothing
// there". That means every time the user opens the lyrics pane for
// a track that previously came back empty, this runs the search
// again instead of just replaying the old miss. If it starts
// finding lyrics online later, or the lyrics get corrected on
// lrclib.net, the next click just picks that up.
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



// Hides the lyrics overlay and un-highlights the Lyrics button.
function closeLyrics(){
  state.lyricsOpen=false;
  $("lyricsPane").classList.add("hidden");
  $("lyricsBtn").classList.remove("active");
  $("artWrap").classList.remove("lyrics-active");
}



// Toggles the lyrics overlay open/closed. When opening, shows a
// loading message, fetches the lyrics, then renders either:
//   - a single empty "current phrase" element that syncLyrics()
//     fills in and updates as the song plays (synced lyrics), or
//   - the full plain text as a fallback (no timestamps to sync to)
async function toggleLyrics(){
  if(!state.currentTrack) return;
  if(state.lyricsOpen){ closeLyrics(); return; }
  state.lyricsOpen=true;
  state.lastLyricIdx=-2;               // force syncLyrics to (re)render on first tick
  $("lyricsBtn").classList.add("active");
  $("artWrap").classList.add("lyrics-active");
  const pane=$("lyricsPane");
  pane.classList.remove("hidden");
  pane.innerHTML=`<div class='lyric-status'>${escapeHTML(tr("lyrics.loading"))}</div>`;
  const lines=await fetchLyricsFor(state.currentTrack);
  if(!state.lyricsOpen) return; // closed while loading
  if(!lines || !lines.length){
    pane.innerHTML=`<div class='lyric-status'>${escapeHTML(tr("lyrics.notFoundShort"))}</div>`;
    return;
  }
  if(lines[0].time===null){
    // No per-line timestamps came back, so there's nothing to
    // sync a single phrase to — show the whole lyric text instead.
    pane.innerHTML=`<div class="lyric-plain">${escapeHTML(lines.map(l=>l.text||"").join("\n"))}</div>`;
    return;
  }
  pane.innerHTML='<div class="lyric-current"></div>';
  syncLyrics(audioEl.currentTime);
}



// Figures out which lyric line matches the current playback time
// and, if it's changed since the last tick, swaps the single
// "now singing" phrase in place (fading/lifting it out and the
// new line back in). Does nothing for plain (un-timed) lyrics,
// since there's nothing to sync to.
function syncLyrics(cur){
  const trackId=state.currentTrack&&state.currentTrack.id;
  const lines=state.lyricsCache[trackId];
  if(!lines || !lines.length || lines[0].time===null) return;
  // Manual per-track nudge from the Sync Lyrics modal, in ms:
  // positive delays the lyrics (shows each line later), negative
  // shows them earlier. Subtracting it from "cur" before matching
  // is what achieves that — a bigger offset means less time has
  // "effectively" passed, so earlier lines stay on screen longer.
  const offsetSec=(state.lyricOffsets[trackId]||0)/1000;
  const adjustedCur=cur-offsetSec;
  let activeIdx=-1;
  for(let i=0;i<lines.length;i++){ if(lines[i].time<=adjustedCur) activeIdx=i; else break; }
  if(activeIdx===state.lastLyricIdx) return; // same line as before, nothing to update
  state.lastLyricIdx=activeIdx;

  const curEl=$("lyricsPane").querySelector(".lyric-current");
  if(!curEl) return;
  const text=activeIdx>=0 ? (lines[activeIdx].text || "♪") : "";
  curEl.classList.add("swap");
  setTimeout(()=>{
    curEl.textContent=text;
    // Force a reflow so removing "swap" immediately after actually
    // re-triggers the CSS transition instead of being batched away.
    void curEl.offsetWidth;
    curEl.classList.remove("swap");
  },160);
}



/* ================================================================
   NAV RAIL: expand/collapse + Settings / About Us
   The "☰" button at the top of the far-left icon rail toggles the
   "rail-expanded" class on #appRoot. That one class is all the CSS
   needs (see .rail / .rail-label / .app.rail-expanded in the
   stylesheet) to widen the rail's grid column and fade each
   section's text label into view next to its icon. Settings/About
   Us reuse the same shared modal (openModal/closeModal) as the
   Info/Edit side menu below.
   ================================================================ */

function toggleRail(){
  $("appRoot").classList.toggle("rail-expanded");
}

/* ================================================================
   THEME
   Two independent choices — an app background (bg) and an accent
   color (accent) — each just a small lookup of CSS variable values
   that get pushed onto :root when chosen. Everything else in the
   stylesheet already reads from these same variables (--bg,
   --panel, --accent1, etc.), so flipping them here is all it takes
   to reskin the whole app. Theme choice lives only in memory for
   this session (state.theme), matching how the rest of the app's
   data already works.
   ================================================================ */
const THEME_BG={
  dark:{
    label:"GitHub Black", swatch:"#0c0c11",
    vars:{"--bg":"#0c0c11","--panel":"#131319","--elevated":"#1c1c25","--elevated-hover":"#24242f",
          "--border":"#232330","--text":"#f2f2f6","--text-dim":"#96969f","--text-faint":"#5c5c66"}
  },
  light:{
    label:"Light", swatch:"#f2efe9",
    vars:{"--bg":"#f2efe9","--panel":"#fbfaf7","--elevated":"#ece8e0","--elevated-hover":"#e2ddd2",
          "--border":"#dcd6c9","--text":"#211f1c","--text-dim":"#6e6a62","--text-faint":"#a09a8d"}
  },
  pitchblack:{
    label:"Pitch Black", swatch:"#000000",
    vars:{"--bg":"#000000","--panel":"#000000","--elevated":"#141414","--elevated-hover":"#1e1e1e",
          "--border":"#242424","--text":"#f2f2f6","--text-dim":"#96969f","--text-faint":"#5c5c66"}
  },
  midnight:{
    label:"Deep Midnight Blue", swatch:"#0b1324",
    vars:{"--bg":"#0b1324","--panel":"#0e192d","--elevated":"#15233b","--elevated-hover":"#1b2c48",
          "--border":"#223653","--text":"#edf4ff","--text-dim":"#a4b2c8","--text-faint":"#677892"}
  },
  graphite:{
    label:"Graphite Gray", swatch:"#1b1d20",
    vars:{"--bg":"#1b1d20","--panel":"#202226","--elevated":"#292c31","--elevated-hover":"#34383e",
          "--border":"#3b3f46","--text":"#f1f2f4","--text-dim":"#afb2b8","--text-faint":"#777b83"}
  },
  forest:{
    label:"Forest Green", swatch:"#10231d",
    vars:{"--bg":"#10231d","--panel":"#142b23","--elevated":"#1b382d","--elevated-hover":"#244737",
          "--border":"#305343","--text":"#edf7f0","--text-dim":"#a7c0b0","--text-faint":"#6f8d7c"}
  }
};

const THEME_ACCENT={
  blue:  {label:"Blue",   a1:"#5865f2", a2:"#8a5cf6", rgb:"88,101,242"},
  red:   {label:"Red",    a1:"#ef4444", a2:"#f87171", rgb:"239,68,68"},
  orange:{label:"Orange", a1:"#f97316", a2:"#fb923c", rgb:"249,115,22"},
  green: {label:"Green",  a1:"#22c55e", a2:"#4ade80", rgb:"34,197,94"},
  purple:{label:"Purple", a1:"#a855f7", a2:"#c084fc", rgb:"168,85,247"},
  yellow:{label:"Yellow", a1:"#eab308", a2:"#facc15", rgb:"234,179,8"},
  pink:  {label:"Pink",   a1:"#ec4899", a2:"#f472b6", rgb:"236,72,153"},
  teal:  {label:"Teal",   a1:"#14b8a6", a2:"#2dd4bf", rgb:"20,184,166"},
  indigo:{label:"Indigo", a1:"#6366f1", a2:"#818cf8", rgb:"99,102,241"},
  cyan:  {label:"Cyan",   a1:"#06b6d4", a2:"#22d3ee", rgb:"6,182,212"},
  lime:  {label:"Lime",   a1:"#84cc16", a2:"#a3e635", rgb:"132,204,22"},
  rose:  {label:"Rose",   a1:"#f43f5e", a2:"#fb7185", rgb:"244,63,94"}
};

// Pushes the currently-chosen bg + accent onto :root as CSS
// variables. Called once on startup and again every time either
// choice changes in the Settings modal.
function applyTheme(){
  const bg=THEME_BG[state.theme.bg]||THEME_BG.pitchblack;
  const ac=THEME_ACCENT[state.theme.accent]||THEME_ACCENT.blue;
  const root=document.documentElement.style;
  Object.entries(bg.vars).forEach(([k,v])=>root.setProperty(k,v));
  root.setProperty("--accent1",ac.a1);
  root.setProperty("--accent2",ac.a2);
  root.setProperty("--accent1-rgb",ac.rgb);
  syncNativeTitleBar(bg.vars["--bg"]);
}

function syncNativeTitleBar(backgroundColor){
  if(!(window.electronAPI && window.electronAPI.setTitleBarAppearance)) return;
  const hex=String(backgroundColor||"").replace("#","");
  const normalized=hex.length===3 ? hex.split("").map(c=>c+c).join("") : hex;
  if(!/^[0-9a-fA-F]{6}$/.test(normalized)) return;
  const red=parseInt(normalized.slice(0,2),16);
  const green=parseInt(normalized.slice(2,4),16);
  const blue=parseInt(normalized.slice(4,6),16);
  const luminance=(red*299+green*587+blue*114)/1000;
  window.electronAPI.setTitleBarAppearance("#"+normalized, luminance>160 ? "#1b1b1b" : "#f2f2f6").catch(()=>{});
}

// Switches the background or accent choice, re-applies the theme,
// and re-renders the swatch rows so the checkmark jumps to the new
// selection (the Settings modal is left open while this happens).
function setThemeBg(name){ state.theme.bg=name; applyTheme(); renderThemeSwatches(); saveTheme(); }
function setThemeAccent(name){ state.theme.accent=name; applyTheme(); renderThemeSwatches(); saveTheme(); }

// Persists the current theme choice to IndexedDB so it's still
// applied next time the app is opened. Also mirrors just the bg/accent
// keys into localStorage — a synchronous cache that theme-boot.js
// (see index.html <head>) reads before first paint next launch, since
// IndexedDB itself can't be read that early. IndexedDB stays the real
// source of truth; this is purely a startup head-start.
function saveTheme(){
  idbPut("settings",{key:"theme",value:state.theme});
  cacheThemeForNextBoot();
}

function cacheThemeForNextBoot(){
  try{
    localStorage.setItem("playnck-theme-cache", JSON.stringify({bg:state.theme.bg, accent:state.theme.accent}));
  }catch(e){ /* private-browsing quota or similar — theme still works, just no head start next launch */ }
}

// Paints (or clears) the custom background image behind the
// now-playing panel and dials in its blur amount. #playerBg is a
// plain absolutely-positioned layer sitting behind everything else
// in .player-panel (see the CSS) — this just points its
// background-image at the stored data URL and sets the blur var.
// Safe to call before the panel exists in the DOM (init() calls it
// before the first render).
function applyPlayerBg(){
  const layer=$("playerBg");
  if(!layer) return;
  if(state.playerBg.image){
    layer.style.backgroundImage=`url("${state.playerBg.image}")`;
    layer.classList.remove("hidden");
  } else {
    layer.style.backgroundImage="none";
    layer.classList.add("hidden");
  }
  document.documentElement.style.setProperty("--player-bg-blur",state.playerBg.blur+"px");
}

// Reads a File the user picked, converts it to a data URL (so it
// can be stashed in IndexedDB and survive a restart same as
// everything else here), applies it immediately, and persists it.
function setPlayerBgImage(file){
  if(!file || !file.type.startsWith("image/")) return;
  const reader=new FileReader();
  reader.onload=()=>{
    state.playerBg.image=reader.result;
    applyPlayerBg();
    savePlayerBg();
    refreshPlayerBgUI();
  };
  reader.readAsDataURL(file);
}

// Clears the custom background back to the plain panel gradient.
function clearPlayerBgImage(){
  state.playerBg.image=null;
  applyPlayerBg();
  savePlayerBg();
  refreshPlayerBgUI();
}

// Live-updates the blur amount as the slider is dragged.
function setPlayerBgBlur(px){
  state.playerBg.blur=Math.max(0,Math.min(20,Number(px)||0));
  applyPlayerBg();
  savePlayerBg();
}

// Persists the current image + blur to IndexedDB so it's still
// there next time the app opens.
function savePlayerBg(){ idbPut("settings",{key:"playerBg",value:state.playerBg}); }

// Re-draws just the Player section's preview thumbnail / empty
// state / remove button in place, without rebuilding the whole
// Settings modal — mirrors refreshUpdateUI() below.
function refreshPlayerBgUI(){
  const preview=$("playerBgPreview");
  if(!preview) return; // Settings modal (or Player section) isn't open right now
  preview.innerHTML=playerBgPreviewHTML();
  const removeBtn=$("playerBgRemoveBtn");
  if(removeBtn) removeBtn.disabled=!state.playerBg.image;
}

// Re-draws just the active/checkmark state of the swatch buttons
// already in the DOM, without rebuilding the whole modal.
function renderThemeSwatches(){
  const bgRow=$("bgSwatchRow"), accentRow=$("accentSwatchRow");
  if(!bgRow||!accentRow) return;
  bgRow.querySelectorAll(".swatch-btn").forEach(b=>b.classList.toggle("active",b.dataset.bg===state.theme.bg));
  accentRow.querySelectorAll(".swatch-btn").forEach(b=>b.classList.toggle("active",b.dataset.accent===state.theme.accent));
}

// Small chevron icon reused by every accordion header — rotates
// 180° via CSS when its parent .accordion-item gets the "open"
// class (see toggleAccordionItem below).
const ACCORDION_CHEVRON_SVG=`<svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

// Builds one collapsible row of the Settings accordion: a clickable
// header (label + chevron) and a body that's collapsed by default.
// bodyHTML is whatever that section should show once expanded.
function accordionItem(id,label,bodyHTML){
  return `
    <div class="accordion-item" id="acc-${id}">
      <button class="accordion-header" data-acc="${id}">
        <span>${escapeHTML(label)}</span>
        ${ACCORDION_CHEVRON_SVG}
      </button>
      <div class="accordion-body">
        <div class="accordion-body-inner">${bodyHTML}</div>
      </div>
    </div>`;
}

// Expands/collapses one accordion section in place. Other sections
// are left exactly as they were — this app doesn't force a
// single-open-at-a-time behavior, so switching between Theme/Audio/
// Player never loses whichever one you already had open.
function toggleAccordionItem(id){
  const item=$("acc-"+id);
  if(item) item.classList.toggle("open");
}

// Maps the last "update-status" event from main.js (state.updateInfo)
// into what the Settings > Updates section should show right now: the
// status dot's color/pulse state, the line of text next to it, the
// action button's label, whether that button is disabled, and what it
// should do when clicked. Centralized here so both the initial modal
// build (updatesBodyHTML) and any later live refresh (refreshUpdateUI,
// since an update can land while Settings happens to already be open)
// draw from exactly the same logic.
function updateSectionView(){
  const info=state.updateInfo||{state:"idle"};
  const version=state.appVersion?`v${state.appVersion}`:"";
  switch(info.state){
    case "checking":
      return {dot:"checking",text:tr("updates.checking"),btn:tr("updates.checkingBtn"),disabled:true,action:null};
    case "available":
      return {dot:"available",text:tr("updates.foundDownloading",{version:info.version||"?"}),btn:tr("updates.downloadingBtn"),disabled:true,action:null};
    case "downloading":
      return {dot:"downloading",text:tr("updates.downloading")+(info.percent!=null?" "+info.percent+"%":""),btn:tr("updates.downloadingBtn"),disabled:true,action:null};
    case "downloaded":
      return {dot:"downloaded",text:tr("updates.readyRestart",{version:info.version||"?"}),btn:tr("updates.restartInstall"),disabled:false,action:"install"};
    case "up-to-date":
      return {dot:"up-to-date",text:tr("updates.upToDate")+(version?" ("+version+")":""),btn:tr("updates.checkForUpdates"),disabled:false,action:"check"};
    case "error":
      return {dot:"error",text:info.message||tr("updates.couldntCheck"),btn:tr("updates.tryAgain"),disabled:false,action:"check"};
    default:
      return {dot:"idle",text:version?tr("updates.running",{version}):"",btn:tr("updates.checkForUpdates"),disabled:false,action:"check"};
  }
}

// Builds the Updates accordion body. On a non-Electron build (plain
// web, a future Android wrapper) window.electronAPI.checkForUpdates
// won't exist, so this falls back to a plain placeholder matching the
// other not-yet-wired sections instead of showing a dead button.
function updatesBodyHTML(){
  if(!(window.electronAPI && window.electronAPI.checkForUpdates)){
    return `<p class="info-empty">${escapeHTML(tr("updates.onlyDesktop"))}</p>`;
  }
  const v=updateSectionView();
  return `
    <div class="update-section">
      <div class="update-status-row">
        <span class="update-dot" id="updateDot" data-state="${v.dot}"></span>
        <span class="update-status-text" id="updateStatusText">${escapeHTML(v.text)}</span>
      </div>
      <button type="button" class="edit-save-btn update-check-btn" id="updateActionBtn"${v.disabled?" disabled":""}>${escapeHTML(v.btn)}</button>
    </div>`;
}

// Re-draws just the dot/text/button of the Updates section in place,
// without rebuilding the whole Settings modal — used right after a
// manual "Check for Updates" click, and whenever a live update-status
// event arrives from main.js while Settings happens to already be
// open. Safely does nothing if the modal (or this section) isn't
// currently in the DOM.
function refreshUpdateUI(){
  const dot=$("updateDot"), text=$("updateStatusText"), btn=$("updateActionBtn");
  if(!dot||!text||!btn) return;
  const v=updateSectionView();
  dot.dataset.state=v.dot;
  text.textContent=v.text;
  btn.textContent=v.btn;
  btn.disabled=!!v.disabled;
}

// Handles the Updates section's single action button, which means
// one of two different things depending on current state: kick off a
// fresh check, or (once state:"downloaded" has been reached) install
// the update that's already sitting there ready to go.
async function onUpdateActionClick(){
  const v=updateSectionView();
  if(v.action==="install"){
    window.electronAPI.installUpdateNow();
    return;
  }
  if(v.action!=="check") return; // mid check/download already — button is disabled, but guard anyway
  state.updateInfo={state:"checking"};
  refreshUpdateUI();
  const result=await window.electronAPI.checkForUpdates();
  if(result && result.started===false){
    state.updateInfo={state:"error",message:result.reason||tr("updates.couldntCheck")};
    refreshUpdateUI();
  }
  // On success, further state (available/downloading/downloaded/
  // up-to-date) arrives via the onUpdateStatus subscription in init().
}

// Small thumbnail (or empty placeholder) shown next to the Choose/
// Remove buttons in Settings > Player, reflecting whatever's
// currently saved in state.playerBg.image.
function playerBgPreviewHTML(){
  return state.playerBg.image
    ? `<img src="${state.playerBg.image}" alt="Background preview">`
    : `<div class="player-bg-preview-empty">${escapeHTML(tr("settings.noImage"))}</div>`;
}

// Builds the Settings > Backup & Restore accordion body. Electron-
// only (needs a native Save/Open dialog — see saveTextFile/
// openTextFile in preload.js), same reasoning as updatesBodyHTML.
function backupBodyHTML(){
  if(!(window.electronAPI && window.electronAPI.saveTextFile)){
    return `<p class="info-empty">${escapeHTML(tr("backup.desktopOnly"))}</p>`;
  }
  return `
    <div class="update-section">
      <p class="theme-note">${escapeHTML(tr("backup.note"))}</p>
      <div class="backup-actions">
        <button type="button" class="edit-save-btn" id="backupExportBtn">${escapeHTML(tr("backup.exportBtn"))}</button>
        <button type="button" class="amr-add-btn" id="backupImportBtn">${escapeHTML(tr("backup.importBtn"))}</button>
      </div>
      <p class="update-status-text" id="backupStatusText"></p>
    </div>`;
}

// Builds the Settings modal body: a stack of collapsible sections
// (Theme, Updates, Audio, Player, Language) — clicking a header
// reveals that section's controls underneath it. Audio/Language
// are placeholders ready for whatever gets added next.
function openSettingsModal(){
  const bgSwatches=Object.entries(THEME_BG).map(([key,cfg])=>
    `<button class="swatch-btn bg-swatch${key==="light"?" on-light":""}${state.theme.bg===key?" active":""}" data-bg="${key}" style="background:${cfg.swatch}" title="${escapeHTML(themeBgLabel(key))}"></button>`
  ).join("");
  const accentSwatches=Object.entries(THEME_ACCENT).map(([key,cfg])=>
    `<button class="swatch-btn${state.theme.accent===key?" active":""}" data-accent="${key}" style="background:${cfg.a1}" title="${escapeHTML(themeAccentLabel(key))}"></button>`
  ).join("");

  const themeBodyHTML=`
    <div class="theme-picker">
      <div>
        <div class="theme-group-label">${escapeHTML(tr("settings.appBackground"))}</div>
        <div class="swatch-row" id="bgSwatchRow">${bgSwatches}</div>
      </div>
      <div>
        <div class="theme-group-label">${escapeHTML(tr("settings.accentColor"))}</div>
        <div class="swatch-row" id="accentSwatchRow">${accentSwatches}</div>
      </div>
      <p class="theme-note">${escapeHTML(tr("settings.themeNote"))}</p>
    </div>`;

  const eqBandsHTML=EQ_BANDS.map((band,i)=>{
    const gain=state.eq.gains[i]||0;
    return `
      <div class="eq-band">
        <span class="eq-band-value" id="eqBandValue${i}">${gain>0?"+":""}${gain}</span>
        <div class="eq-band-wrap"><input type="range" class="eq-band-slider" min="-12" max="12" step="1" value="${gain}" data-band="${i}"></div>
        <span class="eq-band-freq">${formatEqFreq(band.freq)}</span>
      </div>`;
  }).join("");

  const audioBodyHTML=`
    <div class="audio-settings">
      <div class="settings-toggle-row">
        <div class="settings-toggle-label">
          <div class="theme-group-label">${escapeHTML(tr("audio.equalizer"))}</div>
          <p class="theme-note">${escapeHTML(tr("audio.equalizerNote"))}</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="eqEnabledToggle"${state.eq.enabled?" checked":""}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="eq-controls${state.eq.enabled?"":" disabled"}" id="eqControls">
        <div class="eq-presets" id="eqPresetRow">
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="flat">${escapeHTML(tr("audio.eqFlat"))}</button>
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="bassBoost">${escapeHTML(tr("audio.eqBassBoost"))}</button>
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="trebleBoost">${escapeHTML(tr("audio.eqTrebleBoost"))}</button>
          <button type="button" class="amr-add-btn eq-preset-btn" data-preset="vocalBoost">${escapeHTML(tr("audio.eqVocalBoost"))}</button>
        </div>
        <div class="eq-bands-row" id="eqBandsRow">${eqBandsHTML}</div>
      </div>

      <div class="settings-toggle-row settings-toggle-row-divider">
        <div class="settings-toggle-label">
          <div class="theme-group-label">${escapeHTML(tr("audio.gapless"))}</div>
          <p class="theme-note">${escapeHTML(tr("audio.gaplessNote"))}</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="gaplessEnabledToggle"${state.gapless.enabled?" checked":""}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>`;
  const playerBodyHTML=`
    <div class="player-bg-settings">
      <div class="theme-group-label">${escapeHTML(tr("settings.nowPlayingBgImage"))}</div>
      <div class="player-bg-row">
        <div class="player-bg-preview" id="playerBgPreview">${playerBgPreviewHTML()}</div>
        <div class="player-bg-actions">
          <button type="button" class="edit-save-btn" id="playerBgChooseBtn">${escapeHTML(tr("settings.chooseImage"))}</button>
          <button type="button" class="amr-add-btn" id="playerBgRemoveBtn"${state.playerBg.image?"":" disabled"}>${escapeHTML(tr("settings.remove"))}</button>
          <input type="file" id="playerBgFileInput" accept="image/*" class="hidden">
        </div>
      </div>
      <div class="player-bg-blur-row">
        <div class="theme-group-label">${escapeHTML(tr("settings.blur"))}</div>
        <div class="player-bg-blur-control">
          <input type="range" id="playerBgBlurSlider" min="0" max="20" step="1" value="${state.playerBg.blur}">
          <span class="player-bg-blur-value" id="playerBgBlurValue">${state.playerBg.blur}px</span>
        </div>
      </div>
      <p class="theme-note">${escapeHTML(tr("settings.playerBgNote"))}</p>

      <div class="settings-toggle-row settings-toggle-row-divider">
        <div class="settings-toggle-label">
          <div class="theme-group-label">${escapeHTML(tr("player.visualizer"))}</div>
          <p class="theme-note">${escapeHTML(tr("player.visualizerNote"))}</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="visualizerEnabledToggle"${state.visualizer.enabled?" checked":""}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="player-bg-blur-row visualizer-opacity-row${state.visualizer.enabled?"":" disabled"}" id="visualizerOpacityRow">
        <div class="theme-group-label">${escapeHTML(tr("player.visualizerOpacity"))}</div>
        <div class="player-bg-blur-control">
          <input type="range" id="visualizerOpacitySlider" min="0" max="2" step="0.05" value="${state.visualizer.intensity}">
          <span class="player-bg-blur-value" id="visualizerOpacityValue">${Math.round(state.visualizer.intensity*100)}%</span>
        </div>
      </div>
    </div>`;
  const languageBodyHTML=buildLanguageBodyHTML();

  const bodyHTML=`
    <div class="settings-accordion">
      ${accordionItem("theme",tr("settings.theme"),themeBodyHTML)}
      ${accordionItem("updates",tr("settings.updates"),updatesBodyHTML())}
      ${accordionItem("audio",tr("settings.audio"),audioBodyHTML)}
      ${accordionItem("player",tr("settings.player"),playerBodyHTML)}
      ${accordionItem("backup",tr("settings.backup"),backupBodyHTML())}
      ${accordionItem("language",tr("settings.language"),languageBodyHTML)}
    </div>`;

  openModal(tr("nav.settings"), bodyHTML);

  document.querySelectorAll(".accordion-header").forEach(btn=>{
    btn.addEventListener("click",()=>toggleAccordionItem(btn.dataset.acc));
  });
  $("bgSwatchRow").querySelectorAll(".swatch-btn").forEach(btn=>{
    btn.addEventListener("click",()=>setThemeBg(btn.dataset.bg));
  });
  $("accentSwatchRow").querySelectorAll(".swatch-btn").forEach(btn=>{
    btn.addEventListener("click",()=>setThemeAccent(btn.dataset.accent));
  });
  if(window.electronAPI && window.electronAPI.checkForUpdates){
    $("updateActionBtn").addEventListener("click",onUpdateActionClick);
  }

  const playerBgFileInput=$("playerBgFileInput");
  $("playerBgChooseBtn").addEventListener("click",()=>playerBgFileInput.click());
  playerBgFileInput.addEventListener("change",()=>{
    const file=playerBgFileInput.files && playerBgFileInput.files[0];
    if(file) setPlayerBgImage(file);
    playerBgFileInput.value=""; // lets picking the exact same file again still fire "change"
  });
  $("playerBgRemoveBtn").addEventListener("click",clearPlayerBgImage);
  const blurSlider=$("playerBgBlurSlider");
  blurSlider.addEventListener("input",()=>{
    $("playerBgBlurValue").textContent=blurSlider.value+"px";
    setPlayerBgBlur(blurSlider.value);
  });

  $("languageChipRow").querySelectorAll(".lang-chip").forEach(btn=>{
    btn.addEventListener("click",()=>setLanguage(btn.dataset.lang));
  });
  const addLangBtn=$("addLanguageBtn");
  if(addLangBtn) addLangBtn.addEventListener("click",addLanguage);

  // --- Settings > Audio: Equalizer ---
  $("eqEnabledToggle").addEventListener("change",(e)=>{
    state.eq.enabled=e.target.checked;
    ensureAudioGraph();
    applyEqGains();
    saveEqSettings();
    $("eqControls").classList.toggle("disabled",!state.eq.enabled);
  });
  $("eqPresetRow").querySelectorAll(".eq-preset-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const preset=EQ_PRESETS[btn.dataset.preset];
      if(!preset) return;
      state.eq.gains=preset.slice();
      ensureAudioGraph();
      applyEqGains();
      saveEqSettings();
      $("eqBandsRow").querySelectorAll(".eq-band-slider").forEach((slider,i)=>{
        slider.value=state.eq.gains[i];
        const valEl=$("eqBandValue"+i);
        if(valEl) valEl.textContent=(state.eq.gains[i]>0?"+":"")+state.eq.gains[i];
      });
    });
  });
  $("eqBandsRow").querySelectorAll(".eq-band-slider").forEach(slider=>{
    const i=Number(slider.dataset.band);
    slider.addEventListener("input",()=>{
      state.eq.gains[i]=Number(slider.value);
      const valEl=$("eqBandValue"+i);
      if(valEl) valEl.textContent=(state.eq.gains[i]>0?"+":"")+state.eq.gains[i];
      ensureAudioGraph();
      applyEqGains();
    });
    slider.addEventListener("change",saveEqSettings); // persist once per drag, not on every tick
  });

  // --- Settings > Audio: Gapless Playback ---
  $("gaplessEnabledToggle").addEventListener("change",(e)=>{
    state.gapless.enabled=e.target.checked;
    if(!state.gapless.enabled) cancelCrossfade();
    idbPut("settings",{key:"gapless", value:{enabled:state.gapless.enabled}}).catch(()=>{});
  });

  // --- Settings > Player: Visualizer ---
  $("visualizerEnabledToggle").addEventListener("change",(e)=>{
    state.visualizer.enabled=e.target.checked;
    saveVisualizerSettings();
    updateVisualizerState();
    const opacityRow=$("visualizerOpacityRow");
    if(opacityRow) opacityRow.classList.toggle("disabled",!state.visualizer.enabled);
  });
  const visualizerOpacitySlider=$("visualizerOpacitySlider");
  visualizerOpacitySlider.addEventListener("input",()=>{
    // Live, like a Photoshop layer-opacity slider — no separate "apply"
    // step, drawVisualizerFrame() just reads state.visualizer.intensity
    // on its next tick.
    state.visualizer.intensity=Math.max(0,Math.min(2,Number(visualizerOpacitySlider.value)||0));
    $("visualizerOpacityValue").textContent=Math.round(state.visualizer.intensity*100)+"%";
    saveVisualizerSettings();
  });

  if(window.electronAPI && window.electronAPI.saveTextFile){
    $("backupExportBtn").addEventListener("click",onBackupExportClick);
    $("backupImportBtn").addEventListener("click",onBackupImportClick);
  }
}

/* ================================================================
   LIBRARY BACKUP / RESTORE
   Everything the app knows — tracks (as metadata + real file paths,
   never the raw audio itself), playlists, folders, cached lyrics,
   and settings — as one portable JSON file. This is the only way to
   carry a library between machines or recover it after a reinstall,
   since none of it is otherwise exported anywhere; it all just lives
   in this browser profile's IndexedDB.

   Deliberately excluded from the backup:
     - fileBlob: the actual audio bytes, kept only for tracks picked
       via a plain <input type=file>/drag-drop with no real path
       behind them (see hydrateTrack()). Embedding whole songs in a
       JSON file would make backups enormous, so those particular
       tracks just can't be carried by this — only path-backed ones
       (which is everything imported through a folder, the normal
       desktop flow) can be restored.
     - fileURL/artURL: session-only blob: URLs, meaningless outside
       the run that created them — stripped the same way every other
       idbPut("tracks",...) call site in this file already does.

   Cover art (artBlob) IS included, base64-encoded — unlike audio, a
   picture won't be re-derivable later by rescanning if the source
   file's own tags don't happen to have one embedded.
   ================================================================ */

const BACKUP_FORMAT_VERSION=1;

// Blob -> "data:<mime>;base64,...." string, for embedding in JSON.
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// The reverse of blobToBase64 — takes a full "data:...;base64,..."
// string back out of a restored backup and turns it back into a real
// Blob suitable for storing in the artBlob field.
function base64ToBlob(dataURL){
  return fetch(dataURL).then(r=>r.blob());
}

// Re-reads tracks/playlists/folders fresh from IndexedDB into
// `state` and re-renders — the same read+hydrate importLibraryBackup
// needs after writing its restored rows, without repeating init()'s
// one-time migration/theme/first-run "Favorites" playlist logic here
// too (none of that is relevant mid-session).
async function reloadLibraryFromDB(){
  const [tracksRaw, playlistsRaw, foldersRaw] = await Promise.all([
    idbGetAll("tracks"), idbGetAll("playlists"), idbGetAll("folders")
  ]);
  state.folders=foldersRaw||[];
  state.playlists=playlistsRaw||[];
  state.tracks=(tracksRaw||[]).map(hydrateTrack);
  renderTab();
}

// Gathers every store into one JSON-serializable object and asks the
// main process to show a native Save dialog for it. Returns
// {saved:true, filePath, skippedNoPath} on success, or
// {saved:false, reason} — reason:"canceled" if the person just
// backed out of the dialog, so callers can stay quiet in that case.
async function exportLibraryBackup(){
  if(!(window.electronAPI && window.electronAPI.saveTextFile)){
    return {saved:false, reason:tr("backup.desktopOnly")};
  }

  const [tracks,playlists,folders,lyrics,settingsRows]=await Promise.all([
    idbGetAll("tracks"), idbGetAll("playlists"), idbGetAll("folders"),
    idbGetAll("lyrics"), idbGetAll("settings")
  ]);

  let skippedNoPath=0;
  const trackRows=await Promise.all(tracks.map(async t=>{
    if(!t.filePath) skippedNoPath++;
    return {
      id:t.id, title:t.title, artist:t.artist, album:t.album,
      duration:t.duration, folderId:t.folderId, dateAdded:t.dateAdded,
      trackNum: t.trackNum!=null ? t.trackNum : null,
      filePath: t.filePath||null,
      art: t.artBlob ? await blobToBase64(t.artBlob) : null
    };
  }));

  const payload={
    format:"playnck-backup", version:BACKUP_FORMAT_VERSION, exportedAt:new Date().toISOString(),
    tracks:trackRows, playlists, folders, lyrics, settings:settingsRows
  };

  const filename=`playnck-backup-${new Date().toISOString().slice(0,10)}.json`;
  const result=await window.electronAPI.saveTextFile(filename, JSON.stringify(payload), "Playnck Backup", ["json"]);
  if(result && result.saved) return {saved:true, filePath:result.filePath, skippedNoPath};
  return {saved:false, reason:(result&&result.reason)||"canceled"};
}

// Reads a previously exported backup file back in and MERGES it into
// the current library: rows with a matching id overwrite what's
// there now, everything else is left untouched — so restoring a
// backup never deletes tracks/playlists added since it was made.
// Tracks with no filePath at export time (see exportLibraryBackup's
// note above) are skipped here too, since there's no audio for them
// to point at. Returns {imported:false, reason:"canceled"} if the
// person backs out of the file picker, so callers can stay quiet.
async function importLibraryBackup(){
  if(!(window.electronAPI && window.electronAPI.openTextFile)){
    return {imported:false, reason:tr("backup.desktopOnly")};
  }
  const picked=await window.electronAPI.openTextFile("Playnck Backup", ["json"]);
  if(!picked) return {imported:false, reason:"canceled"};

  let payload;
  try{ payload=JSON.parse(picked.content); }
  catch(err){ return {imported:false, reason:tr("backup.invalidFile")}; }
  if(!payload || payload.format!=="playnck-backup"){
    return {imported:false, reason:tr("backup.invalidFile")};
  }

  let restored=0, skipped=0;
  for(const row of (payload.tracks||[])){
    if(!row.filePath){ skipped++; continue; }
    const artBlob = row.art ? await base64ToBlob(row.art).catch(()=>null) : null;
    await idbPut("tracks",{
      id:row.id, title:row.title, artist:row.artist, album:row.album,
      duration:row.duration, folderId:row.folderId, dateAdded:row.dateAdded,
      trackNum:row.trackNum, filePath:row.filePath,
      fileBlob:null, artBlob
    });
    restored++;
  }
  for(const p of (payload.playlists||[])) await idbPut("playlists",p);
  for(const f of (payload.folders||[])) await idbPut("folders",f);
  for(const l of (payload.lyrics||[])) await idbPut("lyrics",l);
  for(const s of (payload.settings||[])) await idbPut("settings",s);

  await reloadLibraryFromDB();
  return {imported:true, restored, skipped};
}

async function onBackupExportClick(){
  const statusEl=$("backupStatusText");
  if(!statusEl) return;
  statusEl.textContent=tr("backup.exporting");
  const result=await exportLibraryBackup();
  if(result.saved){
    statusEl.textContent = result.skippedNoPath>0
      ? tr("backup.exportedWithSkipped",{count:result.skippedNoPath})
      : tr("backup.exported");
  } else if(result.reason && result.reason!=="canceled"){
    statusEl.textContent=tr("backup.exportFailed",{reason:result.reason});
  } else {
    statusEl.textContent="";
  }
}

async function onBackupImportClick(){
  if(!confirm(tr("backup.importConfirm"))) return;
  const statusEl=$("backupStatusText");
  if(!statusEl) return;
  statusEl.textContent=tr("backup.importing");
  const result=await importLibraryBackup();
  if(result.imported){
    statusEl.textContent=tr("backup.imported",{restored:result.restored,skipped:result.skipped});
  } else if(result.reason && result.reason!=="canceled"){
    statusEl.textContent=tr("backup.importFailed",{reason:result.reason});
  } else {
    statusEl.textContent="";
  }
}

// Settings > Language: a pill button per language that's been added
// so far (just English at first), plus a "+ Add language" button
// that installs the next entry from LANGUAGES (currently just
// French) and switches to it right away. Once every language in
// LANGUAGES has been installed, the button is swapped for a small
// note instead of just disappearing silently.
function buildLanguageBodyHTML(){
  const chips=state.installedLanguages.map(code=>
    `<button type="button" class="lang-chip${state.language===code?" active":""}" data-lang="${code}">${escapeHTML(LANGUAGES[code].native)}</button>`
  ).join("");
  const hasMore=Object.keys(LANGUAGES).some(code=>!state.installedLanguages.includes(code));
  const addBtnOrNote=hasMore
    ? `<button type="button" class="amr-add-btn" id="addLanguageBtn">${escapeHTML(tr("language.addButton"))}</button>`
    : `<p class="theme-note">${escapeHTML(tr("language.noMore"))}</p>`;
  return `
    <div class="theme-picker">
      <div>
        <div class="swatch-row" id="languageChipRow">${chips}</div>
      </div>
      ${addBtnOrNote}
      <p class="theme-note">${escapeHTML(tr("language.note"))}</p>
    </div>`;
}
// Builds the "About Us" modal content: what the app is, the
// current build version (same state.appVersion already fetched via
// electronAPI.getAppVersion() for the Settings > Updates section —
// see wireUpdateEvents()/state init near the top of this file, so
// no extra IPC call is needed here), and a link to the community
// Telegram group. Falls back to the package.json version baked in
// at build time if, for some reason, electronAPI hasn't reported
// back yet (e.g. a non-Electron/web build) — see APP_VERSION_FALLBACK.
const APP_VERSION_FALLBACK="1.0.11";
function openAboutModal(){
  const version=state.appVersion||APP_VERSION_FALLBACK;
  const bodyHTML=`
    <div class="about-body">
      <p class="about-tagline">${escapeHTML(tr("about.tagline"))}</p>
      <div class="info-grid">
        <div class="info-row"><span class="info-key">${escapeHTML(tr("about.buildVersion"))}</span><span class="info-val">v${escapeHTML(version)}</span></div>
      </div>
      <div class="about-community">
        <p class="about-community-text">${escapeHTML(tr("about.communityText"))}</p>
        <a class="about-action-btn" href="https://t.me/+taM7DL_CKsViNGM0" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M21.9 4.2c-.3-.2-.6-.3-1-.1L2.4 11.4c-.5.2-.8.6-.8 1.1 0 .5.4.9.9 1.1l4.7 1.5 1.8 5.8c.1.4.5.7.9.7.3 0 .5-.1.7-.3l2.6-2.5 4.8 3.5c.2.2.5.2.7.2.2 0 .4 0 .6-.1.4-.2.6-.5.7-.9l3.2-15.3c.1-.4-.1-.8-.4-1z"/></svg>
          ${escapeHTML(tr("about.telegramBtn"))}
        </a>
      </div>
      <div class="about-support">
        <p class="about-support-title">${escapeHTML(tr("about.supportTitle"))}</p>
        <p class="about-support-text">${escapeHTML(tr("about.supportText"))}</p>
        <a class="about-qr-link" href="https://app.binance.com/uni-qr/5tLuirTT" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(tr("about.donateBtn"))}">
          <img class="about-qr-img" src="docs/screenshots/Donation.jpg" alt="${escapeHTML(tr("about.supportQrAlt"))}">
        </a>
        <p class="about-qr-caption">${escapeHTML(tr("about.supportQrCaption"))}</p>
        <a class="about-action-btn" href="https://app.binance.com/uni-qr/5tLuirTT" target="_blank" rel="noopener noreferrer">
          ${escapeHTML(tr("about.donateBtn"))}
        </a>
      </div>
    </div>`;
  openModal(tr("nav.aboutUs"), bodyHTML);
}



/* ================================================================
   SLEEP TIMER
   One scheduled pause — pick a duration, and playback pauses itself
   once that much time has passed. Deliberately just a plain
   setTimeout acting directly on the real <audio> element (audioEl),
   rather than anything wired into the queue/repeat/shuffle/auto-
   advance logic elsewhere in this file: it only ever calls
   audioEl.pause(), so it can't conflict with (or need to know
   anything about) whatever decides what plays next. Reachable from
   the "☰" side menu (menuSleepBtn) alongside Info/Edit/Sync Lyrics.
   Session-only by design — like a real sleep timer, it's meant to
   apply to *this* listening session, not persist across restarts.
   ================================================================ */

const SLEEP_TIMER_PRESETS_MIN=[15,30,45,60,90];
let sleepTimerHandle=null;
let sleepTimerEndsAt=null; // epoch ms, or null when no timer is running

// Starts (or restarts, if one was already running) a sleep timer for
// the given number of minutes.
function startSleepTimer(minutes){
  clearSleepTimer();
  const ms=minutes*60*1000;
  sleepTimerEndsAt=Date.now()+ms;
  sleepTimerHandle=setTimeout(()=>{
    const audioEl=$("audioEl");
    if(audioEl && !audioEl.paused) audioEl.pause();
    sleepTimerEndsAt=null;
    sleepTimerHandle=null;
  },ms);
}

// Cancels a running sleep timer, if any. Safe to call even when none
// is running (used both by the "Turn Off" button and defensively
// before starting a new one).
function clearSleepTimer(){
  if(sleepTimerHandle) clearTimeout(sleepTimerHandle);
  sleepTimerHandle=null;
  sleepTimerEndsAt=null;
}

// Opens a small modal with duration presets plus the current status,
// reusing the exact same shared openModal()/closeModal() popup as
// Info/Edit/About.
function openSleepTimerModal(){
  const presetsHTML=SLEEP_TIMER_PRESETS_MIN.map(m=>
    `<button type="button" class="amr-add-btn sleep-preset-btn" data-minutes="${m}">${escapeHTML(tr("sleep.presetMinutes",{minutes:m}))}</button>`
  ).join("");
  const statusText=sleepTimerEndsAt
    ? tr("sleep.activeStatus",{minutes:Math.max(0,Math.round((sleepTimerEndsAt-Date.now())/60000))})
    : tr("sleep.off");
  const bodyHTML=`
    <div class="theme-picker">
      <p class="update-status-text" id="sleepStatusText">${escapeHTML(statusText)}</p>
      <div class="backup-actions" id="sleepPresetRow">${presetsHTML}</div>
      <button type="button" class="edit-save-btn" id="sleepOffBtn"${sleepTimerEndsAt?"":" disabled"}>${escapeHTML(tr("sleep.turnOff"))}</button>
      <p class="theme-note">${escapeHTML(tr("sleep.note"))}</p>
    </div>`;
  openModal(tr("sleep.title"), bodyHTML);

  $("sleepPresetRow").querySelectorAll(".sleep-preset-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      startSleepTimer(Number(btn.dataset.minutes));
      closeModal();
    });
  });
  $("sleepOffBtn").addEventListener("click",()=>{
    clearSleepTimer();
    closeModal();
  });
}



/* ================================================================
   SIDE MENU: INFO / EDIT / SYNC LYRICS
   The "☰" button in the top-right of the now-playing panel opens
   a small dropdown with three entries, all of which reuse one
   shared modal popup (openModal/closeModal):
     - Info: read-only details about the current song and its file
     - Edit: retag the current song (title/artist/album/cover)
     - Sync Lyrics: nudge lyric timing forward/backward in ms
   ================================================================ */

// Shows/hides the Info/Edit dropdown. Called on every click of the
// side-menu button, so clicking it again closes it (a normal
// toggle). e.stopPropagation() on the button (see bindEvents
// below) keeps that same click from also being seen as an
// "outside click" by closeSideDropdown's document listener.
function toggleSideDropdown(){
  const dd=$("sideDropdown");
  if(dd.classList.contains("hidden")) openSideDropdown();
  else closeSideDropdown();
}



// Reveals the Info/Edit dropdown and arms a one-time listener that
// closes it again on the next click anywhere on the page (the
// same "click outside to close" pattern used by closeMenu above).
function openSideDropdown(){
  showWithMotion($("sideDropdown"));
  setTimeout(()=>document.addEventListener("click",closeSideDropdown,{once:true}),0);
}



// Hides the Info/Edit dropdown.
function closeSideDropdown(){
  hideWithMotion($("sideDropdown"));
}



// Fills in and shows the shared modal. Used by both openInfoModal()
// and openEditModal() below so there's only one popup to maintain.
function openModal(title, bodyHTML){
  $("modalTitle").textContent=title;
  $("modalBody").innerHTML=bodyHTML;
  showWithMotion($("modalOverlay"));
}



// Hides the shared modal.
function closeModal(){
  hideWithMotion($("modalOverlay"),220);
}



// Builds the "Info" modal content: everything we know about a
// song, plus details about its underlying audio file (name, type,
// size, and when it was added). Pass a specific track (e.g. from a
// song row's "⋮" menu) to show info for that song; called with no
// argument (e.g. from the player panel's side menu) it falls back
// to whatever's currently playing.
//
// Bitrate, File type, and File size: all three show instantly from
// whatever's available client-side (bitrate as a size/duration
// ESTIMATE, type/size read off the in-memory fileBlob if there is
// one) and, if running inside the Electron build with a real file
// path known, all three get swapped for accurate values read
// straight off disk once an async call to the main process resolves
// (see metadata-bridge.js — parses real MP3/FLAC/etc. frame headers
// via the music-metadata package, and stats the file for its real
// byte size). Path-backed tracks (see hydrateTrack()) don't keep a
// fileBlob at all, so without this upgrade those two rows would stay
// stuck on "Unknown" forever instead of just until the read resolves.
// Nothing here breaks or even changes on a non-Electron build — that
// whole branch is skipped when window.electronAPI isn't present.
function openInfoModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("info.modalTitleEmpty"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingInfo"))}</p>`);
    return;
  }

  const file=t.fileBlob;
  const folder=state.folders.find(f=>f.id===t.folderId);
  const estimatedBitrate=file ? formatBitrate(file.size, t.duration) : tr("common.unknown");
  // Path-backed tracks (see hydrateTrack()) don't carry a fileBlob
  // any more, so file name/type/size fall back to what can be read
  // off the path itself; size/bitrate get upgraded to the real
  // reading by the getAudioMetadata() call further down regardless.
  const fileNameFallback=t.filePath ? t.filePath.split(/[\\/]/).pop() : tr("common.unknown");

  // Each row is [label, value] — shown in this exact order. The
  // bitrate row gets a fixed id so we can upgrade its value in
  // place if an accurate reading comes back later.
  const rows=[
    [tr("info.rowTitle"), t.title],
    [tr("info.rowArtist"), t.artist],
    [tr("info.rowAlbum"), t.album],
    [tr("info.rowTrackNo"), t.trackNum!=null ? t.trackNum : tr("common.unknown")],
    [tr("info.rowDuration"), fmtTime(t.duration)],
    [tr("info.rowFolder"), folder ? folder.name : "—"],
    [tr("info.rowFileName"), (file && file.name) ? file.name : fileNameFallback],
    [tr("info.rowFileType"), (file && file.type) ? file.type : tr("common.unknown"), "infoFileTypeVal"],
    [tr("info.rowFileSize"), file ? formatBytes(file.size) : tr("common.unknown"), "infoFileSizeVal"],
    [tr("info.rowBitrate"), estimatedBitrate, "infoBitrateVal"],
    [tr("info.rowDateAdded"), t.dateAdded ? new Date(t.dateAdded).toLocaleString() : tr("common.unknown")]
  ];

  const bodyHTML="<div class='info-grid'>"+rows.map(([key,val,id])=>
    `<div class='info-row'><span class='info-key'>${escapeHTML(key)}</span><span class='info-val'${id?` id='${id}'`:""}>${escapeHTML(String(val))}</span></div>`
  ).join("")+"</div>";

  openModal(tr("info.modalTitle"), bodyHTML);

  // --- Electron-only upgrade: real bitrate from the file's actual
  // encoded stream, instead of the size/duration estimate above.
  // Also upgrades File type/File size for path-backed tracks, which
  // never carry a fileBlob (see the comment above) so those two rows
  // start out as "Unknown" and get filled in here once the real
  // values come back from disk. ---
  if(window.electronAPI && window.electronAPI.getAudioMetadata && t.filePath){
    window.electronAPI.getAudioMetadata(t.filePath).then(meta=>{
      if(!meta) return;

      if(meta.bitrate){
        const bitrateEl=$("infoBitrateVal");
        if(bitrateEl){
          const vbrTag=meta.lossless ? tr("info.lossless") : "";
          bitrateEl.textContent=meta.bitrate+" kb/s"+vbrTag;
        }
      }

      if(meta.mimeType){
        const typeEl=$("infoFileTypeVal");
        if(typeEl) typeEl.textContent=meta.mimeType;
      }

      if(typeof meta.fileSize==="number"){
        const sizeEl=$("infoFileSizeVal");
        if(sizeEl) sizeEl.textContent=formatBytes(meta.fileSize);
      }
    }).catch(()=>{ /* leave the estimates/"Unknown" showing — no real reading available */ });
  }
}



// Builds the "Edit" modal: lets the user retag a track — change
// its title, artist, album, and cover art. Pass a specific track
// (e.g. from a song row's "⋮" menu) to edit that song; called with
// no argument (e.g. from the player panel's side menu) it falls
// back to whatever's currently playing. Holds the picked cover
// file (if any) in a closure variable until Save is clicked, so
// nothing is written to the track/DB until the user confirms.
function openEditModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("edit.modalTitleEmpty"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingEdit"))}</p>`);
    return;
  }
  const originalArtURL=getTrackArtURL(t);

  let pendingArtFile=null;   // newly picked cover image, staged until Save
  let removeArt=false;       // true if the user chose to remove the cover
  let coverCandidates=[];    // cover options for whichever match is selected, for the gallery
  let coverCandidateIndex=0;
  let matchCandidates=[];    // every song Auto-tag found plausible, for the match dropdown

  const bodyHTML=`
    <div class="edit-form">
      <div class="edit-cover-row">
        <div class="edit-cover-preview" id="editCoverPreview">
          ${originalArtURL
            ? `<img id="editCoverImg" src="${originalArtURL}" alt="cover">`
            : `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`
          }
        </div>
        <div class="edit-cover-actions">
          <button type="button" class="edit-cover-btn" id="editCoverBtn">${escapeHTML(tr("edit.changeCover"))}</button>
          <button type="button" class="edit-cover-btn secondary" id="editCoverRemoveBtn">${escapeHTML(tr("edit.removeCover"))}</button>
          <input type="file" id="editCoverInput" accept="image/*" class="hidden">
        </div>
      </div>
      <div class="edit-cover-gallery hidden" id="editCoverGallery"></div>
      <div class="edit-autotag-row">
        <div class="edit-autotag-buttons">
          <button type="button" class="edit-autotag-btn" id="editAutoTagFingerprintBtn">${escapeHTML(tr("edit.autoTagFingerprint"))}</button>
          <button type="button" class="edit-autotag-btn" id="editAutoTagTextBtn">${escapeHTML(tr("edit.autoTagText"))}</button>
        </div>
        <p class="edit-autotag-status hidden" id="editAutoTagStatus"></p>
        <div class="edit-autotag-matches hidden" id="editAutoTagMatches"></div>
      </div>
      <div class="edit-field">
        <label class="edit-label" for="editTitleInput">${escapeHTML(tr("info.rowTitle"))}</label>
        <input type="text" class="edit-input" id="editTitleInput">
      </div>
      <div class="edit-field">
        <label class="edit-label" for="editArtistInput">${escapeHTML(tr("info.rowArtist"))}</label>
        <input type="text" class="edit-input" id="editArtistInput">
      </div>
      <div class="edit-field">
        <label class="edit-label" for="editAlbumInput">${escapeHTML(tr("info.rowAlbum"))}</label>
        <input type="text" class="edit-input" id="editAlbumInput">
      </div>
      <div class="edit-actions">
        <button type="button" class="edit-cancel-btn" id="editCancelBtn">${escapeHTML(tr("modal.cancel"))}</button>
        <button type="button" class="edit-save-btn" id="editSaveBtn">${escapeHTML(tr("edit.saveChanges"))}</button>
      </div>
      <p class="edit-status hidden" id="editStatus"></p>
    </div>`;

  openModal(tr("edit.modalTitle"), bodyHTML);

  // Set values via .value instead of baking them into the HTML
  // above, so quotes/special characters in existing tags never
  // need escaping into an attribute.
  $("editTitleInput").value=t.title||"";
  $("editArtistInput").value=t.artist||"";
  $("editAlbumInput").value=t.album||"";

  const coverInput=$("editCoverInput");
  const galleryEl=$("editCoverGallery");
  const matchesEl=$("editAutoTagMatches");

  // Applies cover candidate #idx from whatever match is currently
  // selected as the preview/pendingArtFile, and highlights the
  // matching thumbnail in the gallery. Shared by the initial
  // Auto-tag result, every subsequent match selection, and clicking
  // a different thumbnail directly.
  function applyCoverCandidate(idx){
    if(!coverCandidates.length) return;
    coverCandidateIndex=((idx%coverCandidates.length)+coverCandidates.length)%coverCandidates.length;
    const candidate=coverCandidates[coverCandidateIndex];
    const bytes=candidate.data instanceof Uint8Array ? candidate.data : new Uint8Array(candidate.data);
    pendingArtFile=new File([bytes], "cover.jpg", { type: candidate.mime||"image/jpeg" });
    removeArt=false;
    const previewURL=URL.createObjectURL(pendingArtFile);
    $("editCoverPreview").innerHTML=`<img id="editCoverImg" src="${previewURL}" alt="cover">`;
    if(galleryEl){
      galleryEl.querySelectorAll(".edit-cover-thumb").forEach((el,i)=>{
        el.classList.toggle("selected", i===coverCandidateIndex);
      });
    }
  }

  // Renders the cover options for whichever match is currently
  // selected as clickable thumbnails, so the user can pick the right
  // one directly instead of committing to whatever came back first.
  // Hidden entirely when there's nothing to choose between (0 or 1
  // image) — the single image, if any, is still applied as the
  // preview via applyCoverCandidate(0) below.
  function renderCoverGallery(images){
    coverCandidates=images||[];
    if(!galleryEl) return;
    if(coverCandidates.length<2){
      galleryEl.classList.add("hidden");
      galleryEl.innerHTML="";
    } else {
      galleryEl.innerHTML=coverCandidates.map((img,i)=>{
        const bytes=img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data);
        const url=URL.createObjectURL(new Blob([bytes],{type:img.mime||"image/jpeg"}));
        const label=img.releaseTitle ? `${img.releaseTitle}${img.releaseDate?" ("+img.releaseDate+")":""}` : "";
        return `<button type="button" class="edit-cover-thumb" data-idx="${i}" style="background-image:url('${url}')" title="${escapeHTML(label)}" aria-label="${escapeHTML(label||"cover option "+(i+1))}"></button>`;
      }).join("");
      galleryEl.classList.remove("hidden");
    }
    if(coverCandidates.length){
      applyCoverCandidate(0);
    } else {
      // This match didn't turn up any cover art of its own — fall
      // back to the track's original cover (if any) instead of
      // leaving a previous match's cover on screen, which would no
      // longer correspond to the song now selected.
      pendingArtFile=null;
      removeArt=false;
      $("editCoverPreview").innerHTML=originalArtURL
        ? `<img id="editCoverImg" src="${originalArtURL}" alt="cover">`
        : `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`;
    }
  }

  if(galleryEl){
    galleryEl.addEventListener("click",(e)=>{
      const btn=e.target.closest(".edit-cover-thumb");
      if(!btn) return;
      applyCoverCandidate(parseInt(btn.dataset.idx,10)||0);
    });
  }

  // Applies candidate match #idx (a whole title/artist/album + cover
  // set) to the form fields and gallery — used both for the initial
  // best guess and whenever the user picks a different option from
  // the dropdown below.
  function applyMatch(idx){
    if(!matchCandidates.length) return;
    idx=Math.max(0,Math.min(idx,matchCandidates.length-1));
    const m=matchCandidates[idx];
    if(m.title) $("editTitleInput").value=m.title;
    if(m.artist) $("editArtistInput").value=m.artist;
    if(m.album) $("editAlbumInput").value=m.album;
    renderCoverGallery(m.images||[]);
  }

  // Renders the "which song is it?" dropdown when Auto-tag found
  // more than one plausible match (ambiguous fingerprint hit, or
  // several confident title/artist search results) — hidden when
  // there's only one, since there's nothing to choose between.
  function renderMatchOptions(matches){
    matchCandidates=matches||[];
    if(!matchesEl) return;
    if(matchCandidates.length<2){
      matchesEl.classList.add("hidden");
      matchesEl.innerHTML="";
      return;
    }
    // "Song — Artist — Album (Year)" — album gets its own clearly
    // visible segment rather than being buried in parentheses, since
    // with several candidates for the same song, the album (which
    // release/edition it is) is usually the only thing actually
    // telling them apart — see the fingerprint-tier fix in
    // autotag-bridge.js's acoustidLookup(), which is what makes
    // m.album reliably populated for fingerprint matches too now,
    // not just text-search ones.
    const optionLabel=(m)=>[
      m.title||"?",
      m.artist,
      m.album ? (m.album+(m.year?" ("+m.year+")":"")) : null
    ].filter(Boolean).join(" — ");

    matchesEl.innerHTML=`
      <label class="edit-label" for="editAutoTagMatchSelect">${escapeHTML(tr("edit.autoTagPickMatch"))}</label>
      <select class="edit-input edit-autotag-select" id="editAutoTagMatchSelect">
        ${matchCandidates.map((m,i)=>`<option value="${i}">${escapeHTML(optionLabel(m))}</option>`).join("")}
      </select>`;
    matchesEl.classList.remove("hidden");
    $("editAutoTagMatchSelect").addEventListener("change",(e)=>applyMatch(parseInt(e.target.value,10)||0));
  }

  $("editCoverBtn").addEventListener("click",()=>coverInput.click());

  coverInput.addEventListener("change",()=>{
    const file=coverInput.files[0];
    if(!file) return;
    pendingArtFile=file;
    removeArt=false;
    coverCandidates=[]; // manual pick overrides whatever Auto-tag found
    if(galleryEl){ galleryEl.classList.add("hidden"); galleryEl.innerHTML=""; }
    const previewURL=URL.createObjectURL(file);
    $("editCoverPreview").innerHTML=`<img id="editCoverImg" src="${previewURL}" alt="cover">`;
  });

  $("editCoverRemoveBtn").addEventListener("click",()=>{
    pendingArtFile=null;
    removeArt=true;
    coverCandidates=[]; // manual removal overrides whatever Auto-tag found
    if(galleryEl){ galleryEl.classList.add("hidden"); galleryEl.innerHTML=""; }
    $("editCoverPreview").innerHTML=`<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>`;
  });

  // --- Auto-tag: identify the song and fill in title/artist/album
  // (+ cover, if one was found) for the user to review before Save.
  // Nothing is written anywhere until Save is clicked — this only
  // populates the same form fields/pendingArtFile the user could've
  // filled in by hand. Electron-only (needs a real file on disk to
  // fingerprint or a running main process to talk to the lookup
  // APIs); on plain web the buttons explain that instead of trying.
  //
  // Two separate buttons/tiers instead of one combined Auto-tag
  // button: "identify from audio" (fingerprint only) and "search by
  // title/artist" (MusicBrainz text search only) — each runs just its
  // own tier via autoTagTrack's mode param, so a fingerprint miss is
  // reported as a miss instead of silently turning into a (less
  // trustworthy) text-search guess the user didn't ask for, and the
  // text search can be re-run on demand after editing the
  // title/artist fields without re-fingerprinting the file.
  const autoTagFingerprintBtn=$("editAutoTagFingerprintBtn");
  const autoTagTextBtn=$("editAutoTagTextBtn");
  const autoTagStatus=$("editAutoTagStatus");
  const AUTOTAG_PROGRESS_KEY={fingerprint:"edit.autoTaggingFingerprint", text:"edit.autoTaggingText"};

  async function runAutoTag(mode){
    if(!(window.electronAPI && window.electronAPI.autoTagTrack && t.filePath)){
      autoTagStatus.classList.remove("hidden");
      autoTagStatus.textContent=tr("edit.autoTagUnavailable");
      return;
    }

    // Disable both buttons while either is running — they share the
    // same form fields/matchCandidates/coverCandidates state, so
    // letting one fire mid-flight of the other would race.
    autoTagFingerprintBtn.disabled=true;
    autoTagTextBtn.disabled=true;
    autoTagStatus.classList.remove("hidden");
    autoTagStatus.textContent=tr(AUTOTAG_PROGRESS_KEY[mode]);
    if(matchesEl){ matchesEl.classList.add("hidden"); matchesEl.innerHTML=""; }

    const titleField=$("editTitleInput");
    const artistField=$("editArtistInput");
    const albumField=$("editAlbumInput");

    // guessFromName() (used at import time for untagged files) fills
    // in the literal string "Unknown Artist" when there's no real
    // artist to read — sending that through as a search hint would
    // make the lookup go looking for a recording actually credited to
    // an artist named "Unknown Artist" and (correctly) find nothing.
    // Treat that placeholder the same as no artist hint at all.
    const artistHint=artistField.value.trim()||t.artist||"";
    const cleanArtistHint=/^unknown artist$/i.test(artistHint) ? "" : artistHint;

    const result=await window.electronAPI.autoTagTrack(t.filePath,{
      title: titleField.value.trim()||t.title||"",
      artist: cleanArtistHint
    }, mode).catch(err=>({found:false, reason:String((err&&err.message)||err)}));

    autoTagFingerprintBtn.disabled=false;
    autoTagTextBtn.disabled=false;

    if(!result || !result.found){
      autoTagStatus.textContent=tr("edit.autoTagNotFound",{reason:(result&&result.reason)||""});
      return;
    }

    if(result.title) titleField.value=result.title;
    if(result.artist) artistField.value=result.artist;
    if(result.album) albumField.value=result.album;

    // Several plausible songs? Show the dropdown so the user can pick
    // the actual right one instead of just getting the top guess.
    renderMatchOptions(result.matches||[]);

    // Uint8Array data arrives as-is over IPC (Buffer isn't
    // structured-cloneable as itself) — renderCoverGallery()/
    // applyCoverCandidate() wrap each candidate into a File on
    // demand, exactly like a user-picked cover file, so the rest of
    // the Save flow (writeAudioTags' imageData/imageMime) doesn't
    // need to know the difference.
    if(Array.isArray(result.images) && result.images.length){
      renderCoverGallery(result.images);
    }

    autoTagStatus.textContent=tr(result.source==="fingerprint" ? "edit.autoTagFoundFingerprint" : "edit.autoTagFoundMusicbrainz");
  }

  autoTagFingerprintBtn.addEventListener("click",()=>runAutoTag("fingerprint"));
  autoTagTextBtn.addEventListener("click",()=>runAutoTag("text"));

  $("editCancelBtn").addEventListener("click",closeModal);

  $("editSaveBtn").addEventListener("click",async()=>{
    const saveBtn=$("editSaveBtn");
    saveBtn.disabled=true;
    saveBtn.textContent=tr("edit.saving");

    const newTitle=$("editTitleInput").value.trim()||t.title;
    const newArtist=$("editArtistInput").value.trim()||t.artist;
    const newAlbum=$("editAlbumInput").value.trim()||t.album;

    // Applies the edit to Playnck's own library/UI. For a real
    // path-backed track this only ever runs AFTER the actual file on
    // disk has been written and verified further down (or, via the
    // "Save inside Playnck only" fallback, after the user explicitly
    // chooses to keep the edit despite the file write failing) — the
    // whole point being that the library is a reflection of what's
    // really on disk, not a separate, possibly-stale copy of it.
    async function applyToLibrary(){
      t.title=newTitle;
      t.artist=newArtist;
      t.album=newAlbum;

      if(pendingArtFile){
        if(t.artURL) URL.revokeObjectURL(t.artURL);
        t.artBlob=pendingArtFile;
        t.artURL=URL.createObjectURL(pendingArtFile);
      } else if(removeArt){
        if(t.artURL) URL.revokeObjectURL(t.artURL);
        t.artBlob=null;
        t.artURL=null;
      }

      // Persist a plain copy to IndexedDB — same shape used when a
      // track is first imported (see ingestFiles() above), deliberately
      // without the temporary fileURL/artURL blob: URLs. Saving an edit
      // always persists (there's no "temporary" edit), so an externally
      // opened track reached via the player panel's Edit menu (see
      // openEditModal()'s comment) gets promoted into the real library
      // here too — same idea as ingestFiles()'s re-import promotion.
      if(t.external) t.external=false;
      const storeCopy={
        id:t.id, title:t.title, artist:t.artist, album:t.album,
        trackNum:t.trackNum,
        duration:t.duration, folderId:t.folderId, dateAdded:t.dateAdded,
        fileBlob:t.fileBlob, artBlob:t.artBlob, filePath:t.filePath
      };
      await idbPut("tracks",storeCopy);

      if(state.currentTrack && state.currentTrack.id===t.id) updateNowPlayingUI();
      renderTab();
    }

    const isRealFileTrack=!!(window.electronAPI && window.electronAPI.writeAudioTags && t.filePath);

    if(!isRealFileTrack){
      // No known file on disk to be the source of truth for (plain
      // web build, or a track Playnck never learned a real path for)
      // — Save behaves exactly as it always has: the library copy is
      // the only thing that changes, and there's no "file wasn't
      // updated" implication because there was never a file to update.
      await applyToLibrary();
      closeModal();
      return;
    }

    // --- If this exact track is the one currently loaded in the
    // player, Playnck's OWN open read stream on it (see the
    // playnck-file:// protocol handler in main.js — it reads straight
    // off disk via fs.createReadStream, it never buffers the whole
    // file into memory first) is, by itself, enough for Windows to
    // refuse the rename that swaps the freshly-tagged copy in. That's
    // a real lock, not a false alarm, and it has nothing to do with
    // any other program — releasing it before writing is what
    // actually fixes it, rather than just retrying blindly. Detach
    // <audio> from the file first, restore playback afterward either
    // way.
    let resumePlayback=null;
    const wasCurrentlyLoaded=!!(state.currentTrack && state.currentTrack.id===t.id && audioEl.src);
    if(wasCurrentlyLoaded){
      resumePlayback={ time: audioEl.currentTime, wasPlaying: !audioEl.paused };
      audioEl.pause();
      // removeAttribute (not src="") + load(): per spec this drops
      // networkState to NETWORK_EMPTY without firing 'error' or
      // 'ended' — setting src="" instead would fire a real 'error'
      // event, which the "error" listener further down treats as a
      // sign the file went missing on disk and would incorrectly
      // trigger handleMissingTrack() on a file that's actually fine.
      audioEl.removeAttribute("src");
      audioEl.load();
    }

    // --- Real file on disk: write the tags/artwork into it FIRST,
    // and verify the write actually stuck (see metadata-bridge.js /
    // ffmpeg-bridge.js) — before touching Playnck's own library or UI
    // at all. This is what makes the file the source of truth instead
    // of Playnck's database: nothing here is "saved" from the user's
    // point of view until the bytes on disk actually carry it,
    // because that's the copy that survives a phone transfer, a
    // reimport, or opening the file in any other player.
    let imageData=null;
    if(pendingArtFile) imageData=await pendingArtFile.arrayBuffer();

    const result=await window.electronAPI.writeAudioTags(t.filePath,{
      title:newTitle, artist:newArtist, album:newAlbum,
      imageData, imageMime: pendingArtFile ? pendingArtFile.type : null,
      removeImage: removeArt
    }).catch(err=>({written:false, reason:String((err&&err.message)||err)}));

    const status=$("editStatus");
    // Clear out any "Save inside Playnck only" row left over from a
    // previous failed attempt in this same modal session — it's a
    // sibling of #editStatus, not part of its text, so it wouldn't
    // otherwise go away just because this retry took a different path.
    const leftoverActions=$("editSaveLibraryOnlyBtn");
    if(leftoverActions) leftoverActions.closest(".edit-status-actions").remove();

    if(!(result && result.written)){
      // The write failed, or wrote something that didn't verify back
      // correctly — either way the real file was NOT changed
      // (metadata-bridge.js / ffmpeg-bridge.js only ever swap in a
      // copy they've already confirmed matches). So the library isn't
      // touched either: no optimistic title/artist/album/art change,
      // no idbPut. The modal stays open (no auto-close) so this can't
      // be missed, the reason is shown, Save is re-enabled so the
      // user can just retry after fixing the cause, and the fallback
      // button below is the only way to keep the edit anyway.
      saveBtn.disabled=false;
      saveBtn.textContent=tr("edit.saveChanges");

      // Nothing on disk changed, so restoring playback just means
      // pointing back at the exact same fileURL it already had.
      if(wasCurrentlyLoaded){
        audioEl.src=t.fileURL;
        audioEl.currentTime=resumePlayback.time;
        if(resumePlayback.wasPlaying) audioEl.play().catch(()=>{});
      }

      if(status){
        status.classList.remove("hidden");
        status.classList.add("is-error");
        status.textContent=tr("edit.fileWriteFailed",{reason:(result && result.reason) || tr("edit.fileNotChanged")});

        const actionsRow=el("div","edit-status-actions");
        const libOnlyBtn=el("button","edit-lib-only-btn",escapeHTML(tr("edit.saveLibraryOnly")));
        libOnlyBtn.type="button";
        libOnlyBtn.id="editSaveLibraryOnlyBtn";
        libOnlyBtn.addEventListener("click",async()=>{
          libOnlyBtn.disabled=true;
          await applyToLibrary();
          status.classList.remove("is-error");
          status.textContent=tr("edit.savedLibraryOnlyConfirmed");
          actionsRow.remove();
          setTimeout(closeModal,1400);
        });
        actionsRow.appendChild(libOnlyBtn);
        status.insertAdjacentElement("afterend",actionsRow);
      }
      return;
    }

    // --- Write verified. Rename the real file to match the edited
    // title/artist too (best-effort, cosmetic — the embedded tags are
    // already correct either way), THEN reflect all of it — tags,
    // artwork, and the (possibly new) path — in the library/UI in one
    // go, so nothing in between is ever half-updated.
    let renameFailedReason=null;
    if(window.electronAPI.renameFile){
      const desiredBase=sanitizeFilename(`${newArtist} - ${newTitle}`);
      const renameResult=await window.electronAPI.renameFile(t.filePath,desiredBase)
        .catch(err=>({renamed:false, reason:String((err&&err.message)||err)}));
      if(renameResult && renameResult.renamed && renameResult.newPath){
        t.filePath=renameResult.newPath;
        // fileURL now points at disk by path (see hydrateTrack()),
        // so a rename has to refresh it too, or the next play/seek
        // would 404 against the old, now-moved filename.
        t.fileURL=filePathToURL(t.filePath);
      } else {
        renameFailedReason=(renameResult && renameResult.reason) || tr("edit.couldntRenameGeneric");
      }
    }

    await applyToLibrary();

    // Restore playback now that the swap is complete — using t.fileURL
    // AFTER applyToLibrary() specifically, since a successful rename
    // just above may have changed it. Restoring any earlier would
    // point <audio> at a path that briefly doesn't exist anymore.
    if(wasCurrentlyLoaded){
      audioEl.src=t.fileURL;
      audioEl.currentTime=resumePlayback.time;
      if(resumePlayback.wasPlaying) audioEl.play().catch(()=>{});
    }

    if(status){
      status.classList.remove("hidden");
      status.classList.remove("is-error");
      if(result.imageIgnored){
        status.textContent=tr("edit.savedButNoCoverArtSupport");
      } else if(!renameFailedReason){
        status.textContent=tr("edit.savedRenamedAndUpdated");
      } else {
        status.textContent=tr("edit.savedTagsButNotRenamed",{reason:renameFailedReason});
      }
    }
    setTimeout(closeModal,1400);
  });
}



// Builds the "Sync Lyrics" modal: lets the user nudge a track's
// lyric timing forward or backward, in milliseconds, until the
// highlighted line lines up with what's actually being sung.
// Positive delays the lyrics (each line shows later); negative
// shows them earlier (see syncLyrics() for how the offset is
// applied). The offset is saved per-track alongside its cached
// lyrics (idbPut("lyrics", ...)), so it's remembered every time
// this song's lyrics are shown again. Pass a specific track (e.g.
// from a song row's "⋮" menu) to sync that song; called with no
// argument (e.g. from the player panel's side menu) it falls back
// to whatever's currently playing.
async function openSyncModal(track){
  const t=track||state.currentTrack;

  if(!t){
    openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("empty.nothingPlayingSync"))}</p>`);
    return;
  }

  openModal(tr("side.syncLyrics"), `<p class='info-empty'>${escapeHTML(tr("lyrics.loading"))}</p>`);
  const lines=await fetchLyricsFor(t);
  if($("modalOverlay").classList.contains("hidden")) return; // closed while loading

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

  // Applies the current offsetMs immediately: saves it (in memory +
  // IndexedDB) and, if this track's lyrics pane is open right now,
  // forces syncLyrics() to recompute on the very next tick so the
  // effect is visible right away instead of waiting for the line to
  // naturally change.
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

  // Free-typed offset entry. Keydown blocks anything that isn't a
  // digit, a leading "-" (negative = "show lyrics earlier"), or a
  // navigation/editing key, so bad characters never even land in
  // the field. The input handler is a second line of defense for
  // anything that slips in anyway (e.g. pasting "12a3ms"): it
  // strips everything but digits/minus and collapses stray minus
  // signs down to a single leading one. The value is only parsed
  // into offsetMs (and applied/saved) once the user commits — on
  // Enter or on blur — same moment a nudge button would apply it.
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



/* ================================================================
   EVENTS / BINDINGS
   Wires up every static button/input in the page (one time, on
   startup) to the functions above. Buttons that are re-created on
   every render — like the per-song "⋮" menu or the Folders tab's
   "Add Songs"/"Add Folder" buttons — get their listeners attached
   inline where they're created instead of here.
   ================================================================ */
function bindEvents(){

  // --- Global playback shortcuts ---
  // Without this, these keys normally do whatever the
  // currently-focused element defines (click a focused button,
  // scroll the page, move a text cursor, etc.) — so the same key
  // press could mean different things depending on where you'd last
  // clicked. This intercepts all of them everywhere and makes them
  // ALWAYS mean the same thing, with one shared exception: typing in
  // a text field (search box, rename inputs, Edit modal fields, ...)
  // is left completely alone, same as the original Space-only
  // version of this handler.
  //
  //   Space                        play / pause (unchanged from before)
  //   M                             mute / unmute
  //   ArrowUp / ArrowDown           volume up / down, 5 percentage points per press
  //   ArrowLeft / ArrowRight        seek back / forward 5 seconds
  //   Ctrl/Cmd+ArrowLeft/ArrowRight previous / next track
  //
  // Space and M are one-shot toggles, so (like the original Space
  // handler) they ignore key-repeat from a held-down key. The arrow
  // shortcuts deliberately do NOT ignore repeat — holding Right to
  // scrub forward or holding Up to ramp the volume up is normal,
  // expected behavior for those.
  document.addEventListener("keydown",(e)=>{
    const t=e.target;
    const isTyping = t && (t.tagName==="INPUT" || t.tagName==="TEXTAREA" || t.isContentEditable);
    if(isTyping) return;

    if((e.code==="Space" || e.key===" ") && !e.repeat){
      e.preventDefault();     // stop the browser's default space behavior (button click, page scroll)
      togglePlay();
      return;
    }

    if(e.code==="KeyM" && !e.repeat){
      e.preventDefault();
      toggleMute();
      return;
    }

    if(e.code==="ArrowUp"){
      e.preventDefault();     // stop the page from scrolling
      adjustVolume(0.05);
      return;
    }
    if(e.code==="ArrowDown"){
      e.preventDefault();
      adjustVolume(-0.05);
      return;
    }

    if(e.code==="ArrowRight"){
      e.preventDefault();
      if(e.ctrlKey || e.metaKey) nextTrack(false);
      else seekBy(5);
      return;
    }
    if(e.code==="ArrowLeft"){
      e.preventDefault();
      if(e.ctrlKey || e.metaKey) prevTrack();
      else seekBy(-5);
      return;
    }
  });


  // --- Nav rail: switch which list is shown ---
  document.querySelectorAll(".rail-item[data-tab]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".rail-item[data-tab]").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      state.currentTab=btn.dataset.tab;
      state.filter=null;
      searchInput.value="";
      renderTab();
    });
  });


  // --- Back button + search toggle/input ---
  backBtn.addEventListener("click",()=>{ state.filter=null; searchInput.value=""; renderTab(); });
  searchToggle.addEventListener("click",()=>{
    searchRow.classList.toggle("hidden");
    if(!searchRow.classList.contains("hidden")) searchInput.focus();
    else { searchInput.value=""; renderTab(); }
  });
  searchInput.addEventListener("input",debounce(renderTab,120));


  // --- Locate button scrolls the list to the currently playing song ---
  locatePlayingToggle.addEventListener("click",scrollToNowPlaying);


  // --- Sort button opens the sort-order menu ---
  $("sortToggle").addEventListener("click",(e)=>{ e.stopPropagation(); openSortMenu(e); });


  // --- Add-music button (only visible inside a playlist view) ---
  addMusicToggle.addEventListener("click",()=>{
    if(state.filter && state.filter.type==="playlist") openAddMusicModal(state.filter.playlistId);
  });


  // --- Select button + bulk-action bar (Add to Playlist / Delete / Cancel) ---
  selectToggle.addEventListener("click",toggleSelectMode);
  $("selCancelBtn").addEventListener("click",toggleSelectMode);
  $("selDeleteBtn").addEventListener("click",deleteSelectedItems);
  $("selAddPlaylistBtn").addEventListener("click",openAddSelectedToPlaylistModal);


  // --- Drag a file onto the app anywhere -> add it (if new) and
  // start playing it immediately. See wireDragAndDropPlay() below. ---
  wireDragAndDropPlay();


  // --- Hidden file inputs (now triggered from the Folders tab) ---
  $("filesInput").addEventListener("change",(e)=>{ ingestFiles(e.target.files,null); e.target.value=""; });
  $("folderInput").addEventListener("change",(e)=>{
    const files=e.target.files;
    if(!files.length){ e.target.value=""; return; }
    let folderName="Folder";
    const rel=files[0].webkitRelativePath;
    if(rel) folderName=rel.split("/")[0];
    ingestFiles(files,folderName);
    e.target.value="";
  });

  // Convert tab's "Browse Files" — see CONVERT TAB above. Deliberately
  // NOT ingestFiles(): this never touches the music library.
  $("convertFilesInput").addEventListener("change",(e)=>{
    const files=e.target.files;
    if(files.length) addFilesToConvertQueue(files);
    e.target.value="";
  });


  // --- Transport controls (desktop player panel) ---
  // Every button here besides #playBtn also gets a small "alive"
  // flourish via pulseCtrlBtn() — see the TRANSPORT ROW comment in
  // styles.css. #playBtn is untouched, per its own liquid-glass morph.
  $("playBtn").addEventListener("click",togglePlay);
  $("nextBtn").addEventListener("click",()=>{ pulseCtrlBtn("nextBtn","skip-kick",380,"ctrl-streak"); nextTrack(false); });
  $("prevBtn").addEventListener("click",()=>{ pulseCtrlBtn("prevBtn","skip-kick",380,"ctrl-streak"); prevTrack(); });
  $("shuffleBtn").addEventListener("click",()=>{
    state.shuffle=!state.shuffle;
    if(!state.shuffle) state.shuffleHistory=[];   // turning shuffle off invalidates the retrace trail
    // The shuffle pick memoized in resolveNextIndex() (see
    // shuffleNextPick above) was only ever valid for "shuffle was ON,
    // for this current track" — it's now stale either way (shuffle
    // just turned off, so it no longer applies at all; or just turned
    // on, and Test 3 expects a genuinely fresh roll rather than
    // silently reusing whatever the last roll happened to be, since
    // the memo's forId key wouldn't have changed). Clearing it here
    // forces the very next resolveNextIndex() call to recalculate
    // from scratch instead of returning a leftover value.
    shuffleNextPick=null;
    $("shuffleBtn").classList.toggle("active",state.shuffle);
    pulseCtrlBtn("shuffleBtn","shuffle-spin",520);
    refreshNextPreview(); // this is the actual fix — see refreshNextPreview()'s comment for why it was missing before
  });
  $("repeatBtn").addEventListener("click",()=>{ cycleRepeatMode(); pulseCtrlBtn("repeatBtn","repeat-flip",520); });
  $("lyricsBtn").addEventListener("click",toggleLyrics);
  $("loveBtn").addEventListener("click",()=>{ if(state.currentTrack){ toggleFavorite(state.currentTrack); } });


  // --- Transport controls (mobile mini-player bar) ---
  $("miniPlay").addEventListener("click",togglePlay);
  $("miniNext").addEventListener("click",()=>{ pulseCtrlBtn("miniNext","skip-kick",380,"ctrl-streak"); nextTrack(false); });
  $("miniPrev").addEventListener("click",()=>{ pulseCtrlBtn("miniPrev","skip-kick",380,"ctrl-streak"); prevTrack(); });


  // --- Mobile now-playing overlay open/close ---
  $("miniInfo").addEventListener("click",()=>playerPanel.classList.add("expanded"));
  $("closeOverlay").addEventListener("click",()=>playerPanel.classList.remove("expanded"));


  // --- App menu (☰) with its Settings / About Us dropdown entries ---
  $("railToggle").addEventListener("click",(e)=>{ e.stopPropagation(); toggleRail(); });
  $("railSettingsBtn").addEventListener("click",openSettingsModal);
  $("railAboutBtn").addEventListener("click",openAboutModal);


  // --- Side menu (☰) with its Info / Edit dropdown entries ---
  $("sideMenuBtn").addEventListener("click",(e)=>{ e.stopPropagation(); toggleSideDropdown(); });
  $("menuInfoBtn").addEventListener("click",()=>{ closeSideDropdown(); openInfoModal(); });
  $("menuEditBtn").addEventListener("click",()=>{ closeSideDropdown(); openEditModal(); });
  $("menuSyncBtn").addEventListener("click",()=>{ closeSideDropdown(); openSyncModal(); });
  $("menuSleepBtn").addEventListener("click",()=>{ closeSideDropdown(); openSleepTimerModal(); });


  // --- Volume button + its vertical slider popup ---
  volumeBtn.addEventListener("click",(e)=>{ e.stopPropagation(); toggleVolumePopup(); });
  volumeSlider.addEventListener("input",(e)=>{ setVolume(e.target.value/100); });


  // --- Info/Edit modal close (✕ button, or clicking the dark backdrop) ---
  $("modalCloseBtn").addEventListener("click",closeModal);
  $("modalOverlay").addEventListener("click",(e)=>{ if(e.target.id==="modalOverlay") closeModal(); });
}



/* ================================================================
   DESKTOP "OPEN WITH" INTEGRATION (Electron only)
   Guarded behind window.electronAPI so this block is a total no-op
   on any build that isn't Electron (a plain browser tab, a future
   Android/Capacitor wrapper, etc.) — nothing here runs unless the
   preload script exposed the bridge.

   When the OS hands the app an audio file (double-click, "Open
   with", drag onto the .exe/.app, second-instance on Windows), main.js
   reads it and sends {name, mime, data} over IPC. We rebuild that
   into a real File object and feed it through the same ingestFiles()/
   playTrack() path used for manually added songs — but with
   persist:false, so it plays immediately like any other track
   without being written into the Songs library. If it's already a
   real library track, ingestFiles() just hands back that existing
   (persisted) entry as usual, per its duplicate guard. See
   ingestFiles()/libraryTracks() further up for the full picture.
   ================================================================ */
if(window.electronAPI){
  window.electronAPI.onOpenFile(async (payload)=>{
    if(!payload || !payload.data) return;

    const bytes = payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data);
    const file = new File([bytes], payload.name, {type: payload.mime});
    // This File was rebuilt from raw bytes, so webUtils.getPathForFile()
    // can't resolve it (see resolveFilePath() further up) — stash the
    // real path main.js already knew about directly on the object.
    if(payload.path) file.__electronPath=payload.path;

    // ingestFiles() now hands back the track it actually ended up
    // with for this file - either a brand-new, temporary/unpersisted
    // one (persist:false — see its comment), or the existing library
    // track it matched. Either way we just play that, so reopening a
    // song you already have plays your existing copy instead of
    // adding (and playing) a duplicate.
    const [track] = await ingestFiles([file], null, {persist:false});

    if(track){
      playTrack(track, [track]);
    } else {
      console.warn("Opened file wasn't a supported audio file, ignoring:", payload.name);
    }
  });

  // Convert tab — see startFFmpegInstall()/the Conversion Manager
  // (startConversion()) above. Both of these are pure event streams:
  // the matching ffmpegInstall()/convertFile() calls already resolve
  // once each with a final result, this is just the "here's what's
  // happening right now" updates in between.
  window.electronAPI.onFFmpegInstallProgress(({line})=>{
    if(line==null) return;
    state.convert.installLog.push(line);
    if(state.currentTab==="convert" && state.convert.ffmpegStatus==="installing") renderTab();
  });
  window.electronAPI.onConvertProgress(handleConvertProgressTick);
}

})();
