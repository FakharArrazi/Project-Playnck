
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { app } = require("electron");

const ACOUSTID_CLIENT_KEY = "cJcqWYqnQr";

const USER_AGENT = "Playnck/1.1.5 ( https://github.com/FakharArrazi/Project-Playnck )";

const ACOUSTID_LOOKUP_URL = "https://api.acoustid.org/v2/lookup";
const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2";
const COVER_ART_ARCHIVE = "https://coverartarchive.org";

const MAX_MATCHES = 5;

const MUSICBRAINZ_SEARCH_POOL = 30;

const IMAGES_PER_MATCH = 3;
const MAX_RELEASES_TRIED_PER_MATCH = 5;

const MIN_ACOUSTID_SCORE = 0.5;

const ACOUSTID_CANDIDATE_POOL = 10;

const BUNDLED_RECORDING_RE = /^(video|bonus video|megamix|medley)\s*:/i;
function isBundledRecording(title) {
    if (!title) return false;
    if (BUNDLED_RECORDING_RE.test(title)) return true;
    return title.split(" / ").length >= 3;
}

const PLACEHOLDER_ARTIST = /^unknown artist$/i;

const JUNK_BRACKET_RE = /[(\[][^)\]]*\b(official|video|audio|lyrics?|visualizer|mv|hd|hq|4k|explicit)\b[^)\]]*[)\]]/gi;

function cleanForSearch(str) {
    if (!str) return str;
    return str
        .replace(JUNK_BRACKET_RE, " ")
        .replace(/^\s*\d{1,3}[\s._-]+/, "")
        .replace(/_+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

async function autoTagTrack(filePath, hint, mode) {
    if (!filePath) return { found: false, reason: "This track's file location isn't known." };

    mode = (mode === "fingerprint" || mode === "text") ? mode : "auto";

    hint = hint || {};
    const hintArtist = (hint.artist && !PLACEHOLDER_ARTIST.test(hint.artist.trim())) ? hint.artist : "";
    const hasTextHint = !!(hint.title || hintArtist);

    let matches = null;

    let fingerprintNote = null;

    if (mode !== "text") {
        if (ACOUSTID_CLIENT_KEY) {
            try {
                const fp = await runFpcalc(filePath);
                if (fp.ok) {
                    matches = await acoustidLookup(fp.fingerprint, fp.duration);
                    if (!matches || !matches.length) fingerprintNote = "audio fingerprinting ran, but AcoustID had no match for it";
                } else {
                    fingerprintNote = `audio fingerprinting didn't run (${fp.error})`;
                }
            } catch (err) {
                console.error("autoTagTrack: fingerprint lookup failed:", err);
                fingerprintNote = `audio fingerprinting failed (${err.message || err})`;
            }
        } else {
            fingerprintNote = "no AcoustID API key is configured";
        }
    }

    if (mode !== "fingerprint" && (!matches || !matches.length) && hasTextHint) {
        try {
            matches = await musicbrainzTextSearch(hint.title, hintArtist);
        } catch (err) {
            console.error("autoTagTrack: MusicBrainz text search failed:", err);
        }
    }

    if (!matches || !matches.length) {
        let reason;
        if (mode === "fingerprint") {
            reason = fingerprintNote
                ? `Couldn't identify this song from the audio (${fingerprintNote}).`
                : "Couldn't identify this song from the audio.";
        } else if (mode === "text") {
            reason = hasTextHint
                ? "No confident match found for that title/artist."
                : "Type a title or artist to search for first.";
        } else if (!ACOUSTID_CLIENT_KEY) {
            reason = "No confident match found. (Fingerprinting is off — no AcoustID API key is configured, so only a title/artist search was tried.)";
        } else if (fingerprintNote) {
            reason = `No confident match found. (${fingerprintNote}, so this fell back to a title/artist search, which also came up empty.)`;
        } else {
            reason = "No confident match found.";
        }
        return { found: false, reason };
    }

    matches = matches.slice(0, MAX_MATCHES);
    const source = matches[0].source;

    for (const m of matches) {
        m.images = await gatherCoverArtCandidates(m.releases, IMAGES_PER_MATCH, MAX_RELEASES_TRIED_PER_MATCH);
        delete m.releases;
        delete m.releaseScore;
        delete m.mbScore;
    }

    const top = matches[0];
    return {
        found: true,
        source,
        title: top.title,
        artist: top.artist,
        album: top.album,
        year: top.year,
        trackNum: top.trackNum,
        image: top.images[0] || null,
        images: top.images,
        matches
    };
}


function resolveFpcalcPath() {
    const bin = process.platform === "win32" ? "fpcalc.exe" : "fpcalc";

    const candidates = [];
    if (app.isPackaged) {
        candidates.push(path.join(process.resourcesPath, "fpcalc", process.platform, bin));
    } else {
        candidates.push(path.join(__dirname, "resources", "fpcalc", process.platform, bin));
    }

    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.F_OK);
            return candidate;
        } catch {
        }
    }
    return bin;
}

function runFpcalc(filePath) {
    return new Promise((resolve) => {
        const bin = resolveFpcalcPath();
        execFile(bin, ["-json", filePath], { timeout: 20000 }, (err, stdout) => {
            if (err) {
                const reason = (err.code === "ENOENT")
                    ? `the fpcalc tool isn't installed (looked for it at "${bin}")`
                    : `fpcalc failed to run (${err.message})`;
                console.error("autoTagTrack: fpcalc unavailable or failed:", err.message);
                return resolve({ ok: false, error: reason });
            }
            try {
                const parsed = JSON.parse(stdout);
                if (!parsed.fingerprint || !parsed.duration) {
                    return resolve({ ok: false, error: "fpcalc ran but didn't return a usable fingerprint for this file" });
                }
                resolve({ ok: true, fingerprint: parsed.fingerprint, duration: Math.round(parsed.duration) });
            } catch {
                resolve({ ok: false, error: "fpcalc's output couldn't be parsed" });
            }
        });
    });
}


async function acoustidLookup(fingerprint, duration) {
    const url = `${ACOUSTID_LOOKUP_URL}?client=${encodeURIComponent(ACOUSTID_CLIENT_KEY)}`
        + `&meta=recordings+compress`
        + `&duration=${duration}&fingerprint=${encodeURIComponent(fingerprint)}`;

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "ok" || !Array.isArray(data.results) || !data.results.length) return null;

    const sorted = data.results
        .filter(r => (r.score || 0) >= MIN_ACOUSTID_SCORE && r.recordings && r.recordings.length)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
    if (!sorted.length) return null;

    const seen = new Set();
    const candidates = [];
    idLoop:
    for (const result of sorted) {
        for (const recording of result.recordings) {
            if (!recording.id || seen.has(recording.id)) continue;
            seen.add(recording.id);
            if (isBundledRecording(recording.title)) continue;
            candidates.push({ id: recording.id, fallback: recording });
            if (candidates.length >= ACOUSTID_CANDIDATE_POOL) break idLoop;
        }
    }
    if (!candidates.length) return null;

    const matches = [];
    for (const c of candidates) {
        const mbRecording = await fetchMusicBrainzRecording(c.id).catch(() => null);
        matches.push(buildMatchFromRecording(mbRecording || c.fallback, "fingerprint"));
    }
    return matches.length ? matches : null;
}

async function fetchMusicBrainzRecording(mbid) {
    if (!mbid) return null;
    const url = `${MUSICBRAINZ_API}/recording/${mbid}?fmt=json&inc=releases+release-groups+artist-credits`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    if (!res.ok) return null;
    return await res.json();
}


async function musicbrainzTextSearch(title, artist) {
    title = cleanForSearch(title);
    artist = cleanForSearch(artist);
    if (!title && !artist) return null;

    const parts = [];
    if (title) parts.push(`recording:"${title.replace(/"/g, '\\"')}"`);
    if (artist) parts.push(`artist:"${artist.replace(/"/g, '\\"')}"`);
    const strict = await musicbrainzQuery(parts.join(" AND "));
    if (strict && strict.length) return strict;

    const loose = await musicbrainzQuery([title, artist].filter(Boolean).join(" "));
    return (loose && loose.length) ? loose : null;
}

async function musicbrainzQuery(query) {
    if (!query) return null;

    const url = `${MUSICBRAINZ_API}/recording/?query=${encodeURIComponent(query)}`
        + `&fmt=json&limit=${MUSICBRAINZ_SEARCH_POOL}&inc=releases+release-groups+artist-credits`;

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.recordings || !data.recordings.length) return null;

    const usable = data.recordings.filter(r => !isBundledRecording(r.title));
    const confident = usable.filter(r => (r.score || 0) >= 50);
    const pool = confident.length ? confident : usable.slice(0, 1);

    const built = pool.map(r => buildMatchFromRecording(r, "musicbrainz"));

    if (confident.length) {
        built.sort((a, b) => (b.releaseScore - a.releaseScore) || (b.mbScore - a.mbScore));
    }

    return built;
}

function buildMatchFromRecording(recording, source) {
    const title = recording.title || null;
    const artist = Array.isArray(recording.artists)
        ? recording.artists.map(a => a.name).join(", ")
        : (Array.isArray(recording["artist-credit"])
            ? recording["artist-credit"].map(a => a.name || (a.artist && a.artist.name)).filter(Boolean).join(", ")
            : null);

    const releases = Array.isArray(recording.releases) ? recording.releases : [];
    const sorted = [...releases].sort((a, b) => scoreRelease(b) - scoreRelease(a));

    const primary = sorted[0] || null;
    const album = primary
        ? (primary.title || (primary["release-group"] && primary["release-group"].title) || null)
        : null;
    const dateStr = primary ? primary.date : null;
    const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) || null : null;
    const trackNum = (primary && primary.media && primary.media[0] && primary.media[0].track
        && primary.media[0].track[0] && primary.media[0].track[0].number)
        ? parseInt(primary.media[0].track[0].number, 10) || null
        : null;

    return {
        source,
        title,
        artist: artist || null,
        album,
        year,
        trackNum,
        releaseScore: bestReleaseScore(releases),
        mbScore: recording.score || 0,
        releases: sorted
            .map(r => ({
                id: r.id || null,
                rgId: (r["release-group"] && r["release-group"].id) || null,
                title: r.title || (r["release-group"] && r["release-group"].title) || null,
                date: r.date || null
            }))
            .filter(r => r.id)
    };
}

function bestReleaseScore(releases) {
    if (!releases || !releases.length) return -1;
    return Math.max(...releases.map(scoreRelease));
}

function scoreRelease(release) {
    const rg = release["release-group"] || {};
    const primaryType = rg["primary-type"];
    const secondaryTypes = Array.isArray(rg["secondary-types"]) ? rg["secondary-types"] : [];
    let score = 0;

    if (primaryType === "Album") score += 4;
    else if (primaryType === "EP") score += 2;

    if (primaryType === "Album" && secondaryTypes.length === 0) score += 3;

    if (release.status === "Official") score += 2;

    return score;
}


async function gatherCoverArtCandidates(releases, max, maxTried) {
    const found = [];
    const seenReleaseIds = new Set();

    const topRgId = releases[0] && releases[0].rgId;
    if (topRgId) {
        const rgArt = await fetchReleaseGroupCoverArt(topRgId).catch(() => null);
        if (rgArt) {
            if (rgArt.releaseId) seenReleaseIds.add(rgArt.releaseId);
            found.push({
                data: rgArt.data,
                mime: rgArt.mime,
                releaseId: rgArt.releaseId || releases[0].id,
                releaseTitle: releases[0].title,
                releaseDate: releases[0].date
            });
        }
    }

    const tryLimit = Math.min(releases.length, maxTried || max);
    for (let i = 0; i < tryLimit; i++) {
        if (found.length >= max) break;
        const release = releases[i];
        if (seenReleaseIds.has(release.id)) continue;
        const art = await fetchCoverArt(release.id).catch(() => null);
        if (art) {
            seenReleaseIds.add(release.id);
            found.push({ ...art, releaseId: release.id, releaseTitle: release.title, releaseDate: release.date });
        }
    }
    return found;
}

async function fetchCoverArt(releaseId) {
    if (!releaseId) return null;
    const res = await fetch(`${COVER_ART_ARCHIVE}/release/${releaseId}/front-500`, {
        headers: { "User-Agent": USER_AGENT }
    });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return { data: buf, mime };
}

const CAA_RELEASE_ID_RE = /mbid-([0-9a-fA-F-]{36})/;

async function fetchReleaseGroupCoverArt(releaseGroupId) {
    if (!releaseGroupId) return null;
    const res = await fetch(`${COVER_ART_ARCHIVE}/release-group/${releaseGroupId}/front-500`, {
        headers: { "User-Agent": USER_AGENT }
    });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const match = CAA_RELEASE_ID_RE.exec(res.url || "");
    return { data: buf, mime, releaseId: match ? match[1] : null };
}

module.exports = { autoTagTrack };
