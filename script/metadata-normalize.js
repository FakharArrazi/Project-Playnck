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
  METADATA_FIELD_KEYS,
  primaryArtistName,
  artistCredit,
  normalizeForCompare,
};
