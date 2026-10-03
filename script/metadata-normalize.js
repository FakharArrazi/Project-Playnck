const ARTIST_SEPARATOR_RE =
  /\s*(?:;|\/|,|&|\+|×|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bvs\.?\b|\band\b)\s*/gi;

function splitArtistCredit(raw) {
  if (!raw) return [];
  return raw
    .split(ARTIST_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeForCompare(raw) {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARTIST_SEPARATOR_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function albumGroupKey(track) {
  if (track.releaseId) return "rid:" + track.releaseId;
  if (track.releaseGroupId) return "rgid:" + track.releaseGroupId;
  const album = normalizeForCompare(track.album);
  if (track.albumArtist)
    return "aa:" + album + "|" + normalizeForCompare(track.albumArtist);
  return "a:" + album + "|" + normalizeForCompare(track.artist);
}

function joinIfIncomplete(single, list) {
  if (list.length < 2) return single;
  const singleNorm = normalizeForCompare(single);
  const missing = list.some(
    (name) => !singleNorm.includes(normalizeForCompare(name)),
  );
  return missing ? list.join(", ") : single;
}

function normalizeReaderResult(raw) {
  raw = raw || {};
  const artist = raw.artist != null ? raw.artist : null;
  const artists =
    Array.isArray(raw.artists) && raw.artists.length > 1
      ? uniqueStrings(raw.artists)
      : uniqueStrings(splitArtistCredit(artist));
  const albumArtist = raw.albumArtist != null ? raw.albumArtist : null;
  const albumArtists =
    Array.isArray(raw.albumArtists) && raw.albumArtists.length > 1
      ? uniqueStrings(raw.albumArtists)
      : uniqueStrings(splitArtistCredit(albumArtist));

  return {
    title: raw.title != null ? raw.title : null,
    artist: joinIfIncomplete(artist, artists),
    artists,
    album: raw.album != null ? raw.album : null,
    albumArtist: joinIfIncomplete(albumArtist, albumArtists),
    albumArtists,
    trackNum: raw.trackNum != null ? raw.trackNum : null,
    trackTotal: raw.trackTotal != null ? raw.trackTotal : null,
    discNumber: raw.discNumber != null ? raw.discNumber : null,
    discTotal: raw.discTotal != null ? raw.discTotal : null,
    year: raw.year != null ? raw.year : null,
    date: raw.date != null ? raw.date : null,
    genre: Array.isArray(raw.genre) ? uniqueStrings(raw.genre) : [],
    composer: Array.isArray(raw.composer) ? uniqueStrings(raw.composer) : [],
    lyricist: Array.isArray(raw.lyricist) ? uniqueStrings(raw.lyricist) : [],
    originalDate: raw.originalDate != null ? raw.originalDate : null,
    label: raw.label != null ? raw.label : null,
    copyright: raw.copyright != null ? raw.copyright : null,
    isrc: raw.isrc != null ? raw.isrc : null,
    bpm: raw.bpm != null ? raw.bpm : null,
    compilation: raw.compilation ? true : null,
    grouping: raw.grouping != null ? raw.grouping : null,
    subtitle: raw.subtitle != null ? raw.subtitle : null,
    conductor: raw.conductor != null ? raw.conductor : null,
    comment: raw.comment != null ? raw.comment : null,
    lyrics: raw.lyrics != null ? raw.lyrics : null,
    releaseType: raw.releaseType != null ? raw.releaseType : null,
    recordingId: raw.recordingId != null ? raw.recordingId : null,
    releaseId: raw.releaseId != null ? raw.releaseId : null,
    releaseGroupId: raw.releaseGroupId != null ? raw.releaseGroupId : null,
    artistIds: Array.isArray(raw.artistIds) ? uniqueStrings(raw.artistIds) : [],
    albumArtistIds: Array.isArray(raw.albumArtistIds)
      ? uniqueStrings(raw.albumArtistIds)
      : [],
    picture: raw.picture || null,
  };
}

function primaryArtistName(track) {
  if (Array.isArray(track.artists) && track.artists.length)
    return track.artists[0];
  return track.artist || "";
}

function featuredArtistNames(track) {
  return Array.isArray(track.artists) ? track.artists.slice(1) : [];
}

function artistCredit(track) {
  const main = primaryArtistName(track);
  const featured = featuredArtistNames(track);
  if (!featured.length) return main || track.artist || "";
  return `${main} ft. ${featured.join(", ")}`;
}

// Bump whenever METADATA_FIELD_KEYS grows: tracks saved under an older schema
// are re-read from their files once so the new fields get filled in.
const METADATA_SCHEMA = 2;

const METADATA_FIELD_KEYS = [
  "title",
  "artist",
  "artists",
  "album",
  "albumArtist",
  "albumArtists",
  "trackNum",
  "trackTotal",
  "discNumber",
  "discTotal",
  "year",
  "date",
  "genre",
  "composer",
  "lyricist",
  "originalDate",
  "label",
  "copyright",
  "isrc",
  "bpm",
  "compilation",
  "grouping",
  "subtitle",
  "conductor",
  "comment",
  "lyrics",
  "releaseType",
  "recordingId",
  "releaseId",
  "releaseGroupId",
  "artistIds",
  "albumArtistIds",
];

export {
  albumGroupKey,
  normalizeReaderResult,
  splitArtistCredit,
  METADATA_FIELD_KEYS,
  METADATA_SCHEMA,
  primaryArtistName,
  artistCredit,
  normalizeForCompare,
};
