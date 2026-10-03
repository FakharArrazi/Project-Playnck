const path = require("path");
const fs = require("fs");
const { graftUnknownFrames } = require("./id3-preserve");
const {
  buildPlan,
  fillPairs,
  pairText,
  canonicalFromParsed,
  verifyPlan,
  unsupportedLabels,
} = require("./tag-fields");

const EXT_MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

const MP3_SUPPORTED = null; // ID3 can hold every field Playnck edits.
const M4A_EXTS = new Set([".m4a", ".mp4", ".m4b"]);

async function getAudioMetadata(filePath) {
  if (!filePath) return null;

  const mm = await import("music-metadata");
  const meta = await mm.parseFile(filePath, {
    duration: true,
    skipCovers: false,
  });
  const fmt = meta.format || {};
  const common = meta.common || {};

  let fileSize = null;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch (err) {
    console.error("getAudioMetadata: couldn't stat file for size:", err);
  }

  return {
    bitrate: fmt.bitrate ? Math.round(fmt.bitrate / 1000) : null,
    codec: fmt.codec || null,
    sampleRate: fmt.sampleRate || null,
    bitsPerSample: fmt.bitsPerSample || null,
    lossless: !!fmt.lossless,
    container: fmt.container || null,
    duration: fmt.duration || null,
    fileSize,
    mimeType: EXT_MIME_TYPES[path.extname(filePath).toLowerCase()] || null,
    ...canonicalFromParsed(meta),
    picture:
      common.picture && common.picture.length
        ? {
            data: Buffer.from(common.picture[0].data),
            format: common.picture[0].format || "image/jpeg",
          }
        : null,
  };
}

// ---------------------------------------------------------------- MP3 (ID3)

const MB_TXXX = {
  releaseId: "MusicBrainz Album Id",
  releaseGroupId: "MusicBrainz Release Group Id",
  artistIds: "MusicBrainz Artist Id",
  albumArtistIds: "MusicBrainz Album Artist Id",
};
const MB_UFID_OWNER = "http://musicbrainz.org";

function setTxxx(raw, description, value) {
  const wanted = description.toLowerCase();
  const list = (Array.isArray(raw.TXXX) ? raw.TXXX : []).filter(
    (f) => f && String(f.description || "").toLowerCase() !== wanted,
  );
  if (value != null) list.push({ description, value });
  if (list.length) raw.TXXX = list;
  else delete raw.TXXX;
}

function applyPlanToId3(raw, plan) {
  const s = plan.set;
  const has = (k) => Object.prototype.hasOwnProperty.call(s, k);
  const put = (id, value) => {
    if (value == null || value === "") delete raw[id];
    else raw[id] = value;
  };
  const join = (v) => (v && v.length ? v.join("/") : null);
  const keepLang = (frame, text) =>
    text == null
      ? null
      : {
          language: (frame && frame.language) || "eng",
          shortText: (frame && frame.shortText) || "",
          text,
        };

  if (has("title")) put("TIT2", s.title);
  if (has("artist")) put("TPE1", s.artist);
  if (has("album")) put("TALB", s.album);
  if (has("albumArtist")) put("TPE2", s.albumArtist);
  if (has("genre")) put("TCON", join(s.genre));
  if (has("composer")) put("TCOM", join(s.composer));
  if (has("lyricist")) put("TEXT", join(s.lyricist));
  if (has("conductor")) put("TPE3", s.conductor);
  if (has("grouping")) put("TIT1", s.grouping);
  if (has("subtitle")) put("TIT3", s.subtitle);
  if (has("label")) put("TPUB", s.label);
  if (has("copyright")) put("TCOP", s.copyright);
  if (has("isrc")) put("TSRC", s.isrc);
  if (has("bpm")) put("TBPM", s.bpm == null ? null : String(s.bpm));
  if (has("compilation")) put("TCMP", s.compilation ? "1" : null);
  if (has("comment")) put("COMM", keepLang(raw.COMM, s.comment));
  if (has("lyrics")) put("USLT", keepLang(raw.USLT, s.lyrics));
  if (has("artists")) setTxxx(raw, "ARTISTS", join(s.artists));
  for (const [key, description] of Object.entries(MB_TXXX)) {
    if (!has(key)) continue;
    setTxxx(raw, description, Array.isArray(s[key]) ? join(s[key]) : s[key]);
  }
  if (has("recordingId")) {
    const others = (Array.isArray(raw.UFID) ? raw.UFID : []).filter(
      (f) => f && f.ownerIdentifier !== MB_UFID_OWNER,
    );
    if (s.recordingId)
      others.push({ ownerIdentifier: MB_UFID_OWNER, identifier: s.recordingId });
    if (others.length) raw.UFID = others;
    else delete raw.UFID;
  }

  if (plan.track) put("TRCK", pairText(plan.track.no, plan.track.of));
  if (plan.disc) put("TPOS", pairText(plan.disc.no, plan.disc.of));

  if (plan.release) {
    const { date, year } = plan.release;
    // ID3v2.3 stores the year in TYER (+ DDMM in TDAT); the v2.4 frame TDRC
    // carries the full ISO date. Writing both keeps old and new readers happy.
    put("TYER", year == null ? null : String(year));
    put("TDRC", date || (year != null ? String(year) : null));
    put("TDAT", date && date.length === 10 ? date.slice(8, 10) + date.slice(5, 7) : null);
    delete raw.TIME;
  }
  if (has("originalDate")) {
    put("TDOR", s.originalDate);
    put("TORY", s.originalDate ? s.originalDate.slice(0, 4) : null);
  }

  if (plan.image) {
    if (plan.image.op === "remove") delete raw.APIC;
    else
      raw.APIC = {
        mime: plan.image.mime,
        type: { id: 3, name: "front cover" },
        description: "cover",
        imageBuffer: plan.image.data,
      };
  }
  return raw;
}

async function produceMp3(inputPath, outputPath, plan) {
  const NodeID3 = require("node-id3");
  const input = await fs.promises.readFile(inputPath);
  const raw = NodeID3.read(input, { onlyRaw: true }) || {};
  const understood = new Set(Object.keys(raw));
  applyPlanToId3(raw, plan);
  const written = NodeID3.write(raw, input);
  if (!Buffer.isBuffer(written)) {
    throw new Error(
      (written && written.message) || "node-id3 couldn't build the new tag block.",
    );
  }
  // node-id3 drops frames it doesn't know; carry those over untouched.
  await fs.promises.writeFile(
    outputPath,
    graftUnknownFrames(input, written, understood),
  );
}

// -------------------------------------------------- atomic write + verification

async function commitRewrite(filePath, plan, { produce, supported, verifySkip }) {
  const { retryOnWindowsLock } = require("./ffmpeg-bridge");
  const ext = path.extname(filePath);
  const tmp = path.join(
    path.dirname(filePath),
    `.playnck-tagwrite-${process.pid}-${Date.now()}${ext}`,
  );
  const skipped = supported ? unsupportedLabels(plan, supported) : [];
  try {
    // Swapping a file in by rename would sail past a read-only flag that an
    // in-place write respects, so honour it explicitly.
    await fs.promises.access(filePath, fs.constants.W_OK);
    const { mode } = await fs.promises.stat(filePath);
    await produce(filePath, tmp, plan);
    await fs.promises.chmod(tmp, mode & 0o7777).catch(() => {});

    const mm = await import("music-metadata");
    const parsed = await mm.parseFile(tmp, { duration: false, skipCovers: false });
    const mismatches = verifyPlan(plan, canonicalFromParsed(parsed), verifySkip);
    const pictures = (parsed.common && parsed.common.picture) || [];
    if (plan.image && plan.image.op === "set" && !pictures.length)
      mismatches.push("cover art");
    if (plan.image && plan.image.op === "remove" && pictures.length)
      mismatches.push("cover art removal");
    if (mismatches.length) {
      await fs.promises.unlink(tmp).catch(() => {});
      return {
        written: false,
        reason: `The new tags were written to a temporary copy, but reading it back shows the ${mismatches.join(", ")} didn't stick. The original file wasn't touched.`,
      };
    }

    await retryOnWindowsLock(() => fs.promises.rename(tmp, filePath));
    return { written: true, skipped };
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    const code = err && err.code;
    const reason =
      code === "EACCES" || code === "EPERM" || code === "EBUSY"
        ? `The file is read-only or locked by another program (${code}).`
        : String((err && err.message) || err);
    return { written: false, reason: `Couldn't write to the file: ${reason}` };
  }
}

async function readExistingFields(filePath) {
  const mm = await import("music-metadata");
  return canonicalFromParsed(
    await mm.parseFile(filePath, { duration: false, skipCovers: true }),
  );
}

async function writeAudioTags(filePath, tags) {
  if (!filePath)
    return {
      written: false,
      reason:
        "This track's file location isn't known (it may have been imported from a different device).",
    };

  const ext = path.extname(filePath).toLowerCase();

  let plan;
  try {
    plan = buildPlan(tags);
    const partial =
      (plan.track && (plan.track.no === undefined || plan.track.of === undefined)) ||
      (plan.disc && (plan.disc.no === undefined || plan.disc.of === undefined)) ||
      (plan.release && (plan.release.date === undefined || plan.release.year === undefined));
    fillPairs(plan, partial ? await readExistingFields(filePath) : null);
  } catch (err) {
    return { written: false, reason: String((err && err.message) || err) };
  }

  if (ext === ".mp3") {
    return commitRewrite(filePath, plan, {
      produce: produceMp3,
      supported: MP3_SUPPORTED,
    });
  }
  if (ext === ".flac") {
    const { rewriteFlac, FLAC_SUPPORTED } = require("./flac-tag-writer");
    return commitRewrite(filePath, plan, {
      produce: rewriteFlac,
      supported: FLAC_SUPPORTED,
    });
  }
  if (M4A_EXTS.has(ext)) {
    const { rewriteM4a, M4A_SUPPORTED } = require("./m4a-tag-writer");
    return commitRewrite(filePath, plan, {
      produce: rewriteM4a,
      supported: M4A_SUPPORTED,
    });
  }
  return require("./ffmpeg-bridge").writeTagsViaFFmpeg(filePath, plan);
}

module.exports = { getAudioMetadata, writeAudioTags };
