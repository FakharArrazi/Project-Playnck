// ================================================================
// autotag-bridge.js — Electron MAIN PROCESS module
// ----------------------------------------------------------------
// "Auto-tag" for the Edit modal: identify a track automatically and
// hand back title/artist/album/year/track number + cover art, so
// the user doesn't have to type them in by hand.
//
// Two-tier lookup, cheapest/most-accurate first:
//
//   1. AUDIO FINGERPRINTING (Chromaprint + AcoustID)
//      Works even when the filename/existing tags are garbage,
//      because it identifies the song from the audio itself.
//        a. Run the `fpcalc` command-line tool (from the Chromaprint
//           project) on the file to get a fingerprint + duration.
//        b. Send that fingerprint to AcoustID's lookup API, which
//           matches it against MusicBrainz recordings and hands back
//           the matching recording id(s).
//        c. Look each candidate recording up directly on
//           MusicBrainz's own API for its actual album/year/track
//           number/cover-art candidates — AcoustID's own release
//           metadata nests too differently to reuse directly (see
//           the comment on acoustidLookup), so this reuses the exact
//           same MusicBrainz call + parsing tier 2 already relies on.
//      Needs both a bundled/installed `fpcalc` binary and a free
//      AcoustID client API key — see the two constants below. If
//      either is missing, this tier is skipped silently and step 2
//      is used instead.
//
//   2. MUSICBRAINZ TEXT SEARCH (fallback)
//      Same thing AcoustID would have used under the hood, just
//      queried directly by whatever title/artist the track already
//      has. Less accurate (garbage-in/garbage-out) but needs no
//      binary and no API key, so it also works as tier 1's fallback
//      when fingerprinting can't find a confident match.
//
// Either tier can find metadata without art (AcoustID doesn't return
// cover images) or art without solid metadata, so after a match is
// found this always makes one extra pass at the Cover Art Archive
// using whichever MusicBrainz release id(s) came back, and treats
// that as optional — a metadata-only match is still returned as a
// success.
//
// Neither tier is guaranteed to return exactly one right answer —
// AcoustID can return several equally-plausible recordings for one
// fingerprint (covers, re-recordings, remasters), and a title/artist
// text search is inherently ambiguous. So rather than silently
// committing to whichever candidate happens to sort first, every
// plausible candidate is gathered (up to MAX_MATCHES) — each with
// its own cover-art options — and handed back as `matches` for the
// renderer to offer as a "which one is it?" picker. The single best
// guess is still mirrored at the top level for back-compat with
// anything that only reads title/artist/album/image directly.
//
// Exported and wired up to IPC in main.js:
//   autoTagTrack(filePath, hint, mode) -> {
//     found: boolean,
//     source: "fingerprint" | "musicbrainz" | null,
//     title, artist, album, year, trackNum,   // top match, any may be null
//     image: { data: Buffer, mime } | null,    // top match's best cover, if any
//     images: [{ data, mime, releaseId, releaseTitle, releaseDate }],  // top match's cover options
//     matches: [{                              // every candidate found, best first
//       source, title, artist, album, year, trackNum,
//       images: [{ data, mime, releaseId, releaseTitle, releaseDate }]
//     }],
//     reason?: string   // set when found is false, for the status line
//   }
//
//   mode ("auto" | "fingerprint" | "text", defaults to "auto"):
//   the Edit modal has two separate buttons — "identify from audio"
//   and "search by title/artist" — so each can be run independently
//   instead of always trying tier 1 then silently falling back to
//   tier 2. "auto" keeps the original combined behavior for any
//   caller that doesn't care which tier answered.
// ================================================================

const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { app } = require("electron");

// ----------------------------------------------------------------
// AcoustID client API key. Free — register one at
// https://acoustid.org/api-key and paste it in here. Fingerprint
// lookups (tier 1 above) are skipped entirely while this is blank;
// the MusicBrainz text-search fallback (tier 2) still works without
// it, so Auto-tag isn't fully dead without a key, just less accurate.
// ----------------------------------------------------------------
const ACOUSTID_CLIENT_KEY = "cJcqWYqnQr";

// A descriptive User-Agent is required by both AcoustID's and
// MusicBrainz's usage policies (and MusicBrainz will start throttling
// or rejecting requests from a generic/default one). Sent from the
// main process rather than the renderer specifically so this header
// can actually be set — browsers/renderer fetch() silently refuse to
// let scripts set User-Agent at all.
const USER_AGENT = "Playnck/1.1.5 ( https://github.com/FakharArrazi/Project-Playnck )";

const ACOUSTID_LOOKUP_URL = "https://api.acoustid.org/v2/lookup";
const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2";
const COVER_ART_ARCHIVE = "https://coverartarchive.org";

// How many distinct song candidates (title/artist/album combos) to
// hand back for the renderer's "which one is it?" dropdown. Kept
// modest — beyond a handful the dropdown just gets noisy, and every
// extra candidate costs another round of Cover Art Archive lookups.
const MAX_MATCHES = 5;

// How many recordings to actually fetch from MusicBrainz's text
// search before ranking. A popular song easily has a dozen+ distinct
// recordings — single mix, instrumental, acappella, a soundtrack cut,
// a compilation cut, someone else's cover — that all score more or
// less identically on title/artist relevance alone. Fetching only
// MAX_MATCHES up front (as this used to do) meant the actual studio-
// album recording could get crowded out of the results entirely by
// those variants before release quality ever got a say. Fetching a
// wider pool and ranking it (see musicbrainzQuery below) fixes that;
// only the top MAX_MATCHES of this pool are ever shown to the user.
const MUSICBRAINZ_SEARCH_POOL = 30;

// How many cover images to gather per candidate match, and the most
// releases we'll try per match while looking for them. Most releases
// have no art uploaded at all, so the try-limit needs to be a bit
// higher than the image count to actually find that many — but it's
// still capped so one match with a long, art-less release history
// can't stall the whole lookup.
const IMAGES_PER_MATCH = 3;
const MAX_RELEASES_TRIED_PER_MATCH = 5;

// Minimum AcoustID match score (0-1, AcoustID's own confidence value)
// to actually trust a fingerprint result. Without a floor here, a
// weak/likely-wrong match (short clip, noisy rip, a different song
// that just happens to fingerprint similarly) still counted as
// "solved" and skipped the tier-2 title/artist fallback entirely —
// this is what caused confidently-wrong metadata to come back, since
// nothing else was ever tried once *any* fingerprint result existed.
// 0.5 is a middle ground: strict enough to reject clearly-weak
// guesses, loose enough not to discard real matches on compressed/
// lower-quality audio. Raise it if wrong matches still get through,
// lower it if good matches start getting rejected in favor of a
// worse tier-2 text-search guess.
const MIN_ACOUSTID_SCORE = 0.5;

// How many raw AcoustID candidate recordings to resolve against
// MusicBrainz before filtering/ranking (see acoustidLookup). Needs
// to be bigger than MAX_MATCHES for the same reason
// MUSICBRAINZ_SEARCH_POOL is bigger than MAX_MATCHES below: filtering
// out junk (see isBundledRecording) after only collecting MAX_MATCHES
// raw candidates meant a real, clean match could get crowded out of
// the final list entirely just because a junk entry took its slot
// first. Kept modest (unlike MUSICBRAINZ_SEARCH_POOL) because each
// one costs a real sequential MusicBrainz request, not just a slice
// of one already-fetched response.
const ACOUSTID_CANDIDATE_POOL = 10;

// Some MusicBrainz "recordings" aren't a real single song at all —
// most commonly a deluxe-edition "Video: Song A / Song B / Song C..."
// entry bundling several tracks' worth of audio under one MBID. These
// can genuinely fingerprint-match (the audio really is in there) or
// turn up in a text search, but they're useless as a match: there's
// no real "title" or "album" to hand back, just a joined tracklist.
// Dropped entirely rather than surfaced as a candidate.
const BUNDLED_RECORDING_RE = /^(video|bonus video|megamix|medley)\s*:/i;
function isBundledRecording(title) {
    if (!title) return false;
    if (BUNDLED_RECORDING_RE.test(title)) return true;
    // 3+ " / "-joined segments reliably indicates a joined tracklist
    // rather than a real title that just happens to contain a slash.
    return title.split(" / ").length >= 3;
}

// guessFromName() in script.js falls back to this exact string for
// untagged files (see FILE / METADATA HANDLING there). It's not a
// real artist name, so if it's sent through as a search hint,
// MusicBrainz would (correctly) go looking for a recording credited
// to an artist literally called "Unknown Artist" and find nothing —
// this treats that placeholder the same as no artist hint at all.
const PLACEHOLDER_ARTIST = /^unknown artist$/i;

// Bracketed/parenthetical descriptors that show up in ripped
// filenames — "(Official Music Video)", "[HQ Audio]", "(Lyrics)" —
// but never appear in MusicBrainz's actual recording titles. Left
// in, they make an otherwise-exact title miss the strict quoted
// search below entirely, and dilute the loose search's relevance
// score enough to sink a genuinely obvious match under the
// confidence threshold. Matched case-insensitively, and only when
// the bracket actually contains one of these words — so a real
// parenthetical part of a title (e.g. "Paint It Black") is left
// untouched.
const JUNK_BRACKET_RE = /[(\[][^)\]]*\b(official|video|audio|lyrics?|visualizer|mv|hd|hq|4k|explicit)\b[^)\]]*[)\]]/gi;

// Cleans a title/artist string pulled from a filename or existing
// tags before it's used as MusicBrainz search text: strips the
// junk brackets above, a leading track number ("01 - ", "07.", ...)
// left over from guessFromName()'s "Artist - Title" split not
// anticipating a numbered filename, and normalizes stray
// underscores/extra whitespace. Fingerprinting (tier 1) never sees
// this — it only matters for the text-search fallback (tier 2),
// which is entirely garbage-in/garbage-out.
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

    // "auto" (default, back-compat): fingerprint first, falling back
    // to a title/artist search if that comes up empty — the original
    // combined behavior, kept for any caller that doesn't pass mode.
    // "fingerprint": only the audio-fingerprint tier — no text
    // fallback, so a miss here is reported as a miss rather than
    // silently turning into a (less trustworthy) text-search guess.
    // "text": only the MusicBrainz title/artist search — skipped
    // entirely regardless of whether fingerprinting is even
    // available, so this works as a plain "search by name" tool on
    // its own. See the two separate Auto-tag buttons in script.js.
    mode = (mode === "fingerprint" || mode === "text") ? mode : "auto";

    hint = hint || {};
    const hintArtist = (hint.artist && !PLACEHOLDER_ARTIST.test(hint.artist.trim())) ? hint.artist : "";
    const hasTextHint = !!(hint.title || hintArtist);

    let matches = null; // array of match objects, best guess first — see buildMatchFromRecording()

    // Set whenever tier 1 was attempted but didn't produce a match,
    // so the final `reason` below can say *why* instead of just
    // "no match" — see runFpcalc's {ok:false, error} case and the
    // "ran fine, AcoustID just had nothing" case right under it.
    let fingerprintNote = null;

    // --- Tier 1: fingerprint + AcoustID (skipped entirely in "text" mode) ---
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

    // --- Tier 2: MusicBrainz text search — runs when explicitly
    // requested ("text" mode), or as tier 1's fallback in "auto" mode
    // when fingerprinting didn't turn up anything. Never runs in
    // "fingerprint" mode, so a fingerprint-only request that misses
    // is reported as a miss instead of quietly becoming a text guess. ---
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

    // --- Cover art: gather a few candidates per candidate match
    // (best-guess release first) instead of committing to whichever
    // release happens to have art uploaded first — the renderer lets
    // the user pick from these directly if the top guess is the
    // wrong song, edition, or cover. Done sequentially, one match at
    // a time, to stay well within MusicBrainz/Cover Art Archive's
    // "please don't hammer us" expectations. ---
    for (const m of matches) {
        m.images = await gatherCoverArtCandidates(m.releases, IMAGES_PER_MATCH, MAX_RELEASES_TRIED_PER_MATCH);
        delete m.releases;       // internal-only; not useful to the renderer
        delete m.releaseScore;   // internal-only; used above to rank recordings against each other
        delete m.mbScore;        // internal-only; ditto
    }

    const top = matches[0];
    return {
        found: true,
        source,
        // Back-compat convenience fields mirroring the top candidate —
        // anything that only reads these keeps working exactly as before.
        title: top.title,
        artist: top.artist,
        album: top.album,
        year: top.year,
        trackNum: top.trackNum,
        image: top.images[0] || null,
        images: top.images,
        // Every candidate found, ranked best-first, for the renderer's
        // "which of these is it?" dropdown + per-candidate cover picker.
        matches
    };
}

// ================================================================
// TIER 1a — fpcalc (Chromaprint)
// ================================================================

// Locates a usable `fpcalc` binary. Tried in order:
//   1. Packaged build: resources/fpcalc/<platform>/ inside the app
//      package (see the "extraResources" entry for "resources/fpcalc"
//      in package.json — the platform-specific fpcalc/fpcalc.exe
//      binaries from https://acoustid.org/chromaprint need to be
//      placed there before building; this repo doesn't ship them).
//      app.isPackaged gates this because process.resourcesPath means
//      something different in dev — it points at Electron's own
//      internal resources folder, not this project's, so checking it
//      unconditionally would silently never find a dev-mode binary.
//   2. Dev/unpackaged: resources/fpcalc/<platform>/ relative to this
//      project's own folder (__dirname), which is where that same
//      folder actually lives during `npm start`.
//   3. Whatever `fpcalc` is on the system PATH, so this still works
//      during `npm start` if Chromaprint is installed locally instead
//      of being placed in resources/fpcalc/.
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
            // not here, try the next candidate
        }
    }
    return bin; // rely on PATH
}

// Runs `fpcalc -json <file>` and parses its output. Always resolves
// (never throws): {ok:true, fingerprint, duration} on success, or
// {ok:false, error} on failure — the error string is what actually
// gets surfaced in autoTagTrack's `reason` field below when nothing
// else pans out either, since "fingerprinting silently did nothing"
// is otherwise invisible to anyone not watching this process's
// console (which a packaged app's user never sees).
function runFpcalc(filePath) {
    return new Promise((resolve) => {
        const bin = resolveFpcalcPath();
        execFile(bin, ["-json", filePath], { timeout: 20000 }, (err, stdout) => {
            if (err) {
                // ENOENT is specifically "no such executable" — by far the
                // most common case, since getting an AcoustID key and
                // actually placing the fpcalc binary are two separate,
                // easy-to-forget steps (see resolveFpcalcPath above).
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

// ================================================================
// TIER 1b — AcoustID lookup
// ================================================================

// AcoustID is asked for bare recording matches only (no
// releases/releasegroups meta) — see the comment inside this
// function for why: its release/release-group data nests
// completely differently than MusicBrainz's own API does once a
// specific recording is looked up directly, which is what this now
// does for every candidate instead.
async function acoustidLookup(fingerprint, duration) {
    const url = `${ACOUSTID_LOOKUP_URL}?client=${encodeURIComponent(ACOUSTID_CLIENT_KEY)}`
        + `&meta=recordings+compress`
        + `&duration=${duration}&fingerprint=${encodeURIComponent(fingerprint)}`;

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "ok" || !Array.isArray(data.results) || !data.results.length) return null;

    // Every result that actually carries a recording AND clears the
    // confidence floor, best score first — a single fingerprint often
    // legitimately matches more than one recording (the same
    // performance reissued, a remaster, a live version), so this
    // collects all of them rather than committing to whichever
    // happened to score highest. Results below MIN_ACOUSTID_SCORE are
    // dropped entirely (not just deprioritized) so a weak guess can't
    // block the tier-2 fallback in autoTagTrack from getting a chance
    // at a better answer — see the comment on MIN_ACOUSTID_SCORE.
    const sorted = data.results
        .filter(r => (r.score || 0) >= MIN_ACOUSTID_SCORE && r.recordings && r.recordings.length)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
    if (!sorted.length) return null;

    // AcoustID's own recording objects only ever carry a bare
    // id/title/artist — its release/release-group metadata (when
    // requested via meta=releases+releasegroups) nests completely
    // differently than MusicBrainz's own recording-search API does,
    // which is the exact shape buildMatchFromRecording() below is
    // written against (a flat `releases` array, each with a
    // hyphenated `release-group` object carrying `primary-type`).
    // Trying to also parse AcoustID's own version of this would mean
    // maintaining two different release parsers, one of them far
    // less exercised/certain than the other. Instead, AcoustID is
    // used for exactly the one thing it's actually the best tool
    // for — telling us WHICH recording this is, from the audio alone
    // — and then that recording is looked up directly on
    // MusicBrainz's own API for everything else (album, year, track
    // number, cover art candidates): the exact same call, and the
    // exact same buildMatchFromRecording() call, tier 2 already uses.
    // One "what do we do with a known recording id" code path,
    // regardless of which tier found it.
    const seen = new Set();
    const candidates = []; // {id, fallback: AcoustID's own bare recording, used only if the MusicBrainz lookup below fails}
    idLoop:
    for (const result of sorted) {
        for (const recording of result.recordings) {
            if (!recording.id || seen.has(recording.id)) continue;
            seen.add(recording.id);
            if (isBundledRecording(recording.title)) continue; // see isBundledRecording above
            candidates.push({ id: recording.id, fallback: recording });
            if (candidates.length >= ACOUSTID_CANDIDATE_POOL) break idLoop;
        }
    }
    if (!candidates.length) return null;

    // Sequential, not parallel — same "don't hammer MusicBrainz"
    // reasoning as the cover-art loop in autoTagTrack above.
    const matches = [];
    for (const c of candidates) {
        const mbRecording = await fetchMusicBrainzRecording(c.id).catch(() => null);
        // Falls back to AcoustID's own bare title/artist (no album,
        // no cover) only if MusicBrainz's own lookup for this
        // specific id failed — a transient network hiccup shouldn't
        // drop the candidate entirely, just its extra metadata.
        matches.push(buildMatchFromRecording(mbRecording || c.fallback, "fingerprint"));
    }
    return matches.length ? matches : null;
}

// Looks up one recording directly on MusicBrainz's own API — see the
// big comment in acoustidLookup above for why this exists instead of
// trusting AcoustID's own release metadata. Returns null (never
// throws) on a bad response, same "just try the fallback" contract
// as everything else in this file.
async function fetchMusicBrainzRecording(mbid) {
    if (!mbid) return null;
    const url = `${MUSICBRAINZ_API}/recording/${mbid}?fmt=json&inc=releases+release-groups+artist-credits`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    if (!res.ok) return null;
    return await res.json();
}

// ================================================================
// TIER 2 — MusicBrainz recording text search (fallback)
// ================================================================

async function musicbrainzTextSearch(title, artist) {
    title = cleanForSearch(title);
    artist = cleanForSearch(artist);
    if (!title && !artist) return null;

    // Strict, field-anchored query first — most accurate when the
    // hint text is clean.
    const parts = [];
    if (title) parts.push(`recording:"${title.replace(/"/g, '\\"')}"`);
    if (artist) parts.push(`artist:"${artist.replace(/"/g, '\\"')}"`);
    const strict = await musicbrainzQuery(parts.join(" AND "));
    if (strict && strict.length) return strict;

    // Fallback: the strict, quoted-AND query above is precise but
    // brittle — a filename-derived guess with slightly off spelling,
    // punctuation, or word order finds nothing at all under it. Retry
    // once with a loose, unanchored query (both terms, no quoting, no
    // field restriction) before giving up.
    const loose = await musicbrainzQuery([title, artist].filter(Boolean).join(" "));
    return (loose && loose.length) ? loose : null;
}

// Runs one MusicBrainz recording search and turns every plausible
// result into a normalized match, ranked best-first. Returns null
// (never throws) on a bad response or zero results, so callers can
// just try the next query/tier.
async function musicbrainzQuery(query) {
    if (!query) return null;

    const url = `${MUSICBRAINZ_API}/recording/?query=${encodeURIComponent(query)}`
        + `&fmt=json&limit=${MUSICBRAINZ_SEARCH_POOL}&inc=releases+release-groups+artist-credits`;

    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.recordings || !data.recordings.length) return null;

    // Keep everything reasonably confident on text relevance alone —
    // genuine ambiguity (covers, re-releases, same title by a
    // different artist) should show up as real options — but if
    // nothing clears that bar, still surface the single top result
    // rather than reporting no match at all, same as before. Bundled
    // multi-track entries (see isBundledRecording) are dropped first,
    // before the confidence cut, so one doesn't waste a slot in the
    // "top result" fallback either.
    const usable = data.recordings.filter(r => !isBundledRecording(r.title));
    const confident = usable.filter(r => (r.score || 0) >= 50);
    const pool = confident.length ? confident : usable.slice(0, 1);

    const built = pool.map(r => buildMatchFromRecording(r, "musicbrainz"));

    // MusicBrainz's own score only measures text relevance — it can't
    // tell a song's official studio-album recording apart from its
    // single mix, instrumental, acappella, or a random compilation
    // cut, since all of those match "Title" + "Artist" equally well.
    // Re-rank the confident pool by how "canonical" each recording's
    // best release actually looks (studio album > EP > single/other,
    // via scoreRelease), falling back to MusicBrainz's own score only
    // to break ties — this is what actually fixes the classic 'Till I
    // Collapse -> wrong single/no-cover-art mix-up instead of just
    // picking the right release once the wrong recording's already
    // been chosen.
    if (confident.length) {
        built.sort((a, b) => (b.releaseScore - a.releaseScore) || (b.mbScore - a.mbScore));
    }

    return built;
}

// Both AcoustID's "recordings" objects and MusicBrainz's own
// "recording" search results share the same shape (id, title,
// artist-credit, releases[]), so one function turns either into the
// same normalized match object.
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
        // Cross-recording ranking helpers (musicbrainzQuery above) —
        // stripped back out in autoTagTrack before this reaches the
        // renderer, same as `releases` below.
        releaseScore: bestReleaseScore(releases),
        mbScore: recording.score || 0,
        // Ranked (best guess first, per scoreRelease below) release
        // candidates — used both for the album/year/trackNum picked
        // above and for pulling multiple cover-art options so the
        // user can pick if the top guess isn't the right edition.
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

// The highest scoreRelease() among a recording's releases — used to
// rank recordings against each other (see musicbrainzQuery), not just
// to rank one recording's own releases against themselves. A
// recording with no release info at all sinks to the bottom rather
// than tying with a genuine low scorer.
function bestReleaseScore(releases) {
    if (!releases || !releases.length) return -1;
    return Math.max(...releases.map(scoreRelease));
}

// Ranks a MusicBrainz release for "how likely is this the edition
// someone means when they just say the song title" — a single or a
// various-artists compilation that happens to include this track
// scores far lower than the actual studio album, even though the
// text search has no way to tell those apart by title alone (see
// the 'Till I Collapse -> "'Till I Collapse" single vs "The Eminem
// Show" album mix-up this was written to fix).
function scoreRelease(release) {
    const rg = release["release-group"] || {};
    const primaryType = rg["primary-type"];
    const secondaryTypes = Array.isArray(rg["secondary-types"]) ? rg["secondary-types"] : [];
    let score = 0;

    if (primaryType === "Album") score += 4;
    else if (primaryType === "EP") score += 2;
    // Single/Broadcast/Other and anything unset stay at 0 here.

    // A "clean" studio album (no Compilation/Live/Soundtrack/Remix/
    // Mixtape secondary type attached) beats a Greatest Hits or Live
    // release that merely happens to also be classified as an Album.
    if (primaryType === "Album" && secondaryTypes.length === 0) score += 3;

    if (release.status === "Official") score += 2;

    return score;
}

// ================================================================
// COVER ART ARCHIVE
// ================================================================

// Tries the Cover Art Archive against a ranked list of release
// candidates and returns every image it actually finds (not just
// the first), up to `max` — so the renderer can offer a real choice
// instead of silently committing to whichever release happened to
// have art uploaded first. Each entry carries the release's
// title/date so the UI can label the options.
//
// `maxTried` bounds how many releases are attempted at all (defaults
// to `max`, i.e. no extra slack): most releases have no art uploaded,
// so finding `max` images often means trying more than `max`
// releases, but a release list that's entirely art-less shouldn't be
// allowed to turn into an unbounded string of network requests.
async function gatherCoverArtCandidates(releases, max, maxTried) {
    const found = [];
    const seenReleaseIds = new Set();

    // Try the TOP release's release-group first. Cover Art Archive's
    // release-group endpoint resolves to whichever specific edition
    // within that group the community actually uploaded/chose art
    // for — which is very often a *different* release id than the
    // one MusicBrainz's search/fingerprint match happened to rank
    // #1 (a different country pressing, a reissue, etc). Skipping
    // this meant real, existing art was invisible any time the top-
    // ranked release itself just wasn't the one someone uploaded a
    // cover for, even though the album clearly has one archived.
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
        if (seenReleaseIds.has(release.id)) continue; // already have this exact release's art via the group lookup above
        const art = await fetchCoverArt(release.id).catch(() => null);
        if (art) {
            seenReleaseIds.add(release.id);
            found.push({ ...art, releaseId: release.id, releaseTitle: release.title, releaseDate: release.date });
        }
    }
    return found;
}

// Fetches the front cover for one release id. Returns null (not an
// error) for the very common case of "this particular release just
// has no art uploaded" — callers try the next release id instead.
async function fetchCoverArt(releaseId) {
    if (!releaseId) return null;
    const res = await fetch(`${COVER_ART_ARCHIVE}/release/${releaseId}/front-500`, {
        headers: { "User-Agent": USER_AGENT }
    });
    if (!res.ok) return null; // 404 = no art for this release, not an error
    const mime = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return { data: buf, mime };
}

// Internet Archive stores each release's cover art under an item
// named "mbid-<release id>", which shows up in the final redirected
// URL — this is how a release-group hit below can still be
// attributed back to the specific release id it actually came from
// (for the renderer's dedup/labeling), even though we only asked for
// the group as a whole.
const CAA_RELEASE_ID_RE = /mbid-([0-9a-fA-F-]{36})/;

// Fetches the cover art the community picked to represent an entire
// release group — i.e. whichever specific edition within it actually
// has art uploaded — rather than one exact release id. See the
// comment on gatherCoverArtCandidates above for why this exists: the
// release MusicBrainz's search/fingerprint match ranked #1 for a
// recording isn't always the edition that happens to have art in the
// Cover Art Archive, even when the album clearly does have art there
// under a different release id.
async function fetchReleaseGroupCoverArt(releaseGroupId) {
    if (!releaseGroupId) return null;
    const res = await fetch(`${COVER_ART_ARCHIVE}/release-group/${releaseGroupId}/front-500`, {
        headers: { "User-Agent": USER_AGENT }
    });
    if (!res.ok) return null; // 404 = no art chosen for this release group either
    const mime = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const match = CAA_RELEASE_ID_RE.exec(res.url || "");
    return { data: buf, mime, releaseId: match ? match[1] : null };
}

module.exports = { autoTagTrack };
