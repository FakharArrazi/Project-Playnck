// Minimal, dependency-free FLAC tag writer.
//
// A FLAC file is "fLaC" + metadata blocks + audio frames. Only the
// VORBIS_COMMENT (4) and PICTURE (6) blocks are rewritten here; every other
// block (STREAMINFO, SEEKTABLE, APPLICATION, CUESHEET...) is copied verbatim
// and the audio frames are stream-copied untouched. Existing comments that
// this edit doesn't concern are preserved exactly, including repeated keys.

const fs = require("fs");
const { pipeline } = require("stream/promises");

const BLOCK_STREAMINFO = 0;
const BLOCK_PADDING = 1;
const BLOCK_VORBIS_COMMENT = 4;
const BLOCK_PICTURE = 6;

// Fields this writer can store (everything Playnck edits).
const FLAC_SUPPORTED = new Set([
  "title", "artist", "artists", "album", "albumArtist", "genre", "composer",
  "lyricist", "conductor", "grouping", "subtitle", "label", "copyright",
  "isrc", "comment", "lyrics", "bpm", "compilation", "year", "date",
  "originalDate", "trackNum", "trackTotal", "discNumber", "discTotal",
  "recordingId", "releaseId", "releaseGroupId", "artistIds", "albumArtistIds",
]);

function parseFlacMetadata(fd, fileSize) {
  // Optional ID3v2 prefix before the "fLaC" marker: keep it byte-for-byte.
  let start = 0;
  const head = Buffer.alloc(10);
  fs.readSync(fd, head, 0, 10, 0);
  if (head.toString("latin1", 0, 3) === "ID3") {
    const size =
      ((head[6] & 0x7f) << 21) |
      ((head[7] & 0x7f) << 14) |
      ((head[8] & 0x7f) << 7) |
      (head[9] & 0x7f);
    start = 10 + size + (head[5] & 0x10 ? 10 : 0);
  }
  const marker = Buffer.alloc(4);
  fs.readSync(fd, marker, 0, 4, start);
  if (marker.toString("latin1") !== "fLaC") {
    throw new Error("This doesn't look like a valid FLAC file.");
  }

  const blocks = [];
  let pos = start + 4;
  for (;;) {
    if (pos + 4 > fileSize) throw new Error("FLAC metadata is truncated.");
    const h = Buffer.alloc(4);
    fs.readSync(fd, h, 0, 4, pos);
    const last = !!(h[0] & 0x80);
    const type = h[0] & 0x7f;
    const length = (h[1] << 16) | (h[2] << 8) | h[3];
    if (pos + 4 + length > fileSize) throw new Error("FLAC metadata is truncated.");
    const data = Buffer.alloc(length);
    if (length) fs.readSync(fd, data, 0, length, pos + 4);
    blocks.push({ type, data });
    pos += 4 + length;
    if (last) break;
  }
  return { prefixEnd: start, blocks, audioStart: pos };
}

function parseVorbisComment(buf) {
  let p = 0;
  const vendorLen = buf.readUInt32LE(p);
  p += 4;
  const vendor = buf.subarray(p, p + vendorLen).toString("utf8");
  p += vendorLen;
  const count = buf.readUInt32LE(p);
  p += 4;
  const entries = [];
  for (let i = 0; i < count && p + 4 <= buf.length; i++) {
    const len = buf.readUInt32LE(p);
    p += 4;
    const text = buf.subarray(p, p + len).toString("utf8");
    p += len;
    const eq = text.indexOf("=");
    if (eq > 0) entries.push({ key: text.slice(0, eq), value: text.slice(eq + 1) });
  }
  return { vendor, entries };
}

function buildVorbisComment({ vendor, entries }) {
  const parts = [];
  const v = Buffer.from(vendor, "utf8");
  const vl = Buffer.alloc(4);
  vl.writeUInt32LE(v.length);
  parts.push(vl, v);
  const c = Buffer.alloc(4);
  c.writeUInt32LE(entries.length);
  parts.push(c);
  for (const { key, value } of entries) {
    const b = Buffer.from(`${key}=${value}`, "utf8");
    const l = Buffer.alloc(4);
    l.writeUInt32LE(b.length);
    parts.push(l, b);
  }
  return Buffer.concat(parts);
}

// Applies the plan to a list of Vorbis comment entries.
function applyPlanToVorbis(entries, plan) {
  const drop = (...keys) => {
    const set = new Set(keys.map((k) => k.toUpperCase()));
    for (let i = entries.length - 1; i >= 0; i--)
      if (set.has(entries[i].key.toUpperCase())) entries.splice(i, 1);
  };
  const add = (key, values) => {
    for (const value of [].concat(values)) entries.push({ key, value: String(value) });
  };
  const put = (key, value, alsoDrop = []) => {
    drop(key, ...alsoDrop);
    if (value != null && !(Array.isArray(value) && !value.length)) add(key, value);
  };
  const exists = (key) => entries.some((e) => e.key.toUpperCase() === key);

  const s = plan.set;
  const has = (k) => Object.prototype.hasOwnProperty.call(s, k);

  if (has("title")) put("TITLE", s.title);
  if (has("artist")) put("ARTIST", s.artist);
  if (has("artists")) put("ARTISTS", s.artists);
  if (has("album")) put("ALBUM", s.album);
  if (has("albumArtist")) put("ALBUMARTIST", s.albumArtist, ["ALBUM ARTIST"]);
  if (has("genre")) put("GENRE", s.genre);
  if (has("composer")) put("COMPOSER", s.composer);
  if (has("lyricist")) put("LYRICIST", s.lyricist);
  if (has("conductor")) put("CONDUCTOR", s.conductor);
  if (has("grouping")) put("GROUPING", s.grouping);
  if (has("subtitle")) put("SUBTITLE", s.subtitle);
  // LABEL / PUBLISHER / ORGANIZATION are the same concept in practice.
  if (has("label")) put("LABEL", s.label, ["PUBLISHER", "ORGANIZATION"]);
  if (has("copyright")) put("COPYRIGHT", s.copyright);
  if (has("isrc")) put("ISRC", s.isrc);
  if (has("bpm")) put("BPM", s.bpm, ["TEMPO"]);
  if (has("compilation")) put("COMPILATION", s.compilation ? "1" : null);
  if (has("lyrics")) put("LYRICS", s.lyrics, ["UNSYNCEDLYRICS"]);
  if (has("comment")) {
    // Some taggers keep the free-text note in DESCRIPTION; if there is no
    // COMMENT, that's the one the user was looking at, so edit it instead.
    if (exists("COMMENT") || !exists("DESCRIPTION")) put("COMMENT", s.comment);
    else put("DESCRIPTION", s.comment);
  }
  if (has("originalDate")) put("ORIGINALDATE", s.originalDate, ["ORIGINALYEAR"]);

  if (has("recordingId")) put("MUSICBRAINZ_TRACKID", s.recordingId);
  if (has("releaseId")) put("MUSICBRAINZ_ALBUMID", s.releaseId);
  if (has("releaseGroupId")) put("MUSICBRAINZ_RELEASEGROUPID", s.releaseGroupId);
  if (has("artistIds")) put("MUSICBRAINZ_ARTISTID", s.artistIds);
  if (has("albumArtistIds")) put("MUSICBRAINZ_ALBUMARTISTID", s.albumArtistIds);

  if (plan.track) {
    drop("TRACKNUMBER", "TRACKTOTAL", "TOTALTRACKS");
    if (plan.track.no != null) add("TRACKNUMBER", plan.track.no);
    if (plan.track.of != null) add("TRACKTOTAL", plan.track.of);
  }
  if (plan.disc) {
    drop("DISCNUMBER", "DISCTOTAL", "TOTALDISCS");
    if (plan.disc.no != null) add("DISCNUMBER", plan.disc.no);
    if (plan.disc.of != null) add("DISCTOTAL", plan.disc.of);
  }
  if (plan.release) {
    drop("DATE", "YEAR");
    if (plan.release.date) add("DATE", plan.release.date);
    else if (plan.release.year != null) add("DATE", plan.release.year);
  }
  return entries;
}

function imageInfo(data, mime) {
  const info = { width: 0, height: 0, depth: 24 };
  try {
    if (data.length > 24 && data.toString("latin1", 1, 4) === "PNG") {
      info.width = data.readUInt32BE(16);
      info.height = data.readUInt32BE(20);
      const colorType = data[25];
      const bits = data[24];
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] || 3;
      info.depth = bits * channels;
    } else if (data[0] === 0xff && data[1] === 0xd8) {
      let p = 2;
      while (p + 9 < data.length) {
        if (data[p] !== 0xff) {
          p++;
          continue;
        }
        const marker = data[p + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          info.height = data.readUInt16BE(p + 5);
          info.width = data.readUInt16BE(p + 7);
          info.depth = data[p + 4] * data[p + 9] || 24;
          break;
        }
        p += 2 + data.readUInt16BE(p + 2);
      }
    }
  } catch {
    // Dimensions are informational only.
  }
  return info;
}

function buildPictureBlock(data, mime) {
  const mimeBuf = Buffer.from(mime || "image/jpeg", "latin1");
  const { width, height, depth } = imageInfo(data, mime);
  const head = Buffer.alloc(8 + mimeBuf.length + 4 + 20);
  let p = 0;
  head.writeUInt32BE(3, p); // front cover
  p += 4;
  head.writeUInt32BE(mimeBuf.length, p);
  p += 4;
  mimeBuf.copy(head, p);
  p += mimeBuf.length;
  head.writeUInt32BE(0, p); // empty description
  p += 4;
  head.writeUInt32BE(width, p);
  head.writeUInt32BE(height, p + 4);
  head.writeUInt32BE(depth, p + 8);
  head.writeUInt32BE(0, p + 12);
  head.writeUInt32BE(data.length, p + 16);
  return Buffer.concat([head, data]);
}

function pictureType(blockData) {
  return blockData.length >= 4 ? blockData.readUInt32BE(0) : -1;
}

async function rewriteFlac(inputPath, outputPath, plan) {
  const fd = fs.openSync(inputPath, "r");
  let parsed;
  let prefix;
  try {
    parsed = parseFlacMetadata(fd, fs.fstatSync(fd).size);
    prefix = Buffer.alloc(parsed.prefixEnd);
    if (parsed.prefixEnd) fs.readSync(fd, prefix, 0, parsed.prefixEnd, 0);
  } finally {
    fs.closeSync(fd);
  }

  let vorbis = null;
  const kept = [];
  for (const block of parsed.blocks) {
    if (block.type === BLOCK_VORBIS_COMMENT) {
      vorbis = parseVorbisComment(block.data);
      continue;
    }
    if (block.type === BLOCK_PADDING) continue;
    if (block.type === BLOCK_PICTURE && plan.image) {
      if (plan.image.op === "remove") continue;
      if (pictureType(block.data) === 3) continue;
    }
    kept.push(block);
  }
  if (!vorbis) vorbis = { vendor: "Playnck", entries: [] };
  applyPlanToVorbis(vorbis.entries, plan);

  const outBlocks = [];
  // STREAMINFO must stay first.
  const streamInfoIdx = kept.findIndex((b) => b.type === BLOCK_STREAMINFO);
  const ordered = [...kept];
  const streamInfo = streamInfoIdx >= 0 ? ordered.splice(streamInfoIdx, 1)[0] : null;
  if (streamInfo) outBlocks.push(streamInfo);
  outBlocks.push({ type: BLOCK_VORBIS_COMMENT, data: buildVorbisComment(vorbis) });
  outBlocks.push(...ordered);
  if (plan.image && plan.image.op === "set") {
    outBlocks.push({
      type: BLOCK_PICTURE,
      data: buildPictureBlock(plan.image.data, plan.image.mime),
    });
  }

  const chunks = [prefix, Buffer.from("fLaC", "latin1")];
  outBlocks.forEach((block, i) => {
    if (block.data.length > 0xffffff) {
      throw new Error("A FLAC metadata block can't be larger than 16 MB.");
    }
    const h = Buffer.alloc(4);
    h[0] = (i === outBlocks.length - 1 ? 0x80 : 0) | block.type;
    h[1] = (block.data.length >> 16) & 0xff;
    h[2] = (block.data.length >> 8) & 0xff;
    h[3] = block.data.length & 0xff;
    chunks.push(h, block.data);
  });
  await fs.promises.writeFile(outputPath, Buffer.concat(chunks));
  await pipeline(
    fs.createReadStream(inputPath, { start: parsed.audioStart }),
    fs.createWriteStream(outputPath, { flags: "a" }),
  );
}

module.exports = { rewriteFlac, FLAC_SUPPORTED, applyPlanToVorbis };
