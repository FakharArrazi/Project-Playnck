// Run with:  node --test
// Needs `ffmpeg` on PATH to generate fixtures (tests skip themselves if absent).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const { getAudioMetadata, writeAudioTags } = require("../metadata-bridge");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "playnck-tags-"));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// 1x1 PNG, enough for cover-art round-trips.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makeFixture(name, codecArgs, extra = []) {
  const file = path.join(tmpRoot, name);
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    ...codecArgs, ...extra, file,
  ]);
  return file;
}

function decodes(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]);
  return r.status === 0 && r.stderr.length === 0;
}

function leftovers(file) {
  return fs
    .readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(".playnck-tagwrite-"));
}

const FULL = {
  title: "New Title",
  artist: "Artist One; Artist Two",
  artists: ["Artist One", "Artist Two"],
  album: "New Album",
  albumArtist: "Album Artist",
  genre: ["Rock", "Alt Pop"],
  composer: ["Comp One", "Comp Two"],
  lyricist: ["Lyr One"],
  conductor: "Cond",
  grouping: "Grp",
  subtitle: "Sub",
  label: "Some Label",
  copyright: "(c) 2019 Someone",
  isrc: "USABC1900001",
  comment: "A comment",
  lyrics: "line one\nline two",
  bpm: 128,
  compilation: true,
  date: "2019-05-17",
  year: 2019,
  originalDate: "2001-03-02",
  trackNum: 3,
  trackTotal: 12,
  discNumber: 1,
  discTotal: 2,
  recordingId: "11111111-1111-1111-1111-111111111111",
  releaseId: "22222222-2222-2222-2222-222222222222",
  releaseGroupId: "33333333-3333-3333-3333-333333333333",
  artistIds: ["44444444-4444-4444-4444-444444444444"],
  albumArtistIds: ["55555555-5555-5555-5555-555555555555"],
};

function assertFields(meta, expected, ignore = new Set()) {
  for (const [key, value] of Object.entries(expected)) {
    if (ignore.has(key)) continue;
    assert.deepEqual(meta[key], value, `field "${key}"`);
  }
}

for (const [label, ext, codec] of [
  ["MP3", "mp3", ["-c:a", "libmp3lame"]],
  ["FLAC", "flac", ["-c:a", "flac"]],
]) {
  test(`${label}: writes every field and reads it all back`, { skip: !hasFfmpeg }, async () => {
    const file = makeFixture(`full.${ext}`, codec);
    const res = await writeAudioTags(file, FULL);
    assert.equal(res.written, true, res.reason);
    assert.deepEqual(res.skipped, []);
    assertFields(await getAudioMetadata(file), FULL);
    assert.ok(decodes(file), "audio still decodes");
    assert.deepEqual(leftovers(file), []);
  });
}

test("M4A: standard fields round-trip; others are reported, not silently lost", { skip: !hasFfmpeg }, async () => {
  for (const faststart of [false, true]) {
    const file = makeFixture(
      `full-${faststart}.m4a`,
      ["-c:a", "aac"],
      faststart ? ["-movflags", "+faststart"] : [],
    );
    const before = await getAudioMetadata(file);
    const res = await writeAudioTags(file, FULL);
    assert.equal(res.written, true, res.reason);
    const meta = await getAudioMetadata(file);
    assertFields(meta, FULL);
    // chunk offsets must still be valid or the audio would be garbage
    assert.ok(decodes(file), `audio decodes (faststart=${faststart})`);
    assert.ok(Math.abs(meta.duration - before.duration) < 0.05, "duration unchanged");
    assert.deepEqual(res.skipped, []);
  }
});

test("M4A: repeated edits stay stable and keep unrelated atoms", { skip: !hasFfmpeg }, async () => {
  const file = makeFixture("repeat.m4a", ["-c:a", "aac"], ["-metadata", "grouping=Keep Me"]);
  await writeAudioTags(file, { title: "One", genre: ["Pop"] });
  await writeAudioTags(file, { title: "Two", bpm: 90, label: "L" });
  await writeAudioTags(file, { album: "Alb" });
  const meta = await getAudioMetadata(file);
  assert.equal(meta.title, "Two");
  assert.equal(meta.album, "Alb");
  assert.deepEqual(meta.genre, ["Pop"]);
  assert.equal(meta.grouping, "Keep Me");
  assert.ok(decodes(file));
});

test("FLAC: preserves unrelated comments, other blocks and existing audio", { skip: !hasFfmpeg }, async () => {
  const file = makeFixture("keep.flac", ["-c:a", "flac"], [
    "-metadata", "REPLAYGAIN_TRACK_GAIN=-6.5 dB",
    "-metadata", "MYCUSTOMTAG=hello",
    "-metadata", "title=Old",
  ]);
  const res = await writeAudioTags(file, { title: "Changed", genre: ["Jazz"] });
  assert.equal(res.written, true, res.reason);
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", file]).toString();
  const tags = JSON.parse(out).format.tags;
  const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(lower.title, "Changed");
  assert.equal(lower.genre, "Jazz");
  assert.equal(lower.replaygain_track_gain, "-6.5 dB");
  assert.equal(lower.mycustomtag, "hello");
  assert.ok(decodes(file));
});

test("MP3: untouched frames survive an edit", { skip: !hasFfmpeg }, async () => {
  const file = makeFixture("keep.mp3", ["-c:a", "libmp3lame"], [
    "-metadata", "title=Old", "-metadata", "encoded_by=me", "-metadata", "language=eng",
  ]);
  const res = await writeAudioTags(file, { title: "Changed" });
  assert.equal(res.written, true, res.reason);
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags", "-of", "json", file]).toString();
  const tags = JSON.parse(out).format.tags;
  assert.equal(tags.title, "Changed");
  assert.equal(tags.encoded_by, "me");
  assert.equal(tags.language, "eng");
});

for (const [label, ext, codec] of [
  ["MP3", "mp3", ["-c:a", "libmp3lame"]],
  ["FLAC", "flac", ["-c:a", "flac"]],
  ["M4A", "m4a", ["-c:a", "aac"]],
]) {
  test(`${label}: clearing a field removes it; omitted fields are left alone`, { skip: !hasFfmpeg }, async () => {
    const file = makeFixture(`clear.${ext}`, codec);
    await writeAudioTags(file, { title: "T", album: "Alb", genre: ["Rock"], bpm: 100, comment: "c", trackNum: 4, trackTotal: 9 });
    const res = await writeAudioTags(file, { genre: [], bpm: null, comment: "" });
    assert.equal(res.written, true, res.reason);
    const meta = await getAudioMetadata(file);
    assert.deepEqual(meta.genre, []);
    assert.equal(meta.bpm, null);
    assert.equal(meta.comment, null);
    assert.equal(meta.title, "T");
    assert.equal(meta.album, "Alb");
    assert.equal(meta.trackNum, 4);
    assert.equal(meta.trackTotal, 9);
  });

  test(`${label}: editing only the track number keeps the existing total`, { skip: !hasFfmpeg }, async () => {
    const file = makeFixture(`pair.${ext}`, codec);
    await writeAudioTags(file, { trackNum: 2, trackTotal: 10, discNumber: 1, discTotal: 3 });
    const res = await writeAudioTags(file, { trackNum: 7, discNumber: 2 });
    assert.equal(res.written, true, res.reason);
    const meta = await getAudioMetadata(file);
    assert.equal(meta.trackNum, 7);
    assert.equal(meta.trackTotal, 10);
    assert.equal(meta.discNumber, 2);
    assert.equal(meta.discTotal, 3);
  });

  test(`${label}: year and release date never disagree`, { skip: !hasFfmpeg }, async () => {
    const file = makeFixture(`date.${ext}`, codec);
    await writeAudioTags(file, { date: "2019-05-17", year: 2019 });
    let meta = await getAudioMetadata(file);
    assert.equal(meta.date, "2019-05-17");
    assert.equal(meta.year, 2019);
    // only the year changes -> the date collapses to that year
    const res = await writeAudioTags(file, { year: 2021 });
    assert.equal(res.written, true, res.reason);
    meta = await getAudioMetadata(file);
    assert.equal(meta.year, 2021);
    assert.equal(String(meta.date).slice(0, 4), "2021");
  });

  test(`${label}: cover art can be set then removed`, { skip: !hasFfmpeg }, async () => {
    const file = makeFixture(`art.${ext}`, codec);
    let res = await writeAudioTags(file, { title: "x", imageData: PNG, imageMime: "image/png" });
    assert.equal(res.written, true, res.reason);
    assert.ok((await getAudioMetadata(file)).picture, "cover present");
    assert.ok(decodes(file));
    res = await writeAudioTags(file, { removeImage: true });
    assert.equal(res.written, true, res.reason);
    assert.equal((await getAudioMetadata(file)).picture, null);
    assert.equal((await getAudioMetadata(file)).title, "x");
  });

  test(`${label}: bad numbers are rejected before the file is touched`, { skip: !hasFfmpeg }, async () => {
    const file = makeFixture(`bad.${ext}`, codec);
    const before = fs.readFileSync(file);
    for (const bad of [{ bpm: "fast" }, { trackNum: -1 }, { date: "2019-13-45" }, { year: 20.5 }]) {
      const res = await writeAudioTags(file, bad);
      assert.equal(res.written, false);
      assert.match(res.reason, /must/);
    }
    assert.deepEqual(fs.readFileSync(file), before);
  });
}

test("OGG: writes at the stream level, so edits actually stick", { skip: !hasFfmpeg }, async () => {
  const file = makeFixture("full.ogg", ["-c:a", "libvorbis"], ["-metadata", "genre=Old"]);
  const res = await writeAudioTags(file, FULL);
  assert.equal(res.written, true, res.reason);
  assertFields(await getAudioMetadata(file), FULL);
  assert.ok(decodes(file));
});

test("WAV: unsupported fields are reported, supported ones are written", { skip: !hasFfmpeg }, async () => {
  const file = makeFixture("full.wav", ["-c:a", "pcm_s16le"]);
  const res = await writeAudioTags(file, { title: "W", genre: ["Pop"], bpm: 120, label: "L", imageData: PNG, imageMime: "image/png" });
  assert.equal(res.written, true, res.reason);
  assert.ok(res.skipped.includes("BPM"));
  assert.ok(res.skipped.some((s) => /label/.test(s)));
  assert.equal(res.imageIgnored, true);
  const meta = await getAudioMetadata(file);
  assert.equal(meta.title, "W");
  assert.deepEqual(meta.genre, ["Pop"]);
});

test("a failed write leaves the original byte-for-byte intact", { skip: !hasFfmpeg }, async () => {
  const file = makeFixture("corrupt.m4a", ["-c:a", "aac"]);
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, bytes.subarray(0, 40)); // truncated: no moov atom
  const before = fs.readFileSync(file);
  const res = await writeAudioTags(file, { title: "x" });
  assert.equal(res.written, false);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(leftovers(file), []);
});

test("unknown extension and missing path give a clear reason", async () => {
  assert.equal((await writeAudioTags("", { title: "x" })).written, false);
  const file = path.join(tmpRoot, "x.aac");
  fs.writeFileSync(file, "x");
  const res = await writeAudioTags(file, { title: "x" });
  assert.equal(res.written, false);
  assert.match(res.reason, /AAC|aac/);
});

// ---- frames node-id3 doesn't understand must survive an edit ---------------

function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}
function v24Frame(id, payload) {
  return Buffer.concat([Buffer.from(id, "latin1"), syncsafe(payload.length), Buffer.alloc(2), payload]);
}
const utf8Text = (...parts) => Buffer.concat([Buffer.from([3]), Buffer.from(parts.join("\u0000"), "utf8")]);

function makeV24TaggedMp3(name) {
  const plain = makeFixture(name, ["-c:a", "libmp3lame"]);
  const audio = fs.readFileSync(plain);
  const frames = Buffer.concat([
    v24Frame("TIT2", utf8Text("Orig Title")),
    v24Frame("TPUB", utf8Text("Orig Label")),
    v24Frame("TSO2", utf8Text("Sort, Album Artist")), // iTunes album-artist sort
    v24Frame("TSOC", utf8Text("Sort, Composer")),
    v24Frame("TIPL", utf8Text("producer", "Some Producer")), // paired credits
  ]);
  const tag = Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([4, 0, 0]), syncsafe(frames.length), frames]);
  fs.writeFileSync(plain, Buffer.concat([tag, audio]));
  return plain;
}

async function nativeIds(file) {
  const mm = await import("music-metadata");
  const parsed = await mm.parseFile(file);
  return Object.values(parsed.native).flat();
}

test("MP3: frames node-id3 can't round-trip (TSO2, TSOC, TIPL) survive an edit", { skip: !hasFfmpeg }, async () => {
  const file = makeV24TaggedMp3("unknown-frames.mp3");
  const res = await writeAudioTags(file, { title: "New Title", genre: ["Pop"] });
  assert.equal(res.written, true, res.reason);
  const tags = await nativeIds(file);
  const byId = (id) => tags.find((t) => t.id === id);
  assert.equal(byId("TIT2").value, "New Title");
  assert.equal(byId("TSO2").value, "Sort, Album Artist");
  assert.equal(byId("TSOC").value, "Sort, Composer");
  assert.ok(byId("TIPL"), "credits list kept");
  assert.equal(byId("TPUB").value, "Orig Label", "a frame we weren't asked to touch is untouched");
  assert.ok(decodes(file));
});

test("MP3: a cleared field stays cleared and doesn't hide behind the preserved frames", { skip: !hasFfmpeg }, async () => {
  const file = makeV24TaggedMp3("unknown-clear.mp3");
  const res = await writeAudioTags(file, { label: "" });
  assert.equal(res.written, true, res.reason);
  const tags = await nativeIds(file);
  assert.equal(tags.find((t) => t.id === "TPUB"), undefined, "label cleared");
  assert.ok(tags.find((t) => t.id === "TSO2"), "unrelated frame kept");
});

test("a read-only file is refused, not silently replaced", { skip: !hasFfmpeg || process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const file = makeFixture("readonly.mp3", ["-c:a", "libmp3lame"]);
  fs.chmodSync(file, 0o444);
  const before = fs.readFileSync(file);
  const res = await writeAudioTags(file, { title: "x" });
  assert.equal(res.written, false);
  assert.match(res.reason, /read-only/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(leftovers(file), []);
  fs.chmodSync(file, 0o644);
});

test("file permissions survive the swap", { skip: !hasFfmpeg || process.platform === "win32" }, async () => {
  const file = makeFixture("perms.flac", ["-c:a", "flac"]);
  fs.chmodSync(file, 0o640);
  const res = await writeAudioTags(file, { title: "x" });
  assert.equal(res.written, true, res.reason);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});
