const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../script/shortcuts.js");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// The keydown logic exactly as it was in script/bindings.js before shortcuts
// moved into script/shortcuts.js. The registry must resolve every key press to
// the same action this did.
function legacyAction(e) {
  if ((e.code === "Space" || e.key === " ") && !e.repeat) return "playPause";
  if (e.code === "KeyM" && !e.repeat) return "mute";
  if (e.code === "KeyR" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey)
    return e.shiftKey ? "repeatExtraReset" : "repeatExtra";
  if (e.code === "ArrowUp") return "volumeUp";
  if (e.code === "ArrowDown") return "volumeDown";
  if (e.code === "ArrowRight")
    return e.ctrlKey || e.metaKey ? "nextTrack" : "seekForward";
  if (e.code === "ArrowLeft")
    return e.ctrlKey || e.metaKey ? "prevTrack" : "seekBack";
  return null;
}

const KEYS = [
  { code: "Space", key: " " },
  { code: "KeyM", key: "m" },
  { code: "KeyR", key: "r" },
  { code: "ArrowUp", key: "ArrowUp" },
  { code: "ArrowDown", key: "ArrowDown" },
  { code: "ArrowLeft", key: "ArrowLeft" },
  { code: "ArrowRight", key: "ArrowRight" },
  { code: "KeyA", key: "a" },
  { code: "Enter", key: "Enter" },
  { code: "Escape", key: "Escape" },
];

function* allEvents() {
  for (const { code, key } of KEYS)
    for (const ctrlKey of [false, true])
      for (const metaKey of [false, true])
        for (const shiftKey of [false, true])
          for (const altKey of [false, true])
            for (const repeat of [false, true])
              yield { code, key, ctrlKey, metaKey, shiftKey, altKey, repeat };
}

test("registry resolves every key press the same way the old handler did", async () => {
  const { findShortcutForEvent } = await load();
  let checked = 0;
  for (const e of allEvents()) {
    const found = findShortcutForEvent(e);
    assert.equal(
      found ? found.id : null,
      legacyAction(e),
      `mismatch for ${JSON.stringify(e)}`,
    );
    checked++;
  }
  // 4 modifiers × repeat = 32 states per key, so a skipped loop can't pass.
  assert.equal(checked, KEYS.length * 32);
});

test("step sizes keep their original values", async () => {
  const { SEEK_STEP_SECONDS, VOLUME_STEP } = await load();
  assert.equal(SEEK_STEP_SECONDS, 5);
  assert.equal(VOLUME_STEP, 0.05);
});

test("no key press triggers more than one shortcut", async () => {
  const { SHORTCUTS, matchesCombo } = await load();
  for (const e of allEvents()) {
    const hits = SHORTCUTS.filter((s) => s.combo && matchesCombo(s.combo, e));
    assert.ok(hits.length <= 1, `overlap for ${JSON.stringify(e)}`);
  }
});

test("shortcut ids are unique and every shortcut has keys to show", async () => {
  const { SHORTCUTS, SHORTCUT_GROUPS } = await load();
  const ids = SHORTCUTS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const groupIds = new Set(SHORTCUT_GROUPS.map((g) => g.id));
  for (const s of SHORTCUTS) {
    assert.ok(groupIds.has(s.group), `${s.id} has unknown group ${s.group}`);
    assert.ok(s.combo || s.tokens, `${s.id} has neither combo nor tokens`);
  }
});

test("every keyboard shortcut has an action in bindings.js, and vice versa", async () => {
  const { SHORTCUTS } = await load();
  const src = read("script/bindings.js");
  const block = /const SHORTCUT_ACTIONS = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block, "SHORTCUT_ACTIONS not found in bindings.js");
  const actionIds = [...block[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  const comboIds = SHORTCUTS.filter((s) => s.combo).map((s) => s.id);
  assert.deepEqual([...actionIds].sort(), [...comboIds].sort());
});

test("every label the Settings panel shows exists in English and French", async () => {
  const { SHORTCUTS, SHORTCUT_GROUPS, shortcutTokens } = await load();
  const src = read("script/i18n.js");
  // "fr: {" also appears in the LANGUAGES list; the dictionary's opens a block.
  const frStart = src.indexOf("\n  fr: {\n");
  assert.ok(frStart > 0, "French dictionary not found");
  const dicts = { en: src.slice(0, frStart), fr: src.slice(frStart) };

  const keys = new Set([
    "settings.shortcuts",
    "shortcuts.note",
    ...SHORTCUT_GROUPS.map((g) => g.labelKey),
    ...SHORTCUTS.map((s) => s.descKey),
  ]);
  for (const s of SHORTCUTS)
    for (const t of shortcutTokens(s, { isMac: false }).concat(
      shortcutTokens(s, { isMac: true }),
    ))
      if (t.i18n) keys.add(t.i18n);

  for (const [lang, text] of Object.entries(dicts))
    for (const key of keys)
      assert.ok(text.includes(`"${key}":`), `${lang} is missing "${key}"`);
});

test("key caps read as the shortcut is pressed", async () => {
  const { SHORTCUTS, shortcutTokens } = await load();
  const label = (id, opts) => {
    const s = SHORTCUTS.find((x) => x.id === id);
    return shortcutTokens(s, opts)
      .map((t) => t.text || t.i18n)
      .join("+");
  };
  assert.equal(label("playPause"), "shortcuts.key.space");
  assert.equal(label("mute"), "M");
  assert.equal(label("repeatExtra"), "R");
  assert.equal(label("repeatExtraReset"), "shortcuts.key.shift+R");
  assert.equal(label("volumeUp"), "↑");
  assert.equal(label("volumeDown"), "↓");
  assert.equal(label("seekBack"), "←");
  assert.equal(label("seekForward"), "→");
  assert.equal(label("prevTrack", { isMac: false }), "Ctrl+←");
  assert.equal(label("nextTrack", { isMac: false }), "Ctrl+→");
  assert.equal(label("nextTrack", { isMac: true }), "⌘+→");
});

test("shortcutsByGroup keeps display order and drops empty groups", async () => {
  const { shortcutsByGroup, SHORTCUTS } = await load();
  const groups = shortcutsByGroup();
  assert.deepEqual(
    groups.map((g) => g.group.id),
    ["playback", "navigation", "volume", "media"],
  );
  assert.equal(
    groups.reduce((n, g) => n + g.items.length, 0),
    SHORTCUTS.length,
  );
});
