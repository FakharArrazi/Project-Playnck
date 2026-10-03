// Shared description of the metadata fields Playnck can read and write, plus
// helpers every format writer (MP3, FLAC, M4A, FFmpeg) uses so they all agree
// on what "set", "clear" and "leave alone" mean.
//
// Write contract (renderer -> main):
//   * a key that is ABSENT from the payload is left untouched in the file
//   * a key that is PRESENT with null / "" / [] / false is CLEARED
//   * track/disc/date pairs are sent together (see fillPairs for the safety net)

const TEXT_FIELDS = [
  "title",
  "artist",
  "album",
  "albumArtist",
  "label",
  "copyright",
  "isrc",
  "grouping",
  "subtitle",
  "conductor",
  "comment",
  "lyrics",
  "recordingId",
  "releaseId",
  "releaseGroupId",
];
const LIST_FIELDS = [
  "genre",
  "composer",
  "lyricist",
  "artists",
  "artistIds",
  "albumArtistIds",
];
const INT_FIELDS = [
  "trackNum",
  "trackTotal",
  "discNumber",
  "discTotal",
  "bpm",
  "year",
];
const DATE_FIELDS = ["date", "originalDate"];
const BOOL_FIELDS = ["compilation"];

const DATE_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

// Human-readable names, used in "couldn't write X to this format" feedback.
const FIELD_LABELS = {
  title: "title",
  artist: "artist",
  artists: "contributing artists",
  album: "album",
  albumArtist: "album artist",
  genre: "genre",
  composer: "composer",
  lyricist: "lyricist",
  conductor: "conductor",
  grouping: "grouping",
  subtitle: "subtitle",
  label: "record label / publisher",
  copyright: "copyright",
  isrc: "ISRC",
  comment: "comment",
  lyrics: "lyrics",
  bpm: "BPM",
  compilation: "compilation flag",
  year: "release year",
  date: "release date",
  originalDate: "original release date",
  trackNum: "track number",
  trackTotal: "total tracks",
  discNumber: "disc number",
  discTotal: "total discs",
  recordingId: "MusicBrainz recording ID",
  releaseId: "MusicBrainz release ID",
  releaseGroupId: "MusicBrainz release group ID",
  artistIds: "MusicBrainz artist IDs",
  albumArtistIds: "MusicBrainz album artist IDs",
};

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function cleanText(value) {
  if (value == null) return null;
  const s = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  return s || null;
}

function cleanList(value) {
  const arr = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const s = cleanText(item);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : null;
}

function cleanInt(value, key) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${FIELD_LABELS[key] || key} must be a whole number.`);
  }
  return n;
}

function cleanDate(value, key) {
  const s = cleanText(value);
  if (!s) return null;
  if (!DATE_RE.test(s)) {
    throw new Error(
      `${FIELD_LABELS[key] || key} must look like YYYY, YYYY-MM or YYYY-MM-DD.`,
    );
  }
  return s;
}

// Turns the raw IPC payload into a plan the writers can follow.
//   plan.set     flat map of key -> value | null (null = clear)
//   plan.track   { no, of }       only when a track pair was sent
//   plan.disc    { no, of }       only when a disc pair was sent
//   plan.release { date, year }   only when the release date/year was sent
//   plan.image   { op: "set"|"remove", data, mime }  or null
function buildPlan(tags) {
  tags = tags || {};
  const set = {};
  for (const key of TEXT_FIELDS) if (has(tags, key)) set[key] = cleanText(tags[key]);
  for (const key of LIST_FIELDS) if (has(tags, key)) set[key] = cleanList(tags[key]);
  for (const key of BOOL_FIELDS) if (has(tags, key)) set[key] = tags[key] ? true : null;
  if (has(tags, "bpm")) set.bpm = cleanInt(tags.bpm, "bpm");
  if (has(tags, "originalDate"))
    set.originalDate = cleanDate(tags.originalDate, "originalDate");

  const plan = { set, image: null };

  if (has(tags, "trackNum") || has(tags, "trackTotal")) {
    plan.track = {
      no: has(tags, "trackNum") ? cleanInt(tags.trackNum, "trackNum") : undefined,
      of: has(tags, "trackTotal")
        ? cleanInt(tags.trackTotal, "trackTotal")
        : undefined,
    };
  }
  if (has(tags, "discNumber") || has(tags, "discTotal")) {
    plan.disc = {
      no: has(tags, "discNumber")
        ? cleanInt(tags.discNumber, "discNumber")
        : undefined,
      of: has(tags, "discTotal") ? cleanInt(tags.discTotal, "discTotal") : undefined,
    };
  }
  if (has(tags, "date") || has(tags, "year")) {
    plan.release = {
      date: has(tags, "date") ? cleanDate(tags.date, "date") : undefined,
      year: has(tags, "year") ? cleanInt(tags.year, "year") : undefined,
    };
  }

  if (tags.removeImage) {
    plan.image = { op: "remove" };
  } else if (tags.imageData) {
    plan.image = {
      op: "set",
      data: Buffer.from(tags.imageData),
      mime: tags.imageMime || "image/jpeg",
    };
  }
  return plan;
}

// If only half of a pair was sent, borrow the other half from what is already
// in the file so we never accidentally wipe "of 12" when only "3" was edited.
function fillPairs(plan, existing) {
  existing = existing || {};
  if (plan.track) {
    if (plan.track.no === undefined) plan.track.no = existing.trackNum ?? null;
    if (plan.track.of === undefined) plan.track.of = existing.trackTotal ?? null;
  }
  if (plan.disc) {
    if (plan.disc.no === undefined) plan.disc.no = existing.discNumber ?? null;
    if (plan.disc.of === undefined) plan.disc.of = existing.discTotal ?? null;
  }
  if (plan.release) {
    // Release date wins; the year is just its first four digits. When only a
    // year was sent, the date collapses to that year so the two never disagree.
    let { date, year } = plan.release;
    if (date === undefined && year === undefined) return plan;
    if (date === undefined) date = year != null ? String(year) : null;
    if (year === undefined || year == null) year = date ? Number(date.slice(0, 4)) : null;
    if (date && year != null && Number(date.slice(0, 4)) !== year) {
      date = String(year);
    }
    if (!date && year != null) date = String(year);
    plan.release = { date, year };
  }
  return plan;
}

function pairText(no, of) {
  if (no == null) return null;
  return of != null ? `${no}/${of}` : `${no}`;
}

function firstText(values) {
  if (!Array.isArray(values) || !values.length) return null;
  for (const item of values) {
    const text = typeof item === "string" ? item : item && item.text;
    if (text && String(text).trim()) return String(text);
  }
  return null;
}

function listOf(values) {
  return Array.isArray(values) ? values.filter(Boolean).map(String) : [];
}

// Many taggers (Windows, foobar2000, FFmpeg) pack several values into one
// string separated by ";". Split them so genres/composers/artists read as lists.
function splitMulti(values) {
  const seen = new Set();
  const out = [];
  for (const value of listOf(values)) {
    for (const part of value.split(";")) {
      const v = part.trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

// First native tag with this id, for fields music-metadata has no common name
// for (e.g. Vorbis DESCRIPTION, which FFmpeg uses for "comment").
function nativeValue(meta, id) {
  const natives = (meta && meta.native) || {};
  for (const list of Object.values(natives)) {
    for (const tag of list || []) {
      if (tag && tag.id === id && typeof tag.value === "string" && tag.value.trim())
        return tag.value;
    }
  }
  return null;
}

// Reads every field Playnck cares about out of a music-metadata result.
function canonicalFromParsed(meta) {
  const common = (meta && meta.common) || {};
  const track = common.track || {};
  const disk = common.disk || {};
  return {
    title: common.title || null,
    artist: common.artist || null,
    artists: splitMulti(common.artists),
    album: common.album || null,
    albumArtist: common.albumartist || null,
    albumArtists: listOf(common.albumartists),
    trackNum: track.no != null ? track.no : null,
    trackTotal: track.of != null ? track.of : null,
    discNumber: disk.no != null ? disk.no : null,
    discTotal: disk.of != null ? disk.of : null,
    year: common.year != null ? common.year : null,
    date: common.date || null,
    originalDate:
      common.originaldate ||
      (common.originalyear != null ? String(common.originalyear) : null),
    genre: splitMulti(common.genre),
    composer: splitMulti(common.composer),
    lyricist: splitMulti(common.lyricist),
    conductor: listOf(common.conductor)[0] || null,
    grouping: common.grouping || null,
    subtitle: listOf(common.subtitle)[0] || null,
    label: listOf(common.label)[0] || null,
    copyright: common.copyright || null,
    isrc: listOf(common.isrc)[0] || null,
    bpm: common.bpm != null ? Math.round(common.bpm) : null,
    compilation: !!common.compilation,
    comment:
      firstText(common.comment) ||
      firstText(common.description) ||
      nativeValue(meta, "DESCRIPTION"),
    lyrics: firstText(common.lyrics),
    releaseType: listOf(common.releasetype)[0] || null,
    recordingId: common.musicbrainz_recordingid || null,
    releaseId: common.musicbrainz_albumid || null,
    releaseGroupId: common.musicbrainz_releasegroupid || null,
    artistIds: splitMulti(common.musicbrainz_artistid),
    albumArtistIds: splitMulti(common.musicbrainz_albumartistid),
  };
}

// ID3v2.3 has no real multi-value separator, so readers split on "/" or ";".
// Lists are therefore compared as flattened tokens, so "R&B/Soul" written as
// one value still verifies even though it reads back as two.
function sameValue(a, b) {
  const norm = (v) =>
    Array.isArray(v)
      ? v
          .flatMap((x) => String(x).split(/[;/]/))
          .map((x) => x.trim())
          .filter(Boolean)
          .join("\u0001")
      : v == null || v === false
        ? ""
        : String(v).replace(/\r\n?/g, "\n").trim();
  return norm(a) === norm(b);
}

// Compares what we meant to write against what music-metadata reads back.
// `skip` lists keys the reader can't be trusted to surface for this format.
function verifyPlan(plan, actual, skip) {
  skip = skip || new Set();
  const mismatches = [];
  const check = (key, expected, label) => {
    if (skip.has(key)) return;
    if (!sameValue(expected, actual[key])) mismatches.push(label || FIELD_LABELS[key] || key);
  };
  for (const [key, value] of Object.entries(plan.set)) {
    if (key === "artists") {
      // Artists can legitimately come back derived from the artist string.
      if (value && value.length > 1) check(key, value);
      continue;
    }
    if (key === "lyrics" || key === "comment") {
      check(key, value);
      continue;
    }
    check(key, value);
  }
  if (plan.track) {
    check("trackNum", plan.track.no);
    check("trackTotal", plan.track.of);
  }
  if (plan.disc) {
    check("discNumber", plan.disc.no);
    check("discTotal", plan.disc.of);
  }
  if (plan.release) {
    check("date", plan.release.date);
    check("year", plan.release.year);
  }
  return mismatches;
}

// Which plan keys a format can't store, as human-readable names.
function unsupportedLabels(plan, supported) {
  const out = [];
  const add = (key) => {
    if (!supported.has(key)) out.push(FIELD_LABELS[key] || key);
  };
  for (const [key, value] of Object.entries(plan.set)) {
    // Clearing something the format can't hold is a no-op, not a failure.
    if (value != null) add(key);
  }
  if (plan.track) {
    if (plan.track.no != null) add("trackNum");
    if (plan.track.of != null) add("trackTotal");
  }
  if (plan.disc) {
    if (plan.disc.no != null) add("discNumber");
    if (plan.disc.of != null) add("discTotal");
  }
  if (plan.release) {
    if (plan.release.date != null) add("date");
    if (plan.release.year != null && plan.release.date == null) add("year");
  }
  return out;
}

// Copy of a plan limited to the keys a format can store.
function restrictPlan(plan, supported) {
  const out = { set: {}, image: plan.image };
  for (const [key, value] of Object.entries(plan.set))
    if (supported.has(key)) out.set[key] = value;
  if (plan.track) {
    out.track = {
      no: supported.has("trackNum") ? plan.track.no : null,
      of: supported.has("trackTotal") ? plan.track.of : null,
    };
    if (!supported.has("trackNum") && !supported.has("trackTotal")) delete out.track;
  }
  if (plan.disc && (supported.has("discNumber") || supported.has("discTotal")))
    out.disc = plan.disc;
  if (plan.release && (supported.has("date") || supported.has("year")))
    out.release = plan.release;
  return out;
}

module.exports = {
  TEXT_FIELDS,
  LIST_FIELDS,
  INT_FIELDS,
  DATE_FIELDS,
  BOOL_FIELDS,
  FIELD_LABELS,
  buildPlan,
  fillPairs,
  pairText,
  canonicalFromParsed,
  verifyPlan,
  unsupportedLabels,
  restrictPlan,
  sameValue,
};
