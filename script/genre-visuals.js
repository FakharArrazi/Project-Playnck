import { normalizeForCompare } from "./metadata-normalize.js";

const glyph = (shapes) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 32 32' fill='none' stroke='white' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'>" +
      shapes +
      "</svg>",
  );

const ICONS = {
  note: glyph(
    "<path d='M9 17V5l11-2v12'/><circle cx='6.5' cy='17' r='2.5'/><circle cx='17.5' cy='15' r='2.5'/>",
  ),
  mic: glyph(
    "<rect x='9' y='2.5' width='6' height='12' rx='3'/><path d='M5 11.5a7 7 0 0 0 14 0M12 18.5v3M8.5 21.5h7'/>",
  ),
  keys: glyph(
    "<rect x='2.5' y='5.5' width='19' height='13' rx='2'/><path d='M7.25 5.5v13M12 5.5v13M16.75 5.5v13'/>",
  ),
  bolt: glyph("<path d='M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5z'/>"),
  guitar: glyph(
    "<circle cx='8.5' cy='15.5' r='4.5'/><circle cx='8.5' cy='15.5' r='1.3'/><path d='m12 12 8-8M17.5 3.5l3 3M15 6.5l2.5 2.5'/>",
  ),
  vinyl: glyph(
    "<circle cx='12' cy='12' r='9.5'/><circle cx='12' cy='12' r='3.5'/><circle cx='12' cy='12' r='.8'/><path d='M12 5.5a6.5 6.5 0 0 1 6.5 6.5'/>",
  ),
  wave: glyph("<path d='M2 12h3.5l2.5-7 4 14 3.5-10 2 3H22'/>"),
  disco: glyph(
    "<path d='M12 2.5v4'/><circle cx='12' cy='14' r='7.5'/><path d='M4.5 14h15M12 6.5v15M7 9.2c3 2 7 2 10 0M7 18.8c3-2 7-2 10 0'/>",
  ),
  sparkle: glyph(
    "<path d='M10 3c.7 5 2.3 6.6 7.3 7.3-5 .7-6.6 2.3-7.3 7.3-.7-5-2.3-6.6-7.3-7.3 5-.7 6.6-2.3 7.3-7.3z'/><path d='M18.5 14.2c.4 2.3 1.2 3.1 3.5 3.5-2.3.4-3.1 1.2-3.5 3.5-.4-2.3-1.2-3.1-3.5-3.5 2.3-.4 3.1-1.2 3.5-3.5z'/>",
  ),
  film: glyph(
    "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21'/>",
  ),
  question: glyph(
    "<circle cx='12' cy='12' r='9.5'/><path d='M9.2 9.3a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2.1M12 17.2v.1'/>",
  ),
};

const electronic = { art: ICONS.wave, color: "#0e9fbf" };
const hipHop = { art: ICONS.vinyl, color: "#c98a12" };
const rock = { art: ICONS.guitar, color: "#b3363f" };
const rnb = { art: ICONS.keys, color: "#6366f1" };
const soundtrack = { art: ICONS.film, color: "#2f8f73" };


const genreVisuals = {
  Anime: { art: ICONS.sparkle, color: "#d94fa3" },
  Dance: { art: ICONS.disco, color: "#9b51e0" },
  Electro: electronic,
  Electronic: electronic,
  Electronica: electronic,
  EDM: electronic,
  "Hip Hop": hipHop,
  "Hip-Hop": hipHop,
  Rap: hipHop,
  Metal: { art: ICONS.guitar, color: "#5b6b7c" },
  "Heavy Metal": { art: ICONS.guitar, color: "#5b6b7c" },
  "Hard Rock": { art: ICONS.bolt, color: "#c4541d" },
  Rock: rock,
  Punk: rock,
  Pop: { art: ICONS.mic, color: "#ef6b57" },
  "R&B": rnb,
  RnB: rnb,
  Soul: { art: ICONS.keys, color: "#b9722f" },
  Soundtrack: soundtrack,
  Soundtracks: soundtrack,
  Unknown: { art: ICONS.question, color: "#4a4f5c" },
};

const VISUALS = new Map(
  Object.entries(genreVisuals).map(([name, visual]) => [
    normalizeForCompare(name),
    visual,
  ]),
);

function fallbackVisual(key) {
  let hue = 0;
  for (const ch of key) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return { art: ICONS.note, color: `hsl(${hue} 50% 44%)` };
}

function genreVisual(key) {
  return VISUALS.get(key) || fallbackVisual(key);
}

export { genreVisual };
