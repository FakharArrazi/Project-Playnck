import { state, $, audioEl, idbPut } from "./state.js";
import { el } from "./utils.js";
import { renderTab, updateSelectionBar } from "./library-view.js";
import { openSettingsModal } from "./settings.js";

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

export { LANGUAGES, tr, plural, SELECT_TYPE_PLURAL_KEY, pluralWord, themeBgLabel, themeAccentLabel, applyI18n, setLanguage, addLanguage };
