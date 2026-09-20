import { state, idbPut, idbDelete, uid, AUDIO_EXT } from "./state.js";
import { renderTab } from "./library-view.js";
import {
  hydrateTrack,
  filePathToURL,
  resolveFilePath,
  deriveFolderRootPath,
} from "./init.js";
import { removeTrackData } from "./playlists.js";
import { normalizeReaderResult, METADATA_FIELD_KEYS } from "./metadata-normalize.js";

function sanitizeFilename(name) {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 180) || "Untitled"
  );
}

function toStoreRecord(track) {
  const record = {
    id: track.id,
    duration: track.duration,
    folderId: track.folderId,
    dateAdded: track.dateAdded,
    fileBlob: track.fileBlob,
    artBlob: track.artBlob,
    filePath: track.filePath,
    metadataBackfilled: !!track.metadataBackfilled,
  };
  for (const key of METADATA_FIELD_KEYS) record[key] = track[key];
  return record;
}

function applyMetadataFields(track, normalized, overwrite, keys = METADATA_FIELD_KEYS) {
  let changed = false;
  for (const key of keys) {
    const incoming = normalized[key];
    const isEmpty =
      incoming == null || (Array.isArray(incoming) && !incoming.length);
    if (isEmpty) continue;
    const current = track[key];
    const currentIsEmpty =
      current == null || (Array.isArray(current) && !current.length);
    if (!overwrite && !currentIsEmpty) continue;
    track[key] = incoming;
    changed = true;
  }
  return changed;
}

async function backfillMetadata() {
  const targets = state.tracks.filter(
    (t) => !t.metadataBackfilled && !t.external && (t.filePath || t.fileBlob),
  );
  if (!targets.length) return;

  let anyChanged = false;
  for (const t of targets) {
    let normalized = null;
    let readOk = false;
    if (t.filePath && window.electronAPI && window.electronAPI.getAudioMetadata) {
      try {
        const meta = await window.electronAPI.getAudioMetadata(t.filePath);
        if (meta) {
          normalized = normalizeReaderResult(meta);
          readOk = true;
        }
      } catch (e) {
        console.warn("backfillMetadata: getAudioMetadata failed for", t.filePath, e);
      }
    } else if (t.fileBlob) {
      try {
        const tags = await readTags(t.fileBlob);
        normalized = normalizeReaderResult(tags);
        readOk = true;
      } catch (e) {
        console.warn("backfillMetadata: readTags failed for", t.title, e);
      }
    }

    if (readOk) {
      if (normalized && applyMetadataFields(t, normalized, false)) {
        anyChanged = true;
      }
      t.metadataBackfilled = true;
      await idbPut("tracks", toStoreRecord(t)).catch(() => {});
    }
  }
  if (anyChanged) renderTab();
}

function longestCommonDirectory(paths) {
  if (!paths.length) return null;
  const sep = paths[0].includes("\\") ? "\\" : "/";
  const partsList = paths.map((p) => p.split(sep));
  let common = partsList[0].slice(0, -1);
  for (let i = 1; i < partsList.length; i++) {
    const parts = partsList[i].slice(0, -1);
    let j = 0;
    while (j < common.length && j < parts.length && common[j] === parts[j]) j++;
    common = common.slice(0, j);
    if (!common.length) return null;
  }
  return common.length ? common.join(sep) : null;
}

function backfillFolderPaths() {
  let changed = false;
  state.folders.forEach((f) => {
    if (f.path) return;
    const paths = state.tracks
      .filter((t) => t.folderId === f.id && t.filePath)
      .map((t) => t.filePath);
    if (!paths.length) return;
    const common = longestCommonDirectory(paths);
    if (common) {
      f.path = common;
      idbPut("folders", f);
      changed = true;
    }
  });
  return changed;
}

const INGEST_CONCURRENCY = 25;

async function ingestDiscoveredPaths(paths, folderId) {
  if (!paths.length) return false;
  let addedAny = false;

  const knownPaths = new Set(
    state.tracks.filter((t) => !t.external).map((t) => t.filePath),
  );

  for (let i = 0; i < paths.length; i += INGEST_CONCURRENCY) {
    const batch = paths.slice(i, i + INGEST_CONCURRENCY).filter((filePath) => {
      if (knownPaths.has(filePath)) return false;
      knownPaths.add(filePath);
      return true;
    });
    if (!batch.length) continue;

    const metas = await Promise.all(
      batch.map((filePath) =>
        window.electronAPI.getAudioMetadata(filePath).catch((e) => {
          console.warn(
            "ingestDiscoveredPaths: getAudioMetadata failed for",
            filePath,
            e,
          );
          return null;
        }),
      ),
    );

    batch.forEach((filePath, idx) => {
      const meta = metas[idx];
      if (!meta) return;
      const normalized = normalizeReaderResult(meta);

      const fileName = filePath.split(/[\\/]/).pop();
      const guess = guessFromName(fileName);
      const title = normalized.title || guess.title;
      const artist = normalized.artist || guess.artist;
      const artBlob =
        meta.picture && meta.picture.data
          ? new Blob([new Uint8Array(meta.picture.data)], {
              type: meta.picture.format || "image/jpeg",
            })
          : null;

      const track = {
        ...normalized,
        id: uid(),
        title,
        artist,
        album: normalized.album || "Unknown Album",
        duration: meta.duration || 0,
        folderId,
        dateAdded: Date.now(),
        fileBlob: null,
        artBlob,
        filePath,
        metadataBackfilled: true,
      };
      hydrateTrack(track);
      state.tracks.push(track);
      addedAny = true;

      idbPut("tracks", toStoreRecord(track));
    });
  }
  return addedAny;
}

function pruneFolder(folder) {
  const tracksInFolder = state.tracks.filter((t) => t.folderId === folder.id);
  tracksInFolder.forEach((t) => removeTrackData(t));

  state.folders = state.folders.filter((f) => f.id !== folder.id);
  idbDelete("folders", folder.id);

  if (state.filter && state.filter.type === "folder") {
    state.filter.tracks = state.filter.tracks.filter(
      (t) => t.folderId !== folder.id,
    );
  }
}

async function rescanFolders() {
  if (!window.electronAPI || !window.electronAPI.scanFolder) return false;
  let addedAny = false;

  for (const folder of state.folders) {
    if (!folder.path) continue;

    let foundPaths = [];
    try {
      foundPaths = await window.electronAPI.scanFolder(folder.path);
    } catch (e) {
      console.warn("rescanFolders: scanFolder failed for", folder.path, e);
      continue;
    }
    if (!foundPaths.length) continue;

    const known = new Set(
      state.tracks
        .filter((t) => t.folderId === folder.id)
        .map((t) => t.filePath),
    );
    const newPaths = foundPaths.filter((p) => !known.has(p));
    if (!newPaths.length) continue;

    const added = await ingestDiscoveredPaths(newPaths, folder.id);
    if (added) addedAny = true;
  }
  return addedAny;
}

async function verifyLibraryOnDisk() {
  if (!window.electronAPI || !window.electronAPI.checkPathsExist) return;

  backfillFolderPaths();

  const folderPaths = state.folders.filter((f) => f.path).map((f) => f.path);
  const trackPaths = state.tracks
    .filter((t) => t.filePath)
    .map((t) => t.filePath);
  if (!folderPaths.length && !trackPaths.length) return;

  let existence = {};
  try {
    existence = await window.electronAPI.checkPathsExist([
      ...folderPaths,
      ...trackPaths,
    ]);
  } catch (e) {
    console.warn("verifyLibraryOnDisk: checkPathsExist failed", e);
    return;
  }

  let changed = false;

  const goneFolders = state.folders.filter(
    (f) => f.path && existence[f.path] === false,
  );
  goneFolders.forEach((f) => {
    pruneFolder(f);
    changed = true;
  });

  const goneFolderIds = new Set(goneFolders.map((f) => f.id));
  state.tracks
    .filter(
      (t) =>
        t.filePath &&
        existence[t.filePath] === false &&
        !goneFolderIds.has(t.folderId),
    )
    .forEach((t) => {
      removeTrackData(t);
      changed = true;
    });

  if (changed) renderTab();

  const rescanChanged = await rescanFolders();
  if (rescanChanged) renderTab();
}

function guessFromName(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  const parts = base.split(" - ");
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(" - ").trim(),
    };
  }
  return { artist: "Unknown Artist", title: base };
}

function parseNumberWithTotal(raw) {
  if (raw === undefined || raw === null || raw === "") return { no: null, of: null };
  const [noPart, ofPart] = String(raw).split("/");
  const no = parseInt(noPart, 10);
  const of = ofPart != null ? parseInt(ofPart, 10) : null;
  return {
    no: Number.isFinite(no) ? no : null,
    of: Number.isFinite(of) ? of : null,
  };
}

function readTags(file) {
  return new Promise((resolve) => {
    if (typeof jsmediatags === "undefined") {
      resolve({});
      return;
    }
    jsmediatags.read(file, {
      onSuccess: (tag) => {
        const t = tag.tags || {};
        let picture = null;
        if (t.picture) {
          picture = { data: t.picture.data, format: t.picture.format };
        }
        const albumArtist =
          (t.TPE2 && t.TPE2.data) || t.albumartist || t.album_artist || null;
        const composerRaw = (t.TCOM && t.TCOM.data) || null;
        const track = parseNumberWithTotal(t.track);
        const disc = parseNumberWithTotal(t.TPOS && t.TPOS.data);
        resolve({
          title: t.title || null,
          artist: t.artist || null,
          albumArtist,
          album: t.album || null,
          trackNum: track.no,
          trackTotal: track.of,
          discNumber: disc.no,
          discTotal: disc.of,
          year: t.year ? parseInt(t.year, 10) || null : null,
          genre: t.genre ? [t.genre] : [],
          composer: composerRaw ? [composerRaw] : [],
          picture,
        });
      },
      onError: () => resolve({}),
    });
  });
}

function getDuration(url) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;
    a.onloadedmetadata = () => resolve(a.duration || 0);
    a.onerror = () => resolve(0);
  });
}

async function ingestFiles(fileList, folderName, opts = {}) {
  const persist = opts.persist !== false;
  const files = Array.from(fileList).filter((f) => {
    const ext = f.name.split(".").pop().toLowerCase();
    return AUDIO_EXT.includes(ext) || f.type.startsWith("audio/");
  });
  if (!files.length) return [];

  let folderId = null;
  if (folderName) {
    let existing = state.folders.find((f) => f.name === folderName);
    if (!existing) {
      existing = { id: uid(), name: folderName, path: null };
      state.folders.push(existing);
      await idbPut("folders", existing);
    }
    folderId = existing.id;
  }

  const resultTracks = [];
  let addedAny = false;

  for (const file of files) {
    const rawTags = await readTags(file);
    const normalized = normalizeReaderResult(rawTags);
    const guess = guessFromName(file.name);
    const title = normalized.title || guess.title;
    const artist = normalized.artist || guess.artist;

    const filePath = resolveFilePath(file);

    if (folderId) {
      const folderObj = state.folders.find((f) => f.id === folderId);
      if (folderObj && !folderObj.path) {
        const rootPath = deriveFolderRootPath(file, filePath);
        if (rootPath) {
          folderObj.path = rootPath;
          idbPut("folders", folderObj);
        }
      }
    }

    const existingTrack = state.tracks.find((t) => {
      const sameTitleArtist =
        (t.title || "").trim().toLowerCase() === title.trim().toLowerCase() &&
        (t.artist || "").trim().toLowerCase() === artist.trim().toLowerCase();
      if (!sameTitleArtist) return false;
      return filePath
        ? t.filePath === filePath
        : t.fileBlob && t.fileBlob.size === file.size;
    });
    if (existingTrack) {
      if (persist && existingTrack.external) {
        existingTrack.external = false;
        idbPut("tracks", toStoreRecord(existingTrack));
        addedAny = true;
      }
      resultTracks.push(existingTrack);
      continue;
    }

    const fileBlob = filePath ? null : file;
    const fileURL = filePath
      ? filePathToURL(filePath)
      : URL.createObjectURL(fileBlob);
    const duration = await getDuration(fileURL);
    const track = {
      ...normalized,
      id: uid(),
      title,
      artist,
      album: normalized.album || "Unknown Album",
      duration,
      folderId,
      dateAdded: Date.now(),
      fileBlob,
      artBlob:
        rawTags.picture && rawTags.picture.data
          ? new Blob([new Uint8Array(rawTags.picture.data)], {
              type: rawTags.picture.format || "image/jpeg",
            })
          : null,
      filePath,
      external: !persist,
      metadataBackfilled: !filePath,
    };
    hydrateTrack(track);
    state.tracks.push(track);
    resultTracks.push(track);
    addedAny = true;

    if (persist) {
      idbPut("tracks", toStoreRecord(track));
    }
  }
  if (addedAny) renderTab();
  return resultTracks;
}

function libraryTracks() {
  return state.tracks.filter((t) => !t.external);
}

export {
  sanitizeFilename,
  toStoreRecord,
  applyMetadataFields,
  backfillMetadata,
  pruneFolder,
  verifyLibraryOnDisk,
  ingestFiles,
  libraryTracks,
};
