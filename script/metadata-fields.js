// Pure (DOM-free) logic behind the Edit Track modal: which fields exist, how
// their text is parsed, what counts as valid, and -- from the same inputs --
// what gets written to the file and what gets stored in the library.

import { splitArtistCredit } from "./metadata-normalize.js";

// kind: text | area | list | int | date | bool
const FIELDS = {
  title: { kind: "text" },
  artist: { kind: "text" },
  album: { kind: "text" },
  genre: { kind: "list" },
  year: { kind: "int" },
  albumArtist: { kind: "text" },
  trackNum: { kind: "int" },
  trackTotal: { kind: "int" },
  discNumber: { kind: "int" },
  discTotal: { kind: "int" },
  date: { kind: "date" },
  originalDate: { kind: "date" },
  compilation: { kind: "bool" },
  artists: { kind: "list" },
  composer: { kind: "list" },
  lyricist: { kind: "list" },
  conductor: { kind: "text" },
  label: { kind: "text" },
  copyright: { kind: "text" },
  isrc: { kind: "text" },
  bpm: { kind: "int" },
  grouping: { kind: "text" },
  subtitle: { kind: "text" },
  comment: { kind: "area" },
  lyrics: { kind: "area" },
};

// MusicBrainz identifiers ride along with an applied match; they aren't
// editable but they're written to the file and drive album/artist grouping.
const MATCH_ID_KEYS = [
  "recordingId",
  "releaseId",
  "releaseGroupId",
  "artistIds",
  "albumArtistIds",
];

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const DATE_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function parseList(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw == null ? "" : raw).split(";")) {
    const v = part.trim().replace(/\s+/g, " ");
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// Turns what the user typed into a typed value. Garbage numbers become NaN so
// validation can point at them instead of silently dropping them.
function parseInput(key, raw) {
  const { kind } = FIELDS[key];
  if (kind === "bool") return !!raw;
  if (kind === "list") return parseList(raw);
  const s = String(raw == null ? "" : raw)
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!s) return null;
  if (kind === "int") return /^\d+$/.test(s) ? Number(s) : NaN;
  if (key === "isrc") return s.replace(/[\s-]/g, "").toUpperCase();
  return s;
}

function formatValue(key, value) {
  const { kind } = FIELDS[key];
  if (kind === "bool") return !!value;
  if (kind === "list") return (Array.isArray(value) ? value : []).join("; ");
  if (value == null || Number.isNaN(value)) return "";
  return String(value);
}

function isEmptyValue(value) {
  return (
    value == null ||
    value === "" ||
    value === false ||
    (typeof value === "number" && Number.isNaN(value)) ||
    (Array.isArray(value) && !value.length)
  );
}

// Reads the library's record of a track in the shape the form edits.
function valuesFromTrack(t) {
  const values = {};
  for (const [key, { kind }] of Object.entries(FIELDS)) {
    const raw = t[key];
    if (kind === "bool") values[key] = !!raw;
    else if (kind === "list")
      values[key] = Array.isArray(raw) ? [...raw] : raw ? parseList(raw) : [];
    else if (kind === "int")
      values[key] = raw == null || raw === "" ? null : Number(raw);
    else values[key] = raw == null || raw === "" ? null : String(raw);
  }
  if (!values.artists.length) values.artists = splitArtistCredit(t.artist);
  if (values.year == null && values.date) values.year = Number(values.date.slice(0, 4));
  return values;
}

function sameValue(key, a, b) {
  const { kind } = FIELDS[key];
  if (kind === "bool") return !!a === !!b;
  if (kind === "list") {
    const x = a || [];
    const y = b || [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (kind === "int") {
    const x = a == null ? null : a;
    const y = b == null ? null : b;
    return (Number.isNaN(x) && Number.isNaN(y)) || x === y;
  }
  return (a == null ? "" : a) === (b == null ? "" : b);
}

function validDate(value) {
  const m = DATE_RE.exec(value || "");
  if (!m) return false;
  const [, y, mo, d] = m;
  if (mo != null && (Number(mo) < 1 || Number(mo) > 12)) return false;
  if (d != null) {
    const daysInMonth = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
    if (Number(d) < 1 || Number(d) > daysInMonth) return false;
  }
  return true;
}

// Keeps Release Year and Release Date from ever disagreeing: the date is the
// source of truth, the year is its first four digits, and a lone year becomes
// the (year-only) date.
function normalizeRelease(date, year) {
  let d = date || null;
  let y = Number.isInteger(year) ? year : null;
  if (d && y == null) y = Number(d.slice(0, 4));
  if (d && y != null && Number(d.slice(0, 4)) !== y) d = String(y);
  if (!d && y != null) d = String(y);
  return { date: d, year: y };
}

const isPositiveInt = (n) => Number.isInteger(n) && n >= 1;

// Returns { fieldKey: i18nKey } for every problem. Only fields the user
// actually changed are checked, so pre-existing quirks in a file (a track 12
// of 10, say) never block an unrelated edit.
function validate(current, changed) {
  const errors = {};
  const touched = (...keys) => keys.some((k) => changed.has(k));

  if (touched("year", "date")) {
    const y = current.year;
    if (y != null && !(Number.isInteger(y) && y >= 1000 && y <= 9999))
      errors.year = "edit.errYear";
    if (current.date != null && !validDate(current.date)) errors.date = "edit.errDate";
    else if (
      !errors.year &&
      current.date != null &&
      y != null &&
      Number(current.date.slice(0, 4)) !== y
    )
      errors.date = "edit.errDateYear";
  }
  if (
    changed.has("originalDate") &&
    current.originalDate != null &&
    !validDate(current.originalDate)
  )
    errors.originalDate = "edit.errDate";

  const pair = (noKey, totalKey, rangeError) => {
    if (!touched(noKey, totalKey)) return;
    for (const key of [noKey, totalKey])
      if (current[key] != null && !isPositiveInt(current[key]))
        errors[key] = "edit.errPositive";
    if (
      !errors[noKey] &&
      !errors[totalKey] &&
      current[noKey] != null &&
      current[totalKey] != null &&
      current[noKey] > current[totalKey]
    )
      errors[noKey] = rangeError;
  };
  pair("trackNum", "trackTotal", "edit.errTrackRange");
  pair("discNumber", "discTotal", "edit.errDiscRange");

  if (changed.has("bpm") && current.bpm != null) {
    if (!(Number.isInteger(current.bpm) && current.bpm >= 1 && current.bpm <= 999))
      errors.bpm = "edit.errBpm";
  }
  if (changed.has("isrc") && current.isrc && !ISRC_RE.test(current.isrc))
    errors.isrc = "edit.errIsrc";
  return errors;
}

// One pass over (what was there, what the form says now) that yields
//   changed  - keys the user changed
//   errors   - validation problems (empty object = OK to save)
//   payload  - what to hand to the file writer (only changed things)
//   library  - what to store on the track in Playnck's own library
//
// Keys absent from `payload` are left untouched in the file; keys present with
// an empty value are cleared.
function resolveEdit(original, current, opts = {}) {
  const { artistsTouched = false, matchFields = null } = opts;

  const changed = new Set();
  for (const key of Object.keys(FIELDS))
    if (!sameValue(key, original[key], current[key])) changed.add(key);

  const errors = validate(current, changed);
  const payload = {};
  const library = {};
  const put = (key, value) => {
    payload[key] = value;
    library[key] = value;
  };

  // Title / artist / album can't be blanked: an empty box means "keep it".
  for (const key of ["title", "artist", "album"]) {
    if (!changed.has(key)) continue;
    if (!current[key]) changed.delete(key);
    else put(key, current[key]);
  }

  for (const key of [
    "genre",
    "albumArtist",
    "composer",
    "lyricist",
    "conductor",
    "label",
    "copyright",
    "isrc",
    "bpm",
    "grouping",
    "subtitle",
    "comment",
    "lyrics",
    "compilation",
    "originalDate",
  ]) {
    if (changed.has(key)) put(key, current[key]);
  }

  // Pairs are always sent together so a half-edit can't wipe the other half.
  if (changed.has("trackNum") || changed.has("trackTotal")) {
    put("trackNum", current.trackNum);
    put("trackTotal", current.trackTotal);
  }
  if (changed.has("discNumber") || changed.has("discTotal")) {
    put("discNumber", current.discNumber);
    put("discTotal", current.discTotal);
  }
  if (changed.has("year") || changed.has("date")) {
    const rel = normalizeRelease(current.date, current.year);
    put("date", rel.date);
    put("year", rel.year);
  }

  // Contributing artists. Auto-derived lists are only written when they would
  // otherwise leave a stale multi-artist tag behind; a hand-edited one is
  // written as typed.
  const artistsEdited = artistsTouched && changed.has("artists");
  if (artistsEdited) {
    put("artists", current.artists.length > 1 ? current.artists : []);
  } else if (changed.has("artist") && original.artists.length > 1) {
    payload.artists = [];
    library.artists = splitArtistCredit(current.artist);
  } else if (changed.has("artist")) {
    library.artists = splitArtistCredit(current.artist);
  }

  if (matchFields) {
    for (const key of MATCH_ID_KEYS) {
      if (!isEmptyValue(matchFields[key])) {
        payload[key] = matchFields[key];
        library[key] = matchFields[key];
      }
    }
    if (matchFields.releaseType) library.releaseType = matchFields.releaseType;
  } else if (changed.has("album") || changed.has("albumArtist")) {
    // Renaming an album by hand must also drop the old MusicBrainz release
    // IDs, or the track would stay grouped with its old album.
    put("releaseId", null);
    put("releaseGroupId", null);
  }

  return { changed, errors, payload, library };
}

export {
  FIELDS,
  MATCH_ID_KEYS,
  parseInput,
  parseList,
  formatValue,
  isEmptyValue,
  valuesFromTrack,
  sameValue,
  validDate,
  normalizeRelease,
  validate,
  resolveEdit,
};
