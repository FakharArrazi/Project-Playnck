// DOM-free drawing code for the procedural now-playing backgrounds.
// buildStyle(key, w, h) lays a style out for a w x h box (CSS pixels) and
// returns draw(ctx, t, palette). Everything is derived from w and h, so the
// composition follows whatever size the player panel currently has.

const STYLE_KEYS = ["organic", "flow", "nested", "waves"];

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rgba(color, alpha) {
  return `rgba(${color[0]},${color[1]},${color[2]},${clamp(alpha, 0, 1).toFixed(3)})`;
}

function mixRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function strength(palette, dark, light) {
  return palette.light ? light : dark;
}

function tone(palette, index) {
  const i = ((index % 3) + 3) % 3;
  if (i === 0) return palette.a1;
  if (i === 1) return palette.a2;
  return mixRgb(palette.a1, palette.a2, 0.5);
}

function buildOrganic(w, h) {
  const rand = rng(11);
  const reach = Math.max(w, h);
  const blobs = Array.from({ length: 6 }, (_, i) => ({
    x: w * (0.1 + rand() * 0.8),
    y: h * (0.1 + rand() * 0.8),
    radius: reach * (0.22 + rand() * 0.18),
    lobes: 3 + Math.floor(rand() * 3),
    wobble: 0.1 + rand() * 0.1,
    speed: 0.06 + rand() * 0.05,
    phase: rand() * TAU,
    driftX: w * (0.06 + rand() * 0.1),
    driftY: h * (0.06 + rand() * 0.1),
    tone: i,
    alpha: 0.18 + rand() * 0.1,
  }));
  const contours = 6;
  const steps = 56;
  return (ctx, t, palette) => {
    const gain = strength(palette, 1, 0.65);
    for (const b of blobs) {
      const cx = b.x + Math.sin(t * b.speed + b.phase) * b.driftX;
      const cy = b.y + Math.cos(t * b.speed * 0.8 + b.phase) * b.driftY;
      ctx.fillStyle = rgba(tone(palette, b.tone), b.alpha * 0.2 * gain);
      for (let k = 0; k < contours; k++) {
        const scale = 1 - k * 0.15;
        const shift = k * 0.45;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * TAU;
          const rad =
            b.radius *
            scale *
            (1 +
              b.wobble *
                Math.sin(a * b.lobes + t * b.speed * 2 + b.phase + shift));
          const x = cx + Math.cos(a) * rad;
          const y = cy + Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  };
}

function buildFlow(w, h) {
  const rand = rng(23);
  const diag = Math.hypot(w, h);
  const count = clamp(Math.round(diag / 34), 12, 30);
  const threads = Array.from({ length: count }, (_, i) => ({
    offset: (i / (count - 1) - 0.5) * diag,
    phase: i * 0.21 + rand() * 0.4,
    amp: diag * (0.04 + rand() * 0.035),
    mix: i / (count - 1),
    alpha: 0.16 + rand() * 0.2,
    width: 1.1 + rand() * 1.2,
  }));
  const angle = -0.38;
  const k0 = TAU / (diag * 1.3);
  const k1 = TAU / (diag * 0.55);
  const k2 = TAU / (diag * 0.23);
  const step = Math.max(8, diag / 90);
  const half = diag / 2;
  return (ctx, t, palette) => {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const gain = strength(palette, 1, 1.6);
    for (const th of threads) {
      ctx.strokeStyle = rgba(
        mixRgb(palette.a1, palette.a2, th.mix),
        th.alpha * gain,
      );
      ctx.lineWidth = th.width;
      ctx.beginPath();
      let first = true;
      for (let x = -half; x <= half + step; x += step) {
        const env = 0.55 + 0.45 * Math.sin(x * k0 + 1.3 + t * 0.05);
        const y =
          th.offset +
          th.amp * env * Math.sin(x * k1 + t * 0.35 + th.phase) +
          th.amp * 0.35 * Math.sin(x * k2 - t * 0.25 + th.phase * 1.7);
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  };
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function buildNested(w, h) {
  const ox = w * 0.3;
  const oy = h * 0.3;
  const unit = Math.min(w, h);
  const step = Math.max(28, unit * 0.1);
  const maxR = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)) * 1.05;
  const rings = Math.ceil(maxR / step) + 2;
  const speed = 0.05;
  return (ctx, t, palette) => {
    const gain = strength(palette, 1, 1.7);
    const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, maxR * 0.6);
    glow.addColorStop(0, rgba(palette.a1, 0.16 * strength(palette, 1, 0.7)));
    glow.addColorStop(1, rgba(palette.a1, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(0.3 + Math.sin(t * 0.04) * 0.08);
    const progress = t * speed;
    const base = Math.floor(progress);
    const frac = progress - base;
    ctx.lineWidth = 1.5;
    for (let j = 0; j < rings; j++) {
      const rad = (j + frac) * step;
      const fadeIn = Math.min(1, rad / (step * 1.5));
      const fadeOut = Math.max(0, 1 - rad / maxR);
      const alpha = 0.42 * gain * fadeIn * Math.pow(fadeOut, 1.1);
      if (alpha <= 0.002) continue;
      ctx.strokeStyle = rgba(tone(palette, j - base), alpha);
      ctx.beginPath();
      roundedRectPath(ctx, -rad * 1.15, -rad, rad * 2.3, rad * 2, rad * 0.62);
      ctx.stroke();
    }
    ctx.restore();
  };
}

function buildWaves(w, h) {
  const rand = rng(37);
  const layers = Array.from({ length: 5 }, (_, i) => ({
    base: h * (0.34 + i * 0.14),
    amp: Math.min(h, w * 1.2) * (0.035 + i * 0.006),
    length: Math.max(150, w * (0.95 - i * 0.12)),
    speed: (0.18 + i * 0.04) * (i % 2 ? -1 : 1),
    phase: rand() * TAU,
    tone: i,
    alpha: 0.2 - i * 0.02,
  }));
  const step = Math.max(6, w / 80);
  const points = Math.ceil(w / step) + 2;
  const ys = new Array(points);
  return (ctx, t, palette) => {
    for (const l of layers) {
      const color = tone(palette, l.tone);
      for (let i = 0; i < points; i++) {
        const x = i * step;
        ys[i] =
          l.base +
          l.amp * Math.sin((x * TAU) / l.length + t * l.speed + l.phase) +
          l.amp *
            0.4 *
            Math.sin(
              (x * TAU) / (l.length * 0.47) - t * l.speed * 1.4 + l.phase * 2,
            );
      }
      const grad = ctx.createLinearGradient(0, l.base - l.amp, 0, h);
      grad.addColorStop(0, rgba(color, l.alpha));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < points; i++) ctx.lineTo(i * step, ys[i]);
      ctx.lineTo((points - 1) * step, h);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgba(color, l.alpha * 1.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        if (i === 0) ctx.moveTo(0, ys[0]);
        else ctx.lineTo(i * step, ys[i]);
      }
      ctx.stroke();
    }
  };
}

const BUILDERS = {
  organic: buildOrganic,
  flow: buildFlow,
  nested: buildNested,
  waves: buildWaves,
};

function buildStyle(key, w, h) {
  const build = BUILDERS[key];
  if (!build || !(w > 0) || !(h > 0)) return null;
  return build(w, h);
}

export { STYLE_KEYS, buildStyle };
