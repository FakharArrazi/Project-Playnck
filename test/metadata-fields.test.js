const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../script/metadata-fields.js");

const baseTrack = () => ({
  title: "Song",
  artist: "Artist",
  artists: ["Artist"],
  album: "Album",
  albumArtist: "Album Artist",
  genre: ["Rock"],
  year: 2019,
  date: "2019-05-17",
  trackNum: 3,
  trackTotal: 12,
  discNumber: 1,
  discTotal: 2,
  composer: [],
  releaseId: "rel-old",
  releaseGroupId: "rg-old",
});

async function edit(changes, opts) {
  const f = await load();
  const original = f.valuesFromTrack(baseTrack());
  const current = { ...original, ...changes };
  return f.resolveEdit(original, current, opts);
}

test("parseInput: numbers, lists, ISRC and garbage", async () => {
  const f = await load();
  assert.equal(f.parseInput("bpm", " 128 "), 128);
  assert.equal(f.parseInput("bpm", ""), null);
  assert.ok(Number.isNaN(f.parseInput("bpm", "12abc")));
  assert.ok(Number.isNaN(f.parseInput("trackNum", "-3")));
  assert.deepEqual(f.parseInput("genre", " Rock ;Pop;; rock; Pop "), ["Rock", "Pop", "rock"]);
  assert.equal(f.parseInput("isrc", "us-rc1 7607839"), "USRC17607839");
  assert.equal(f.parseInput("lyrics", "a\r\nb"), "a\nb");
});

test("nothing changed -> nothing to write", async () => {
  const r = await edit({});
  assert.equal(r.changed.size, 0);
  assert.deepEqual(r.payload, {});
  assert.deepEqual(r.errors, {});
});

test("only changed fields reach the payload; clearing sends an empty value", async () => {
  const r = await edit({ genre: [], label: "Sub Pop" });
  assert.deepEqual(r.payload, { genre: [], label: "Sub Pop" });
});

test("title/artist/album can't be blanked", async () => {
  const r = await edit({ title: null, album: "New Album" });
  assert.equal("title" in r.payload, false);
  assert.equal(r.payload.album, "New Album");
});

test("track and disc numbers always travel with their totals", async () => {
  const r = await edit({ trackNum: 5 });
  assert.equal(r.payload.trackNum, 5);
  assert.equal(r.payload.trackTotal, 12);
  assert.equal("discNumber" in r.payload, false);
});

test("year and release date never disagree", async () => {
  let r = await edit({ year: 2021 }); // date was 2019-05-17
  assert.equal(r.errors.date, "edit.errDateYear"); // raw form state is inconsistent...
  const f = await load();
  // ...and normalizeRelease is what the UI uses to fix it
  assert.deepEqual(f.normalizeRelease("2019-05-17", 2021), { date: "2021", year: 2021 });
  assert.deepEqual(f.normalizeRelease("2019-05-17", null), { date: "2019-05-17", year: 2019 });
  assert.deepEqual(f.normalizeRelease(null, 2020), { date: "2020", year: 2020 });
  assert.deepEqual(f.normalizeRelease(null, null), { date: null, year: null });
  r = await edit({ year: 2021, date: "2021" });
  assert.deepEqual(r.errors, {});
  assert.equal(r.payload.date, "2021");
  assert.equal(r.payload.year, 2021);
});

test("validation: dates, years, numbers, BPM, ISRC", async () => {
  const cases = [
    [{ date: "2019-02-30", year: 2019 }, "date", "edit.errDate"],
    [{ date: "19-05-17" }, "date", "edit.errDate"],
    [{ date: "2019-13" }, "date", "edit.errDate"],
    [{ year: 99 }, "year", "edit.errYear"],
    [{ year: NaN }, "year", "edit.errYear"],
    [{ originalDate: "soon" }, "originalDate", "edit.errDate"],
    [{ trackNum: 0 }, "trackNum", "edit.errPositive"],
    [{ trackNum: NaN }, "trackNum", "edit.errPositive"],
    [{ trackNum: 13 }, "trackNum", "edit.errTrackRange"],
    [{ discNumber: 3 }, "discNumber", "edit.errDiscRange"],
    [{ bpm: 0 }, "bpm", "edit.errBpm"],
    [{ bpm: 1000 }, "bpm", "edit.errBpm"],
    [{ bpm: NaN }, "bpm", "edit.errBpm"],
    [{ isrc: "NOTANISRC" }, "isrc", "edit.errIsrc"],
  ];
  for (const [changes, key, message] of cases) {
    const r = await edit(changes);
    assert.equal(r.errors[key], message, JSON.stringify(changes));
  }
  for (const ok of [
    { date: "2020-02-29", year: 2020 },
    { date: "2019-05", year: 2019 },
    { bpm: 999 },
    { isrc: "USRC17607839" },
    { trackNum: 12 },
  ]) {
    assert.deepEqual((await edit(ok)).errors, {}, JSON.stringify(ok));
  }
});

test("pre-existing oddities don't block unrelated edits", async () => {
  const f = await load();
  const t = { ...baseTrack(), trackNum: 15, trackTotal: 12 }; // track 15 of 12
  const original = f.valuesFromTrack(t);
  const r = f.resolveEdit(original, { ...original, genre: ["Jazz"] });
  assert.deepEqual(r.errors, {});
});

test("renaming the album by hand drops the stale MusicBrainz release IDs", async () => {
  let r = await edit({ album: "Renamed" });
  assert.equal(r.payload.releaseId, null);
  assert.equal(r.payload.releaseGroupId, null);
  assert.equal(r.library.releaseId, null);
  r = await edit({ albumArtist: "Someone Else" });
  assert.equal(r.payload.releaseId, null);
  r = await edit({ genre: ["Pop"] });
  assert.equal("releaseId" in r.payload, false);
});

test("an applied match supplies fresh IDs instead of clearing them", async () => {
  const r = await edit(
    { album: "Matched Album" },
    {
      matchFields: {
        releaseId: "rel-new",
        recordingId: "rec-new",
        artistIds: ["a1"],
        releaseGroupId: null,
        releaseType: "Album",
      },
    },
  );
  assert.equal(r.payload.releaseId, "rel-new");
  assert.equal(r.payload.recordingId, "rec-new");
  assert.deepEqual(r.payload.artistIds, ["a1"]);
  assert.equal("releaseGroupId" in r.payload, false);
  assert.equal(r.library.releaseType, "Album");
});

test("contributing artists: auto-derived vs hand-edited", async () => {
  const f = await load();
  const t = { ...baseTrack(), artist: "A; B", artists: ["A", "B"] };
  const original = f.valuesFromTrack(t);

  // Artist edited, contributing left alone: stale multi-artist tag is cleared
  let r = f.resolveEdit(original, { ...original, artist: "Solo", artists: ["Solo"] });
  assert.deepEqual(r.payload.artists, []);
  assert.deepEqual(r.library.artists, ["Solo"]);

  // Contributing hand-edited: written as typed
  r = f.resolveEdit(original, { ...original, artists: ["A", "B", "C"] }, { artistsTouched: true });
  assert.deepEqual(r.payload.artists, ["A", "B", "C"]);

  // Single-artist track whose Artist changed: nothing extra is written
  const o2 = f.valuesFromTrack(baseTrack());
  r = f.resolveEdit(o2, { ...o2, artist: "New Name", artists: ["New Name"] });
  assert.equal("artists" in r.payload, false);
  assert.deepEqual(r.library.artists, ["New Name"]);
});

test("compilation checkbox round-trips", async () => {
  const r = await edit({ compilation: true });
  assert.equal(r.payload.compilation, true);
  const f = await load();
  assert.equal(f.valuesFromTrack({ ...baseTrack(), compilation: null }).compilation, false);
});
