// MusicBrainz is mocked with fixtures shaped like its JSON API, so these run
// offline. Electron's `app` is stubbed because autotag-bridge reads its version.

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron")
    return { app: { getVersion: () => "0.0.0", isPackaged: false } };
  return realLoad.call(this, request, ...rest);
};
const bridge = require("../autotag-bridge");
Module._load = realLoad;

const credit = (name, id) => [{ name, joinphrase: "", artist: { id, name } }];
const RELEASE_SUMMARY = {
  id: "rel-1",
  title: "The Album",
  date: "2019-05-17",
  status: "Official",
  "artist-credit": credit("Album Artist", "art-aa"),
  "release-group": { id: "rg-1", "primary-type": "Album", title: "The Album" },
  media: [
    {
      position: 2,
      "track-count": 10,
      track: [{ number: "4", recording: { id: "rec-1" } }],
    },
    { position: 1, "track-count": 8, track: [] },
  ],
};

const SEARCH = {
  recordings: [
    {
      id: "rec-1",
      score: 100,
      title: "The Song",
      "artist-credit": credit("The Artist", "art-1"),
      isrcs: ["USABC1900001"],
      releases: [RELEASE_SUMMARY],
    },
  ],
};

function withFakeFetch(routes, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    for (const [needle, body] of routes) {
      if (String(url).includes(needle)) {
        if (body === 404) return { ok: false, status: 404 };
        return {
          ok: true,
          status: 200,
          url: String(url),
          headers: { get: () => "application/json" },
          json: async () => body,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
    }
    return { ok: false, status: 404 };
  };
  return Promise.resolve(fn(calls)).finally(() => (global.fetch = real));
}

test("text search results carry album artist, date, track/disc and ISRC", async () => {
  const result = await withFakeFetch(
    [["/recording/?query", SEARCH], ["coverartarchive", 404]],
    () => bridge.autoTagTrack("/music/x.mp3", { title: "The Song", artist: "The Artist" }, "text"),
  );
  assert.equal(result.found, true);
  const m = result.matches[0];
  assert.equal(m.title, "The Song");
  assert.equal(m.artist, "The Artist");
  assert.equal(m.album, "The Album");
  assert.equal(m.albumArtist, "Album Artist");
  assert.equal(m.year, 2019);
  assert.equal(m.date, "2019-05-17");
  assert.equal(m.trackNum, 4);
  assert.equal(m.trackTotal, 10);
  assert.equal(m.discNumber, 2);
  assert.equal(m.discTotal, 2);
  assert.equal(m.isrc, "USABC1900001");
  assert.equal(m.releaseId, "rel-1");
  assert.deepEqual(m.artistIds, ["art-1"]);
});

test("genres: curated genres only, most-voted first, nicely capitalised", () => {
  const g = bridge.genresFrom({
    genres: [
      { name: "alternative rock", count: 3 },
      { name: "r&b", count: 9 },
      { name: "hip hop", count: 5 },
      { name: "trip-hop", count: 1 },
    ],
    tags: [{ name: "seen live", count: 99 }],
  });
  assert.deepEqual(g, ["R&B", "Hip Hop", "Alternative Rock"]);
  assert.deepEqual(bridge.genresFrom({ tags: [{ name: "seen live", count: 5 }] }), []);
  assert.equal(bridge.prettyGenre("trip-hop"), "Trip-Hop");
});

const RECORDING_DETAIL = {
  id: "rec-1",
  isrcs: ["USABC1900001", "USABC1900002"],
  genres: [],
  relations: [
    {
      type: "performance",
      work: {
        id: "w1",
        relations: [
          { type: "composer", artist: { name: "Comp One" } },
          { type: "writer", artist: { name: "Comp Two" } },
          { type: "composer", artist: { name: "Comp One" } },
          { type: "lyricist", artist: { name: "Lyr One" } },
        ],
      },
    },
    { type: "producer", artist: { name: "Not A Composer" } },
  ],
};
const RELEASE_DETAIL = {
  id: "rel-1",
  date: "2019-05-17",
  "label-info": [
    { label: { name: "[no label]" } },
    { "catalog-number": "X1", label: { name: "Some Label" } },
  ],
  genres: [{ name: "synth-pop", count: 2 }],
  "release-group": { id: "rg-1", "first-release-date": "2001-03-02" },
};

test("details: composers, lyricists, label, original date, ISRC, genre fallback", () => {
  const d = bridge.parseMatchDetails({ recording: RECORDING_DETAIL, release: RELEASE_DETAIL });
  assert.deepEqual(d.composer, ["Comp One", "Comp Two"]);
  assert.deepEqual(d.lyricist, ["Lyr One"]);
  assert.equal(d.label, "Some Label");
  assert.equal(d.originalDate, "2001-03-02");
  assert.equal(d.date, "2019-05-17");
  assert.equal(d.isrc, "USABC1900001");
  assert.deepEqual(d.genre, ["Synth-Pop"]);
});

test("details: missing data yields an empty object, never nulls that would erase tags", () => {
  const d = bridge.parseMatchDetails({ recording: { id: "x" }, release: null });
  assert.deepEqual(d, {});
});

test("fetchMatchDetails walks release-group then artist only while genre is missing", async () => {
  const calls = await withFakeFetch(
    [
      ["/recording/rec-1", { ...RECORDING_DETAIL, genres: [] }],
      ["/release/rel-1", { ...RELEASE_DETAIL, genres: [], "release-group": { id: "rg-1" } }],
      ["/release-group/rg-1", { id: "rg-1", genres: [] }],
      ["/artist/art-1", { id: "art-1", genres: [{ name: "indie rock", count: 4 }] }],
    ],
    async (calls) => {
      const d = await bridge.fetchMatchDetails({
        recordingId: "rec-1",
        releaseId: "rel-1",
        releaseGroupId: "rg-1",
        artistIds: ["art-1"],
      });
      assert.deepEqual(d.genre, ["Indie Rock"]);
      assert.deepEqual(d.composer, ["Comp One", "Comp Two"]);
      return calls;
    },
  );
  assert.equal(calls.length, 4);

  const calls2 = await withFakeFetch(
    [
      ["/recording/rec-1", { ...RECORDING_DETAIL, genres: [{ name: "pop", count: 1 }] }],
      ["/release/rel-1", RELEASE_DETAIL],
    ],
    async (calls) => {
      const d = await bridge.fetchMatchDetails({ recordingId: "rec-1", releaseId: "rel-1", releaseGroupId: "rg-1", artistIds: ["art-1"] });
      assert.deepEqual(d.genre, ["Pop"]);
      return calls;
    },
  );
  assert.equal(calls2.length, 2, "no extra lookups when genre is already known");
});

test("a failing details lookup degrades to whatever was found", async () => {
  const d = await withFakeFetch(
    [["/recording/rec-1", RECORDING_DETAIL]],
    () => bridge.fetchMatchDetails({ recordingId: "rec-1", releaseId: "rel-1" }),
  );
  assert.deepEqual(d.composer, ["Comp One", "Comp Two"]);
  assert.equal(d.label, undefined);
});
