// node-id3 rewrites a tag from the frames it understands and silently drops the
// rest (iTunes sort-order frames like TSO2/TSOC, TIPL/TMCL credits, RVA2, ...).
// To honour "leave everything you didn't edit alone", the frames it can't
// round-trip are lifted out of the original tag and appended to the new one.
//
// The rewritten tag is always ID3v2.3, so frames from a v2.4 tag are converted:
// frame sizes become plain big-endian, v2.4-only text encodings (UTF-8,
// UTF-16BE) become UTF-16 with a BOM, and frames using compression, encryption
// or unsynchronisation are skipped rather than risk corrupting them.

const FRAME_ID_RE = /^[A-Z0-9]{4}$/;
const PAIRED_FRAMES = new Set(["TIPL", "TMCL", "IPLS"]);

const syncsafe = (b, o) =>
  ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

function writeSyncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function readHeader(buf) {
  if (!buf || buf.length < 10 || buf.toString("latin1", 0, 3) !== "ID3") return null;
  const version = buf[3];
  if (version !== 3 && version !== 4) return null;
  return { version, flags: buf[5], size: syncsafe(buf, 6) };
}

function deunsync(buf) {
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    out.push(buf[i]);
    if (buf[i] === 0xff && buf[i + 1] === 0x00) i++;
  }
  return Buffer.from(out);
}

// Every frame in a v2.3/v2.4 tag body as { id, flags, data } (header stripped).
function readFrames(buf) {
  const header = readHeader(buf);
  if (!header || buf.length < 10 + header.size) return [];
  let body = buf.subarray(10, 10 + header.size);
  if (header.version === 3 && header.flags & 0x80) body = deunsync(body);

  let pos = 0;
  if (header.flags & 0x40 && body.length >= 4) {
    // v2.3: size excludes its own 4 bytes; v2.4: syncsafe and includes them
    pos = header.version === 3 ? 4 + body.readUInt32BE(0) : syncsafe(body, 0);
  }
  const frames = [];
  while (pos + 10 <= body.length) {
    const id = body.toString("latin1", pos, pos + 4);
    if (!FRAME_ID_RE.test(id)) break;
    const size = header.version === 4 ? syncsafe(body, pos + 4) : body.readUInt32BE(pos + 4);
    const flags = body.readUInt16BE(pos + 8);
    if (pos + 10 + size > body.length) break;
    frames.push({ id, flags, data: body.subarray(pos + 10, pos + 10 + size) });
    pos += 10 + size;
  }
  return frames;
}

function decodeText(enc, bytes) {
  if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
    return bytes.subarray(bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0).toString("utf16le");
  }
  if (enc === 2) return Buffer.from(bytes).swap16().toString("utf16le");
  if (enc === 3) return bytes.toString("utf8");
  return bytes.toString("latin1");
}

// Returns the frame's payload in a form valid for ID3v2.3, or null to skip it.
function toV23Frame(frame, sourceVersion) {
  let data = frame.data;
  if (sourceVersion === 4) {
    const f = frame.flags;
    if (f & 0x000c || f & 0x0002) return null; // compression, encryption, unsync
    let offset = 0;
    if (f & 0x0040) offset += 1; // grouping identity
    if (f & 0x0001) offset += 4; // data length indicator
    data = data.subarray(offset);
  } else if (frame.flags & 0x00c0) {
    return null; // v2.3 compression / encryption
  }

  const isText = frame.id[0] === "T" && frame.id !== "TXXX";
  if (isText && data.length) {
    const enc = data[0];
    if (enc === 2 || enc === 3 || (sourceVersion === 4 && enc === 1)) {
      // Credit lists are null-separated pairs and must stay that way; every
      // other multi-value text frame uses "/" in v2.3.
      const separator = PAIRED_FRAMES.has(frame.id) ? "\u0000" : "/";
      const text = decodeText(enc, data.subarray(1))
        .split("\u0000")
        .filter(Boolean)
        .join(separator);
      data = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    }
  }
  return data;
}

function frameBytes(id, data) {
  const header = Buffer.alloc(10);
  header.write(id, 0, "latin1");
  header.writeUInt32BE(data.length, 4);
  return Buffer.concat([header, data]);
}

// originalBuf   : the file before editing
// newBuf        : the file after node-id3 wrote the new (v2.3) tag
// knownIds      : frame IDs node-id3 understood in the original (from its raw read)
function graftUnknownFrames(originalBuf, newBuf, knownIds) {
  const origHeader = readHeader(originalBuf);
  const newHeader = readHeader(newBuf);
  if (!origHeader || !newHeader || newHeader.version !== 3) return newBuf;

  const extras = [];
  for (const frame of readFrames(originalBuf)) {
    if (knownIds.has(frame.id)) continue;
    const data = toV23Frame(frame, origHeader.version);
    if (data) extras.push(frameBytes(frame.id, data));
  }
  if (!extras.length) return newBuf;

  const tagEnd = 10 + newHeader.size;
  const body = newBuf.subarray(10, tagEnd);

  // Find where node-id3's frames stop so the new ones go before any padding.
  let framesEnd = 0;
  while (framesEnd + 10 <= body.length) {
    if (!FRAME_ID_RE.test(body.toString("latin1", framesEnd, framesEnd + 4))) break;
    const size = body.readUInt32BE(framesEnd + 4);
    if (framesEnd + 10 + size > body.length) break;
    framesEnd += 10 + size;
  }

  const newBody = Buffer.concat([body.subarray(0, framesEnd), ...extras]);
  const header = Buffer.concat([
    newBuf.subarray(0, 6),
    writeSyncsafe(newBody.length),
  ]);
  return Buffer.concat([header, newBody, newBuf.subarray(tagEnd)]);
}

module.exports = { graftUnknownFrames, readFrames, readHeader };
