// Single source of truth for Playnck's keyboard shortcuts.
//
// script/bindings.js dispatches key presses from this list and the Settings →
// Keyboard Shortcuts panel renders it, so the documented shortcuts can never
// drift from the ones that actually work. To add a shortcut, add an entry here
// and a matching action in SHORTCUT_ACTIONS (bindings.js).
//
// This file has no imports and touches no DOM so it can be unit-tested in Node.

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;

const SHORTCUT_GROUPS = [
  { id: "playback", labelKey: "shortcuts.group.playback" },
  { id: "navigation", labelKey: "shortcuts.group.navigation" },
  { id: "volume", labelKey: "shortcuts.group.volume" },
  { id: "media", labelKey: "shortcuts.group.media" },
];

// A `combo` describes the key press that triggers a shortcut:
//   code    KeyboardEvent.code to match
//   key     optional KeyboardEvent.key alias (e.g. " " for Space)
//   repeat  false = ignore OS auto-repeat while the key is held
//   cmd     Ctrl or ⌘:  true = required, false = must not be held,
//           undefined = don't care
//   shift / alt  same tri-state as cmd
//
// Entries with `tokens` instead of a `combo` are hardware media keys. The OS
// delivers those through the Media Session API (see renderer-bridge.js), not
// through keydown, so they are listed here for display only.
const SHORTCUTS = [
  {
    id: "playPause",
    group: "playback",
    descKey: "shortcuts.playPause",
    combo: { code: "Space", key: " ", repeat: false },
  },
  {
    id: "seekBack",
    group: "playback",
    descKey: "shortcuts.seekBack",
    descVars: { seconds: SEEK_STEP_SECONDS },
    combo: { code: "ArrowLeft", cmd: false },
  },
  {
    id: "seekForward",
    group: "playback",
    descKey: "shortcuts.seekForward",
    descVars: { seconds: SEEK_STEP_SECONDS },
    combo: { code: "ArrowRight", cmd: false },
  },
  {
    id: "repeatExtra",
    group: "playback",
    descKey: "shortcuts.repeatExtra",
    combo: {
      code: "KeyR",
      repeat: false,
      cmd: false,
      alt: false,
      shift: false,
    },
  },
  {
    id: "repeatExtraReset",
    group: "playback",
    descKey: "shortcuts.repeatExtraReset",
    combo: { code: "KeyR", repeat: false, cmd: false, alt: false, shift: true },
  },

  {
    id: "prevTrack",
    group: "navigation",
    descKey: "shortcuts.prevTrack",
    combo: { code: "ArrowLeft", cmd: true },
  },
  {
    id: "nextTrack",
    group: "navigation",
    descKey: "shortcuts.nextTrack",
    combo: { code: "ArrowRight", cmd: true },
  },

  {
    id: "volumeUp",
    group: "volume",
    descKey: "shortcuts.volumeUp",
    descVars: { percent: Math.round(VOLUME_STEP * 100) },
    combo: { code: "ArrowUp" },
  },
  {
    id: "volumeDown",
    group: "volume",
    descKey: "shortcuts.volumeDown",
    descVars: { percent: Math.round(VOLUME_STEP * 100) },
    combo: { code: "ArrowDown" },
  },
  {
    id: "mute",
    group: "volume",
    descKey: "shortcuts.mute",
    combo: { code: "KeyM", repeat: false },
  },

  {
    id: "mediaPlayPause",
    group: "media",
    descKey: "shortcuts.playPause",
    tokens: [{ i18n: "shortcuts.key.mediaPlayPause" }],
  },
  {
    id: "mediaPrev",
    group: "media",
    descKey: "shortcuts.prevTrack",
    tokens: [{ i18n: "shortcuts.key.mediaPrev" }],
  },
  {
    id: "mediaNext",
    group: "media",
    descKey: "shortcuts.nextTrack",
    tokens: [{ i18n: "shortcuts.key.mediaNext" }],
  },
];

function matchesCombo(combo, e) {
  if (!(
    e.code === combo.code ||
    (combo.key !== undefined && e.key === combo.key)
  ))
    return false;
  if (combo.repeat === false && e.repeat) return false;
  if (combo.cmd !== undefined && Boolean(e.ctrlKey || e.metaKey) !== combo.cmd)
    return false;
  if (combo.shift !== undefined && Boolean(e.shiftKey) !== combo.shift)
    return false;
  if (combo.alt !== undefined && Boolean(e.altKey) !== combo.alt) return false;
  return true;
}

function findShortcutForEvent(e) {
  return SHORTCUTS.find((s) => s.combo && matchesCombo(s.combo, e)) || null;
}

const KEY_GLYPHS = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

function keyToken(code) {
  if (code === "Space") return { i18n: "shortcuts.key.space" };
  if (KEY_GLYPHS[code]) return { text: KEY_GLYPHS[code], glyph: true };
  const letter = /^Key([A-Z])$/.exec(code);
  return { text: letter ? letter[1] : code };
}

// Key caps for display, in press order. A token is either { text } (shown
// as-is; `glyph: true` marks arrow symbols) or { i18n } (a translation key,
// e.g. "Space" → "Espace").
function shortcutTokens(shortcut, { isMac = false } = {}) {
  if (shortcut.tokens) return shortcut.tokens;
  const { combo } = shortcut;
  const tokens = [];
  if (combo.cmd) tokens.push({ text: isMac ? "⌘" : "Ctrl" });
  if (combo.alt) tokens.push({ text: isMac ? "⌥" : "Alt" });
  if (combo.shift) tokens.push({ i18n: "shortcuts.key.shift" });
  tokens.push(keyToken(combo.code));
  return tokens;
}

// [{ group, items }] in display order, skipping empty groups.
function shortcutsByGroup() {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    items: SHORTCUTS.filter((s) => s.group === group.id),
  })).filter((g) => g.items.length > 0);
}

export {
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  matchesCombo,
  findShortcutForEvent,
  shortcutTokens,
  shortcutsByGroup,
};
