import { state, $, idbPut } from "./state.js";

const THEME_BG = {
  dark: {
    label: "GitHub Black",
    swatch: "#0c0c11",
    vars: {
      "--bg": "#0c0c11",
      "--panel": "#131319",
      "--elevated": "#1c1c25",
      "--elevated-hover": "#24242f",
      "--border": "#232330",
      "--text": "#f2f2f6",
      "--text-dim": "#96969f",
      "--text-faint": "#5c5c66",
    },
  },
  light: {
    label: "Light",
    swatch: "#f2efe9",
    vars: {
      "--bg": "#f2efe9",
      "--panel": "#fbfaf7",
      "--elevated": "#ece8e0",
      "--elevated-hover": "#e2ddd2",
      "--border": "#dcd6c9",
      "--text": "#211f1c",
      "--text-dim": "#6e6a62",
      "--text-faint": "#a09a8d",
    },
  },
  pitchblack: {
    label: "Pitch Black",
    swatch: "#000000",
    vars: {
      "--bg": "#000000",
      "--panel": "#000000",
      "--elevated": "#141414",
      "--elevated-hover": "#1e1e1e",
      "--border": "#242424",
      "--text": "#f2f2f6",
      "--text-dim": "#96969f",
      "--text-faint": "#5c5c66",
    },
  },
  midnight: {
    label: "Deep Midnight Blue",
    swatch: "#0b1324",
    vars: {
      "--bg": "#0b1324",
      "--panel": "#0e192d",
      "--elevated": "#15233b",
      "--elevated-hover": "#1b2c48",
      "--border": "#223653",
      "--text": "#edf4ff",
      "--text-dim": "#a4b2c8",
      "--text-faint": "#677892",
    },
  },
  graphite: {
    label: "Graphite Gray",
    swatch: "#1b1d20",
    vars: {
      "--bg": "#1b1d20",
      "--panel": "#202226",
      "--elevated": "#292c31",
      "--elevated-hover": "#34383e",
      "--border": "#3b3f46",
      "--text": "#f1f2f4",
      "--text-dim": "#afb2b8",
      "--text-faint": "#777b83",
    },
  },
  forest: {
    label: "Forest Green",
    swatch: "#10231d",
    vars: {
      "--bg": "#10231d",
      "--panel": "#142b23",
      "--elevated": "#1b382d",
      "--elevated-hover": "#244737",
      "--border": "#305343",
      "--text": "#edf7f0",
      "--text-dim": "#a7c0b0",
      "--text-faint": "#6f8d7c",
    },
  },
  burgundy: {
    label: "Burgundy Wine",
    swatch: "#190b0e",
    vars: {
      "--bg": "#190b0e",
      "--panel": "#210f14",
      "--elevated": "#30151c",
      "--elevated-hover": "#3f1c25",
      "--border": "#4b252f",
      "--text": "#f9f1f3",
      "--text-dim": "#c9a6af",
      "--text-faint": "#90646f",
    },
  },
  plum: {
    label: "Plum Violet",
    swatch: "#150c17",
    vars: {
      "--bg": "#150c17",
      "--panel": "#1c111f",
      "--elevated": "#28182d",
      "--elevated-hover": "#35203c",
      "--border": "#402947",
      "--text": "#f6f2f8",
      "--text-dim": "#c1a6c9",
      "--text-faint": "#856490",
    },
  },
  espresso: {
    label: "Espresso Brown",
    swatch: "#17110c",
    vars: {
      "--bg": "#17110c",
      "--panel": "#1f1711",
      "--elevated": "#2d2118",
      "--elevated-hover": "#3c2c20",
      "--border": "#473629",
      "--text": "#f8f4f2",
      "--text-dim": "#c9b5a6",
      "--text-faint": "#907764",
    },
  },
  ocean: {
    label: "Deep Ocean Teal",
    swatch: "#07191d",
    vars: {
      "--bg": "#07191d",
      "--panel": "#0a2227",
      "--elevated": "#0e3037",
      "--elevated-hover": "#124049",
      "--border": "#1a4c56",
      "--text": "#eff9fb",
      "--text-dim": "#a6c3c9",
      "--text-faint": "#648990",
    },
  },
  twilight: {
    label: "Twilight Indigo",
    swatch: "#0e0a1a",
    vars: {
      "--bg": "#0e0a1a",
      "--panel": "#130d23",
      "--elevated": "#1b1332",
      "--elevated-hover": "#241943",
      "--border": "#2d214f",
      "--text": "#f3f0f9",
      "--text-dim": "#afa6c9",
      "--text-faint": "#6f6490",
    },
  },
  cloud: {
    label: "Cool Cloud",
    swatch: "#eef2f7",
    onLight: true,
    vars: {
      "--bg": "#eef2f7",
      "--panel": "#f9fbfd",
      "--elevated": "#e3e9f1",
      "--elevated-hover": "#d8e0eb",
      "--border": "#cfd8e4",
      "--text": "#1a2029",
      "--text-dim": "#566272",
      "--text-faint": "#8e9aab",
    },
  },
};

const THEME_ACCENT = {
  blue: { label: "Blue", a1: "#5865f2", a2: "#8a5cf6", rgb: "88,101,242" },
  red: { label: "Red", a1: "#ef4444", a2: "#f87171", rgb: "239,68,68" },
  orange: { label: "Orange", a1: "#f97316", a2: "#fb923c", rgb: "249,115,22" },
  green: { label: "Green", a1: "#22c55e", a2: "#4ade80", rgb: "34,197,94" },
  purple: { label: "Purple", a1: "#a855f7", a2: "#c084fc", rgb: "168,85,247" },
  yellow: { label: "Yellow", a1: "#eab308", a2: "#facc15", rgb: "234,179,8" },
  pink: { label: "Pink", a1: "#ec4899", a2: "#f472b6", rgb: "236,72,153" },
  teal: { label: "Teal", a1: "#14b8a6", a2: "#2dd4bf", rgb: "20,184,166" },
  indigo: { label: "Indigo", a1: "#6366f1", a2: "#818cf8", rgb: "99,102,241" },
  cyan: { label: "Cyan", a1: "#06b6d4", a2: "#22d3ee", rgb: "6,182,212" },
  lime: { label: "Lime", a1: "#84cc16", a2: "#a3e635", rgb: "132,204,22" },
  rose: { label: "Rose", a1: "#f43f5e", a2: "#fb7185", rgb: "244,63,94" },
  sky: { label: "Sky", a1: "#0a8fd8", a2: "#38b6f5", rgb: "10,143,216" },
  fuchsia: { label: "Fuchsia", a1: "#d03fe6", a2: "#e879f9", rgb: "208,63,230" },
  emerald: { label: "Emerald", a1: "#0a9a6e", a2: "#2fd3a0", rgb: "10,154,110" },
  slate: { label: "Slate", a1: "#68788f", a2: "#94a3b8", rgb: "104,120,143" },
  copper: { label: "Copper", a1: "#c2703d", a2: "#e19a6a", rgb: "194,112,61" },
  olive: { label: "Olive", a1: "#8a9a1a", a2: "#b4c43a", rgb: "138,154,26" },
};

function applyTheme() {
  const bg = THEME_BG[state.theme.bg] || THEME_BG.pitchblack;
  const ac = THEME_ACCENT[state.theme.accent] || THEME_ACCENT.blue;
  const root = document.documentElement.style;
  Object.entries(bg.vars).forEach(([k, v]) => root.setProperty(k, v));
  root.setProperty("--accent1", ac.a1);
  root.setProperty("--accent2", ac.a2);
  root.setProperty("--accent1-rgb", ac.rgb);
  syncNativeTitleBar(bg.vars["--bg"]);
}

function syncNativeTitleBar(backgroundColor) {
  if (!(window.electronAPI && window.electronAPI.setTitleBarAppearance)) return;
  const hex = String(backgroundColor || "").replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  window.electronAPI
    .setTitleBarAppearance(
      "#" + normalized,
      luminance > 160 ? "#1b1b1b" : "#f2f2f6",
    )
    .catch(() => {});
}

function setThemeBg(name) {
  state.theme.bg = name;
  applyTheme();
  renderThemeSwatches();
  saveTheme();
}
function setThemeAccent(name) {
  state.theme.accent = name;
  applyTheme();
  renderThemeSwatches();
  saveTheme();
}

function saveTheme() {
  idbPut("settings", { key: "theme", value: state.theme });
  cacheThemeForNextBoot();
}

function cacheThemeForNextBoot() {
  try {
    localStorage.setItem(
      "playnck-theme-cache",
      JSON.stringify({ bg: state.theme.bg, accent: state.theme.accent }),
    );
  } catch {}
}
function renderThemeSwatches() {
  const bgRow = $("bgSwatchRow"),
    accentRow = $("accentSwatchRow");
  if (!bgRow || !accentRow) return;
  bgRow
    .querySelectorAll(".swatch-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.bg === state.theme.bg),
    );
  accentRow
    .querySelectorAll(".swatch-btn")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.accent === state.theme.accent),
    );
}

export {
  THEME_BG,
  THEME_ACCENT,
  applyTheme,
  setThemeBg,
  setThemeAccent,
  cacheThemeForNextBoot,
};
