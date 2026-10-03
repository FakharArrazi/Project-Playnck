// Dependency-free M4A (MP4 audio) tag writer.
//
// FFmpeg's MP4 muxer silently drops BPM, label, ISRC, original date,
// MusicBrainz IDs and every other "freeform" atom, which also destroys any of
// those already in the file. This writer instead edits only the iTunes-style
// `moov/udta/meta/ilst` atom: items the edit doesn't concern are copied
// byte-for-byte, the audio (`mdat`) is stream-copied untouched, and if `moov`
// sits before `mdat` the chunk offsets (stco/co64) are shifted to match.

const fs = require("fs");
const { pipeline } = require("stream/promises");

const M4A_SUPPORTED = new Set([
  "title", "artist", "artists", "album", "albumArtist", "genre", "composer",
  "lyricist", "conductor", "grouping", "subtitle", "label", "copyright",
  "isrc", "comment", "lyrics", "bpm", "compilation", "year", "date",
  "originalDate", "trackNum", "trackTotal", "discNumber", "discTotal",
  "recordingId", "releaseId", "releaseGroupId", "artistIds", "albumArtistIds",
]);

const FREEFORM_MEAN = "com.apple.iTunes";
const TEXT_ATOMS = {
  title: "\u00a9nam",
  artist: "\u00a9ART",
  album: "\u00a9alb",
  albumArtist: "aART",
  genre: "\u00a9gen",
  composer: "\u00a9wrt",
  grouping: "\u00a9grp",
  copyright: "cprt",
  comment: "\u00a9cmt",
  lyrics: "\u00a9lyr",
};
const FREEFORM_ATOMS = {
  lyricist: "LYRICIST",
  conductor: "CONDUCTOR",
  subtitle: "SUBTITLE",
  label: "LABEL",
  isrc: "ISRC",
  originalDate: "ORIGINALDATE",
  artists: "ARTISTS",
  recordingId: "MusicBrainz Track Id",
  releaseId: "MusicBrainz Album Id",
  releaseGroupId: "MusicBrainz Release Group Id",
  artistIds: "MusicBrainz Artist Id",
  albumArtistIds: "MusicBrainz Album Artist Id",
};
const CONTAINERS = new Set(["trak", "mdia", "minf", "stbl"]);

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u16 = (n) => {
  if (n < 0 || n > 0xffff) throw new Error("Track and disc numbers in M4A files can't exceed 65535.");
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};

function typeBuf(type) {
  return Buffer.isBuffer(type) ? type : Buffer.from(type, "latin1");
}

function box(type, ...payload) {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(body.length + 8), typeBuf(type), body]);
}

function dataAtom(flag, value) {
  return box("data", u32(flag), u32(0), value);
}

function textItem(type, values) {
  return box(type, ...values.map((v) => dataAtom(1, Buffer.from(v, "utf8"))));
}

function freeformItem(name, values) {
  return box(
    "----",
    box("mean", u32(0), Buffer.from(FREEFORM_MEAN, "utf8")),
    box("name", u32(0), Buffer.from(name, "utf8")),
    ...values.map((v) => dataAtom(1, Buffer.from(v, "utf8"))),
  );
}

function parseChildren(buf, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos, size, header });
    pos += size;
  }
  return out;
}

function freeformKey(buf, atom) {
  const kids = parseChildren(buf, atom.start + atom.header, atom.start + atom.size);
  const mean = kids.find((k) => k.type === "mean");
  const name = kids.find((k) => k.type === "name");
  if (!mean || !name) return "----";
  const text = (k) =>
    buf.toString("utf8", k.start + k.header + 4, k.start + k.size);
  return `----:${text(mean).toLowerCase()}:${text(name).toLowerCase()}`;
}

function itemKey(buf, atom) {
  return atom.type === "----" ? freeformKey(buf, atom) : atom.type;
}

function ffKey(name) {
  return `----:${FREEFORM_MEAN.toLowerCase()}:${name.toLowerCase()}`;
}

function scanTopLevel(fd, fileSize) {
  const atoms = [];
  let pos = 0;
  const hb = Buffer.alloc(16);
  while (pos + 8 <= fileSize) {
    hb.fill(0);
    fs.readSync(fd, hb, 0, 16, pos);
    let size = hb.readUInt32BE(0);
    const type = hb.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      size = Number(hb.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }
    if (size < header || pos + size > fileSize) {
      throw new Error("This M4A file has a damaged atom structure.");
    }
    atoms.push({ type, start: pos, size, header });
    pos += size;
  }
  return atoms;
}

// Builds the list of ilst operations: [{ key, atom|null }]
function buildOps(plan) {
  const ops = [];
  const s = plan.set;
  const has = (k) => Object.prototype.hasOwnProperty.call(s, k);
  const list = (v) => (v == null ? null : [].concat(v));

  for (const [field, type] of Object.entries(TEXT_ATOMS)) {
    if (!has(field)) continue;
    const values = list(s[field]);
    ops.push({ key: type, atom: values && values.length ? textItem(type, values) : null });
  }
  if (has("genre")) ops.push({ key: "gnre", atom: null });
  for (const [field, name] of Object.entries(FREEFORM_ATOMS)) {
    if (!has(field)) continue;
    const values = list(s[field]);
    ops.push({
      key: ffKey(name),
      atom: values && values.length ? freeformItem(name, values) : null,
    });
  }
  if (has("label")) ops.push({ key: ffKey("PUBLISHER"), atom: null });
  if (has("bpm"))
    ops.push({
      key: "tmpo",
      atom: s.bpm == null ? null : box("tmpo", dataAtom(21, u16(Math.min(s.bpm, 0xffff)))),
    });
  if (has("compilation"))
    ops.push({
      key: "cpil",
      atom: s.compilation ? box("cpil", dataAtom(21, Buffer.from([1]))) : null,
    });
  if (plan.track) {
    const { no, of } = plan.track;
    ops.push({
      key: "trkn",
      atom:
        no == null
          ? null
          : box("trkn", dataAtom(0, Buffer.concat([Buffer.alloc(2), u16(no), u16(of || 0), Buffer.alloc(2)]))),
    });
  }
  if (plan.disc) {
    const { no, of } = plan.disc;
    ops.push({
      key: "disk",
      atom:
        no == null
          ? null
          : box("disk", dataAtom(0, Buffer.concat([Buffer.alloc(2), u16(no), u16(of || 0)]))),
    });
  }
  if (plan.release) {
    const value = plan.release.date || (plan.release.year != null ? String(plan.release.year) : null);
    ops.push({ key: "\u00a9day", atom: value ? textItem("\u00a9day", [value]) : null });
  }
  if (plan.image) {
    if (plan.image.op === "remove") ops.push({ key: "covr", atom: null });
    else {
      const flag = plan.image.mime === "image/png" ? 14 : 13;
      ops.push({ key: "covr", atom: box("covr", dataAtom(flag, plan.image.data)) });
    }
  }
  return ops;
}

function buildNewMoov(moovBuf, plan) {
  const moovHeader = moovBuf.readUInt32BE(0) === 1 ? 16 : 8;
  const kids = parseChildren(moovBuf, moovHeader, moovBuf.length);
  const slice = (a) => moovBuf.subarray(a.start, a.start + a.size);

  const udta = kids.find((k) => k.type === "udta");
  let metaAtom = null;
  let udtaKids = [];
  if (udta) {
    udtaKids = parseChildren(moovBuf, udta.start + udta.header, udta.start + udta.size);
    metaAtom = udtaKids.find((k) => k.type === "meta") || null;
  }

  // meta is a "full box" (4 bytes of version/flags) in iTunes-style files.
  let metaExtra = Buffer.alloc(4);
  let metaKids = [];
  let metaFirstChild = 0;
  if (metaAtom) {
    const p = metaAtom.start + metaAtom.header;
    // Non-full variant: the first child's type sits right after its size.
    const looksFull = moovBuf.toString("latin1", p + 4, p + 8) !== "hdlr";
    metaFirstChild = looksFull ? p + 4 : p;
    metaExtra = looksFull ? moovBuf.subarray(p, p + 4) : Buffer.alloc(0);
    metaKids = parseChildren(moovBuf, metaFirstChild, metaAtom.start + metaAtom.size);
  }
  const ilstAtom = metaKids.find((k) => k.type === "ilst") || null;
  const hdlrAtom = metaKids.find((k) => k.type === "hdlr") || null;

  const existing = ilstAtom
    ? parseChildren(moovBuf, ilstAtom.start + ilstAtom.header, ilstAtom.start + ilstAtom.size).map(
        (a) => ({ key: itemKey(moovBuf, a), raw: slice(a) }),
      )
    : [];

  const ops = buildOps(plan);
  const touched = new Set(ops.map((o) => o.key));
  const items = existing.filter((e) => !touched.has(e.key)).map((e) => e.raw);
  for (const op of ops) if (op.atom) items.push(op.atom);
  const newIlst = box("ilst", ...items);

  const hdlr = hdlrAtom
    ? slice(hdlrAtom)
    : box("hdlr", u32(0), u32(0), Buffer.from("mdir", "latin1"), Buffer.from("appl", "latin1"), u32(0), u32(0), Buffer.alloc(1));
  const metaChildren = metaKids
    .filter((k) => k.type !== "ilst" && k.type !== "free" && k.type !== "hdlr")
    .map(slice);
  const newMeta = box("meta", metaExtra, hdlr, newIlst, ...metaChildren);

  const newUdtaChildren = udtaKids.filter((k) => k.type !== "meta" && k.type !== "free").map(slice);
  newUdtaChildren.push(newMeta);
  const newUdta = box("udta", ...newUdtaChildren);

  const moovChildren = kids.filter((k) => k.type !== "udta").map(slice);
  moovChildren.push(newUdta);
  return box("moov", ...moovChildren);
}

function shiftChunkOffsets(buf, start, end, delta, boundary) {
  for (const atom of parseChildren(buf, start, end)) {
    const inner = atom.start + atom.header;
    if (CONTAINERS.has(atom.type)) {
      shiftChunkOffsets(buf, inner, atom.start + atom.size, delta, boundary);
    } else if (atom.type === "stco" || atom.type === "co64") {
      const count = buf.readUInt32BE(inner + 4);
      const wide = atom.type === "co64";
      for (let i = 0; i < count; i++) {
        const at = inner + 8 + i * (wide ? 8 : 4);
        if (wide) {
          const value = buf.readBigUInt64BE(at);
          if (value >= BigInt(boundary)) buf.writeBigUInt64BE(value + BigInt(delta), at);
        } else {
          const value = buf.readUInt32BE(at);
          if (value >= boundary) {
            if (value + delta > 0xffffffff) {
              throw new Error("This M4A is too large to update its tags safely.");
            }
            buf.writeUInt32BE(value + delta, at);
          }
        }
      }
    }
  }
}

async function copyRange(inputPath, outputPath, start, endExclusive) {
  if (endExclusive <= start) return;
  await pipeline(
    fs.createReadStream(inputPath, { start, end: endExclusive - 1 }),
    fs.createWriteStream(outputPath, { flags: "a" }),
  );
}

async function rewriteM4a(inputPath, outputPath, plan) {
  const fd = fs.openSync(inputPath, "r");
  let atoms;
  let fileSize;
  let moovBuf;
  let moov;
  try {
    fileSize = fs.fstatSync(fd).size;
    atoms = scanTopLevel(fd, fileSize);
    if (atoms.some((a) => a.type === "moof")) {
      throw new Error("Fragmented MP4 files can't have their tags edited safely.");
    }
    moov = atoms.find((a) => a.type === "moov");
    if (!moov) throw new Error("This M4A file has no `moov` atom, so it can't be tagged.");
    moovBuf = Buffer.alloc(moov.size);
    fs.readSync(fd, moovBuf, 0, moov.size, moov.start);
  } finally {
    fs.closeSync(fd);
  }

  const newMoov = buildNewMoov(moovBuf, plan);
  const delta = newMoov.length - moov.size;
  if (delta !== 0) {
    shiftChunkOffsets(newMoov, 8, newMoov.length, delta, moov.start + moov.size);
  }

  await fs.promises.writeFile(outputPath, Buffer.alloc(0));
  await copyRange(inputPath, outputPath, 0, moov.start);
  await fs.promises.appendFile(outputPath, newMoov);
  await copyRange(inputPath, outputPath, moov.start + moov.size, fileSize);
}

module.exports = { rewriteM4a, M4A_SUPPORTED };
