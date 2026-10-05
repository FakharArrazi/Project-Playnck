import { $ } from "./state.js";
import { STYLE_KEYS, buildStyle } from "./player-bg-styles.js";

const FRAME_INTERVAL = 1000 / 30;
const STATIC_TIME = 24;
const MAX_DPR = 2;

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let activeStyle = null;
let canvas = null;
let host = null;
let ctx = null;
let draw = null;
let palette = null;
let width = 0;
let height = 0;
let dpr = 1;
let rafHandle = null;
let lastFrame = 0;
let origin = 0;
let onScreen = true;
let resizeObserver = null;
let intersectionObserver = null;
let themeObserver = null;

function parseHex(value, fallback) {
  const hex = String(value || "")
    .trim()
    .replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const bg = parseHex(cs.getPropertyValue("--bg"), [0, 0, 0]);
  return {
    a1: parseHex(cs.getPropertyValue("--accent1"), [88, 101, 242]),
    a2: parseHex(cs.getPropertyValue("--accent2"), [138, 92, 246]),
    light: (bg[0] * 299 + bg[1] * 587 + bg[2] * 114) / 1000 > 160,
  };
}

function canAnimate() {
  return (
    !!activeStyle &&
    !!draw &&
    onScreen &&
    !document.hidden &&
    !motionQuery.matches
  );
}

function render(t) {
  if (!draw || !ctx || width <= 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  draw(ctx, t, palette);
}

function renderNow() {
  render(
    canAnimate() ? (performance.now() - origin) / 1000 : STATIC_TIME,
  );
}

function tick(now) {
  rafHandle = null;
  if (!canAnimate()) return;
  rafHandle = requestAnimationFrame(tick);
  if (now - lastFrame < FRAME_INTERVAL) return;
  lastFrame = now;
  render((now - origin) / 1000);
}

function syncLoop() {
  if (canAnimate()) {
    if (rafHandle === null) {
      lastFrame = 0;
      rafHandle = requestAnimationFrame(tick);
    }
  } else if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function fitCanvas() {
  if (!canvas || !host || !activeStyle) return;
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (w <= 0 || h <= 0) {
    width = 0;
    height = 0;
    draw = null;
    return;
  }
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  if (draw && w === width && h === height && ratio === dpr) return;
  width = w;
  height = h;
  dpr = ratio;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx = canvas.getContext("2d");
  draw = buildStyle(activeStyle, w, h);
  renderNow();
}

function onHostChange() {
  fitCanvas();
  syncLoop();
}

function startObservers() {
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(onHostChange);
    resizeObserver.observe(host);
  }
  if (!intersectionObserver) {
    intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      syncLoop();
    });
    intersectionObserver.observe(host);
  }
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      palette = readPalette();
      if (rafHandle === null) renderNow();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
}

function stopObservers() {
  if (resizeObserver) resizeObserver.disconnect();
  if (intersectionObserver) intersectionObserver.disconnect();
  if (themeObserver) themeObserver.disconnect();
  resizeObserver = null;
  intersectionObserver = null;
  themeObserver = null;
}

function setProceduralBackground(style) {
  const next = STYLE_KEYS.includes(style) ? style : null;
  if (!canvas) {
    canvas = $("playerBgCanvas");
    host = canvas ? canvas.parentElement : null;
  }
  if (!canvas || !host || next === activeStyle) return;
  activeStyle = next;
  if (!next) {
    syncLoop();
    stopObservers();
    draw = null;
    width = 0;
    height = 0;
    canvas.width = 0;
    canvas.height = 0;
    return;
  }
  palette = readPalette();
  origin = performance.now();
  draw = null;
  startObservers();
  fitCanvas();
  syncLoop();
}

window.addEventListener("resize", onHostChange);
document.addEventListener("visibilitychange", syncLoop);
motionQuery.addEventListener("change", () => {
  syncLoop();
  if (activeStyle && rafHandle === null) renderNow();
});

export { STYLE_KEYS as PLAYER_BG_STYLE_KEYS, setProceduralBackground };
