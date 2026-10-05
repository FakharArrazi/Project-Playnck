const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../script/player-bg-styles.js");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const PALETTE = { a1: [88, 101, 242], a2: [138, 92, 246], light: false };
const SIZES = {
  narrow: [320, 900],
  wide: [1400, 520],
  tall: [480, 1600],
  small: [120, 90],
};

function recordingContext() {
  const calls = [];
  const gradient = { addColorStop: (...a) => calls.push(["stop", ...a]) };
  const ctx = new Proxy(
    {},
    {
      get(_, name) {
        if (name === "calls") return calls;
        if (name === "createRadialGradient" || name === "createLinearGradient") {
          return (...args) => {
            calls.push([name, ...args]);
            return gradient;
          };
        }
        return (...args) => calls.push([name, ...args]);
      },
      set(_, name, value) {
        calls.push(["set", name, String(value)]);
        return true;
      },
    },
  );
  return ctx;
}

test("exposes the four styles", async () => {
  const { STYLE_KEYS } = await load();
  assert.deepEqual(STYLE_KEYS, ["organic", "flow", "nested", "waves"]);
});

test("unknown styles and empty boxes build nothing", async () => {
  const { buildStyle } = await load();
  assert.equal(buildStyle("nope", 300, 300), null);
  assert.equal(buildStyle("organic", 0, 300), null);
  assert.equal(buildStyle("organic", 300, 0), null);
  assert.equal(buildStyle("organic", NaN, 300), null);
});

test("every style draws finite geometry at every panel shape", async () => {
  const { STYLE_KEYS, buildStyle } = await load();
  for (const key of STYLE_KEYS) {
    for (const [label, [w, h]] of Object.entries(SIZES)) {
      const draw = buildStyle(key, w, h);
      assert.equal(typeof draw, "function", `${key} ${label}`);
      for (const t of [0, 7.5, 24, 3600]) {
        const ctx = recordingContext();
        draw(ctx, t, PALETTE);
        assert.ok(ctx.calls.length > 10, `${key} ${label} drew nothing`);
        for (const call of ctx.calls) {
          for (const arg of call.slice(1)) {
            if (typeof arg === "number") {
              assert.ok(Number.isFinite(arg), `${key} ${label} ${call[0]}`);
            }
          }
        }
      }
    }
  }
});

test("a layout is deterministic and follows the panel size", async () => {
  const { STYLE_KEYS, buildStyle } = await load();
  const log = (key, w, h) => {
    const ctx = recordingContext();
    buildStyle(key, w, h)(ctx, 10, PALETTE);
    return JSON.stringify(ctx.calls);
  };
  for (const key of STYLE_KEYS) {
    assert.equal(log(key, 400, 700), log(key, 400, 700), key);
    assert.notEqual(log(key, 400, 700), log(key, 900, 500), key);
  }
});

test("light themes get their own strength", async () => {
  const { STYLE_KEYS, buildStyle } = await load();
  const log = (key, palette) => {
    const ctx = recordingContext();
    buildStyle(key, 400, 600)(ctx, 5, palette);
    return JSON.stringify(ctx.calls);
  };
  for (const key of ["organic", "flow", "nested"]) {
    assert.notEqual(log(key, PALETTE), log(key, { ...PALETTE, light: true }), key);
  }
  assert.ok(STYLE_KEYS.every((key) => buildStyle(key, 400, 600)));
});

test("the canvas lives inside the player panel's existing background layer", () => {
  const html = read("index.html");
  assert.equal(html.split('id="playerBgCanvas"').length - 1, 1);
  const panel = html.indexOf('id="playerPanel"');
  const layer = html.indexOf('id="playerBg"');
  const canvas = html.indexOf('id="playerBgCanvas"');
  const layerEnd = html.indexOf("</div>", canvas);
  const panelEnd = html.indexOf("</main>", panel);
  assert.ok(panel !== -1 && panel < layer && layer < canvas);
  assert.ok(canvas < layerEnd && layerEnd < panelEnd);
});

test("the procedural layer never escapes the panel", () => {
  const css = read("css/player.css");
  const rule = css.slice(
    css.indexOf(".player-bg-canvas {"),
    css.indexOf("}", css.indexOf(".player-bg-canvas {")),
  );
  assert.ok(rule.includes("position: absolute"));
  assert.ok(!/position:\s*fixed/.test(rule));
  const controller = read("script/player-bg-procedural.js");
  assert.ok(!controller.includes("document.body"));
  assert.ok(!controller.includes('createElement("canvas")'));
  assert.ok(controller.includes('$("playerBgCanvas")'));
});
