// The sea of the atlas, drawn as an old sea chart: aged paper, brown ink.
//
// Three things lie just over the sea's surface, under everything that
// stands on it (the islands rise through them, and hide what would fall on
// land):
//
//   the chart   one sheet, painted by where each spot is in the world
//               (CHART_FRAG): parchment, mottled and foxed; a blue-green
//               wash where the water is shallow; the fine lines an engraver
//               rules along a coast, one inside the next, fading out to
//               sea; and rhumb lines running out from each compass rose
//               across the whole sea, as on a portolan. It knows where the
//               land is from a picture of how far each hex lies from it.
//   the wash    one sheet the size of the view, papered with a small tile of
//               pen strokes: wave ticks and a little stipple. It goes with
//               the camera a whole tile at a time, so the strokes stay where
//               they are in the world.
//   the devices what a chartmaker puts in an empty sea (DEVICES): a compass
//               rose with its rhumb lines, a serpent, a whirlpool, a ship, a
//               whale's back, rocks. Each is drawn once to a canvas and laid
//               flat on open water, a few to a window, where the chart's
//               seed says: the same sea has the same serpent in it every
//               time, for every one of the crew.
//
// A new device is a line in DEVICES and a function that draws it.

import * as THREE from "three";
import type { HexPos } from "@gantt-quest/core";
import { atlasLie, makeRng, seedFromString, type Rng } from "@gantt-quest/world";
import { hexToWorld, type WorldRenderer } from "../render/WorldRenderer";

/** The ink (iron gall, gone brown), the bare paper a chartmaker leaves for a highlight. */
const INK = "#3a2614";
const CHALK = "#f6ead0";
/** How high over the world's floor the ink lies: just clear of the water's surface, under the lowest land. */
const INK_Y = 0.168;
/** How many world units one tile of the wash covers, and how many tiles across the sheet is. */
const WASH_TILE = 11;
const WASH_TILES = 30;
/** How strongly the wash and the devices show over the water. */
const WASH_INK = 0.6;
const DEVICE_INK = 0.92;
/** Devices are tried for on a lattice this many hexes apart, and stand on this share of its points (where the sea is open). */
const DEVICE_STEP = 7;
const DEVICE_SHARE = 0.6;
/** How many hexes of open water a device needs round it, so no island cuts through it. */
const DEVICE_ROOM = 2;

/** How far from land the chart still knows how far it is, in hexes: past that the sea is plain paper. */
const COAST_FAR = 5;
/** How many compass roses the chart rules rhumb lines from at once (the nearest the middle of the window). */
const ROSES = 4;
/** The names a chartmaker letters across open water. */
const SEA_NAMES = ["Mare Incognitum", "The Gull Deeps", "Widow's Reach", "The Brine Road", "Sea of Lanterns", "The Kelp Shoals", "Fathom Deep", "The Squall Water", "Heron Sound", "The Long Swell"];

const CHART_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 at = modelMatrix * vec4(position, 1.0);
  vPos = at.xyz;
  gl_Position = projectionMatrix * viewMatrix * at;
}`;

const CHART_FRAG = /* glsl */ `
uniform sampler2D uCoast;
uniform vec2 uOrigin;
uniform float uSize;
uniform vec3 uRoses[${4}];
varying vec3 vPos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 w = vPos.xz;
  // Which hex this is, in the picture of how far each lies from land.
  float r = w.y / 1.5;
  float q = w.x / 1.7320508 - r * 0.5;
  vec2 uv = (vec2(q, r) - uOrigin + 0.5) / uSize;
  float known = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float d = mix(1.0, texture2D(uCoast, uv).r, known) * ${5}.0;
  // A hand ruled these: they waver.
  d += (noise(w * 0.45) - 0.5) * 0.7 + (noise(w * 1.3) - 0.5) * 0.22;

  // Old paper: mottled, foxed in spots, a little darker where it has been handled.
  float mottle = noise(w * 0.07) * 0.55 + noise(w * 0.3) * 0.3 + noise(w * 2.2) * 0.15;
  vec3 paper = mix(vec3(0.74, 0.63, 0.43), vec3(0.93, 0.86, 0.68), mottle);
  float fox = smoothstep(0.78, 0.9, noise(w * 0.55 + 31.0)) * 0.22;
  paper = mix(paper, vec3(0.55, 0.38, 0.2), fox);
  // Shallow water, washed in blue-green along the coasts and thinning out to sea.
  float shallow = exp(-max(d - 0.35, 0.0) * 0.85);
  // The sea is tinted blue over the paper, the way a chart's water was washed in by hand: deeper out at sea,
  // paler and greener in the shallows.
  vec3 col = mix(paper, vec3(0.27, 0.5, 0.68), 0.6 + 0.08 * mottle);
  col = mix(col, vec3(0.5, 0.76, 0.76), shallow * 0.6);
  // Deep water: out in the middle of a stretch of sea, well clear of every coast, the wash darkens in soft pools.
  float deep = smoothstep(2.8, 4.8, d) * smoothstep(0.3, 0.62, noise(w * 0.11 + 7.0));
  col = mix(col, vec3(0.12, 0.3, 0.5), deep * 0.34);

  vec3 ink = vec3(0.23, 0.15, 0.08);
  // Water lining: fine lines along the coast, one inside the next, closer together near the land and fading out.
  float band = pow(max(d - 0.35, 0.0), 0.8) * 2.3;
  float line = 1.0 - smoothstep(0.05, 0.13, abs(fract(band) - 0.5));
  float reach = smoothstep(0.4, 0.6, d) * (1.0 - smoothstep(1.5, 2.7, d));
  col = mix(col, ink, line * reach * (0.45 + 0.3 * noise(w * 3.0)));
  // The coast itself, drawn firm.
  col = mix(col, ink, (1.0 - smoothstep(0.42, 0.56, d)) * 0.5);

  // Rhumb lines: sixteen from each rose, ruled right across the sea, every fourth in red.
  for (int i = 0; i < ${4}; i++) {
    vec2 v = w - uRoses[i].xy;
    float len = length(v);
    float a = atan(v.y, v.x);
    float off = len * abs(sin(a * 8.0)) / 8.0;
    float rule = (1.0 - smoothstep(0.018, 0.05, off)) * uRoses[i].z * smoothstep(1.6, 3.0, len) * (1.0 - smoothstep(34.0, 60.0, len));
    float red = step(0.92, abs(cos(a * 2.0)));
    col = mix(col, mix(ink, vec3(0.55, 0.2, 0.12), red), rule * 0.34 * smoothstep(0.5, 0.9, d));
  }
  gl_FragColor = vec4(col, 0.93);
  #include <colorspace_fragment>
}`;

type Pen = CanvasRenderingContext2D;

/**
 * A stroke as a pen makes it: drawn twice, the second a hair off the first and thinner, so a line has a
 * darker heart and a ragged edge.
 */
function stroke(pen: Pen, width: number, path: (pen: Pen) => void, rng: Rng) {
  for (const [w, a] of [[width, 0.75], [width * 0.45, 1]] as const) {
    pen.save();
    pen.translate((rng.next() - 0.5) * width * 0.5, (rng.next() - 0.5) * width * 0.5);
    pen.globalAlpha = a;
    pen.lineWidth = w;
    pen.beginPath();
    path(pen);
    pen.stroke();
    pen.restore();
  }
}

/** A wave tick: two or three little crests in a row. */
function waves(pen: Pen, x: number, y: number, size: number, crests: number, rng: Rng) {
  stroke(pen, size * 0.16, (p) => {
    for (let i = 0; i < crests; i++) {
      const at = x + i * size;
      p.moveTo(at, y);
      p.quadraticCurveTo(at + size * 0.5, y - size * 0.62, at + size, y);
    }
  }, rng);
}

function canvas(size: number): [HTMLCanvasElement, Pen] {
  const el = document.createElement("canvas");
  el.width = el.height = size;
  const pen = el.getContext("2d")!;
  pen.strokeStyle = pen.fillStyle = INK;
  pen.lineCap = pen.lineJoin = "round";
  return [el, pen];
}

/** The wash's tile: wave ticks and stipple, kept clear of the tile's edges so it papers without a seam. */
function washTile(): HTMLCanvasElement {
  const size = 512;
  const [el, pen] = canvas(size);
  const rng = makeRng(seedFromString("atlas-ink|wash"));
  const placed: [number, number][] = [];
  for (let tries = 0; placed.length < 15 && tries < 400; tries++) {
    const [x, y] = [40 + rng.next() * (size - 130), 40 + rng.next() * (size - 80)];
    if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 92)) continue;
    placed.push([x, y]);
    waves(pen, x, y, 13 + rng.next() * 7, rng.int(2, 3), rng);
  }
  for (let i = 0; i < 70; i++) {
    pen.globalAlpha = 0.35 + rng.next() * 0.4;
    pen.beginPath();
    pen.arc(8 + rng.next() * (size - 16), 8 + rng.next() * (size - 16), 0.8 + rng.next() * 1.1, 0, Math.PI * 2);
    pen.fill();
  }
  return el;
}

/** Something drawn in an empty sea. `span` is how many world units across it lies; `weight` how often it is the one picked. */
interface Device {
  span: number;
  weight: number;
  /** Whether it may be turned any way round (a ship and a serpent keep their heads up the page). */
  turns?: boolean;
  draw(pen: Pen, size: number, rng: Rng): void;
}

const DEVICES: Record<string, Device> = {
  // A compass rose, with rhumb lines running out from it across the water.
  rose: {
    span: 20, weight: 3, draw(pen, s, rng) {
      const c = s / 2;
      // In greys, not the chart's brown ink: an engraved plate laid on the sea.
      const [DARK, PALE, MID, SOFT] = ["#242424", "#f0f0f0", "#5e5e5e", "#b4b4b4"];
      pen.strokeStyle = pen.fillStyle = DARK;
      const r = s * 0.2;
      stroke(pen, 3, (p) => p.arc(c, c, r, 0, Math.PI * 2), rng);
      stroke(pen, 1.6, (p) => p.arc(c, c, r * 0.72, 0, Math.PI * 2), rng);
      // Eight points: the four winds long, the four between them short; each half dark and half pale.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const long = i % 2 === 0 ? r * 1.55 : r * 0.95;
        const wide = r * 0.2;
        for (const side of [-1, 1]) {
          pen.beginPath();
          pen.moveTo(c, c);
          pen.lineTo(c + Math.cos(a + (side * Math.PI) / 2) * wide, c + Math.sin(a + (side * Math.PI) / 2) * wide);
          pen.lineTo(c + Math.cos(a) * long, c + Math.sin(a) * long);
          pen.closePath();
          // The four winds in black and white; the four between them in two greys.
          pen.fillStyle = i % 2 === 0 ? (side < 0 ? DARK : PALE) : side < 0 ? MID : SOFT;
          pen.globalAlpha = 0.95;
          pen.fill();
          pen.strokeStyle = DARK;
          pen.lineWidth = 1.2;
          pen.stroke();
        }
        pen.globalAlpha = 1;
        pen.fillStyle = DARK;
      }
      // A ring of degrees round it, and north marked with a fleur-de-lis (a spearhead between two curled leaves).
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const [r0, r1] = [r * 1.02, r * (i % 4 === 0 ? 1.16 : 1.09)];
        pen.lineWidth = 1.4;
        pen.beginPath();
        pen.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
        pen.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
        pen.stroke();
      }
      const top = c - r * 1.62;
      pen.fillStyle = DARK;
      pen.beginPath();
      pen.moveTo(c, top - r * 0.5);
      pen.quadraticCurveTo(c + r * 0.16, top - r * 0.2, c, top);
      pen.quadraticCurveTo(c - r * 0.16, top - r * 0.2, c, top - r * 0.5);
      pen.fill();
      for (const side of [-1, 1]) {
        stroke(pen, 2.4, (p) => {
          p.moveTo(c, top - r * 0.04);
          p.bezierCurveTo(c + side * r * 0.12, top - r * 0.3, c + side * r * 0.36, top - r * 0.3, c + side * r * 0.3, top - r * 0.08);
        }, rng);
      }
      stroke(pen, 2.2, (p) => {
        p.moveTo(c - r * 0.2, top + r * 0.03);
        p.lineTo(c + r * 0.2, top + r * 0.03);
      }, rng);
    },
  },
  // A sea serpent: three humps of it out of the water, a head at one end and a tail at the other.
  serpent: {
    span: 8, weight: 2, draw(pen, s, rng) {
      const y = s * 0.6;
      const hump = s * 0.2;
      for (let i = 0; i < 3; i++) {
        const x = s * 0.16 + i * hump * 1.15;
        const high = hump * (0.95 - i * 0.16);
        pen.fillStyle = CHALK;
        pen.globalAlpha = 0.5;
        pen.beginPath();
        pen.moveTo(x, y);
        pen.bezierCurveTo(x, y - high * 1.3, x + hump, y - high * 1.3, x + hump, y);
        pen.bezierCurveTo(x + hump * 0.78, y - high * 0.7, x + hump * 0.22, y - high * 0.7, x, y);
        pen.fill();
        pen.globalAlpha = 1;
        pen.fillStyle = INK;
        stroke(pen, 3.2, (p) => {
          p.moveTo(x, y);
          p.bezierCurveTo(x, y - high * 1.3, x + hump, y - high * 1.3, x + hump, y);
        }, rng);
        stroke(pen, 1.8, (p) => {
          p.moveTo(x + hump * 0.14, y);
          p.bezierCurveTo(x + hump * 0.22, y - high * 0.7, x + hump * 0.78, y - high * 0.7, x + hump * 0.86, y);
        }, rng);
        // Fins along its back.
        for (let f = 1; f <= 3; f++) {
          const t = f / 4;
          const fx = x + hump * t;
          const fy = y - high * 0.98 * Math.sin(Math.PI * t);
          stroke(pen, 1.6, (p) => {
            p.moveTo(fx - 4, fy);
            p.lineTo(fx, fy - 9);
            p.lineTo(fx + 4, fy);
          }, rng);
        }
        waves(pen, x - 6, y + 7, hump * 0.36, 3, rng);
      }
      // The head, reared up at the left with an eye and a forked tongue.
      const [hx, hy] = [s * 0.13, y - hump * 1.15];
      stroke(pen, 3.2, (p) => {
        p.moveTo(s * 0.16, y);
        p.bezierCurveTo(s * 0.2, y - hump * 0.9, s * 0.2, hy - 6, hx, hy - 12);
        p.bezierCurveTo(hx - 30, hy - 16, hx - 44, hy + 2, hx - 30, hy + 10);
        p.bezierCurveTo(hx - 14, hy + 14, s * 0.1, hy + 18, s * 0.1, y);
      }, rng);
      pen.beginPath();
      pen.arc(hx - 20, hy - 3, 2.6, 0, Math.PI * 2);
      pen.fill();
      stroke(pen, 1.5, (p) => {
        p.moveTo(hx - 36, hy + 5);
        p.lineTo(hx - 52, hy + 9);
        p.moveTo(hx - 46, hy + 7.5);
        p.lineTo(hx - 54, hy + 2);
      }, rng);
      // And the tail, curled out of the water at the right.
      const tx = s * 0.16 + 3 * hump * 1.15 + 10;
      stroke(pen, 2.6, (p) => {
        p.moveTo(tx, y);
        p.bezierCurveTo(tx + 6, y - 40, tx + 34, y - 44, tx + 30, y - 22);
        p.bezierCurveTo(tx + 28, y - 12, tx + 18, y - 14, tx + 20, y - 22);
      }, rng);
      waves(pen, tx - 10, y + 7, 11, 3, rng);
    },
  },
  // A whirlpool: a spiral, with a few strokes thrown off its rim.
  whirlpool: {
    span: 5, weight: 2, turns: true, draw(pen, s, rng) {
      const c = s / 2;
      stroke(pen, 3, (p) => {
        for (let t = 0; t <= 1; t += 0.01) {
          const a = t * Math.PI * 6.5;
          const r = 6 + t * s * 0.36;
          const [x, y] = [c + Math.cos(a) * r, c + Math.sin(a) * r * 0.82];
          if (t === 0) p.moveTo(x, y);
          else p.lineTo(x, y);
        }
      }, rng);
      for (let i = 0; i < 7; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = s * (0.4 + rng.next() * 0.06);
        stroke(pen, 1.6, (p) => p.arc(c, c, r, a, a + 0.3 + rng.next() * 0.3), rng);
      }
    },
  },
  // A ship under sail, the way a chart draws one: a hull, two masts, a pennant, and its own little sea.
  ship: {
    span: 5, weight: 2, draw(pen, s, rng) {
      const [c, y] = [s / 2, s * 0.66];
      const w = s * 0.3;
      pen.fillStyle = CHALK;
      pen.globalAlpha = 0.55;
      for (const [mx, top, wide] of [[c - w * 0.3, y - s * 0.4, w * 0.5], [c + w * 0.34, y - s * 0.32, w * 0.4]]) {
        pen.beginPath();
        pen.moveTo(mx - wide * 0.5, y - 14);
        pen.quadraticCurveTo(mx + wide * 0.3, (top + y) / 2, mx - wide * 0.5, top + 8);
        pen.lineTo(mx + wide * 0.55, top + 14);
        pen.quadraticCurveTo(mx + wide * 0.95, (top + y) / 2, mx + wide * 0.55, y - 16);
        pen.closePath();
        pen.fill();
      }
      pen.globalAlpha = 1;
      pen.fillStyle = INK;
      for (const [mx, top, wide] of [[c - w * 0.3, y - s * 0.4, w * 0.5], [c + w * 0.34, y - s * 0.32, w * 0.4]]) {
        stroke(pen, 2.4, (p) => {
          p.moveTo(mx, y - 6);
          p.lineTo(mx, top);
        }, rng);
        stroke(pen, 2, (p) => {
          p.moveTo(mx - wide * 0.5, y - 14);
          p.quadraticCurveTo(mx + wide * 0.3, (top + y) / 2, mx - wide * 0.5, top + 8);
          p.lineTo(mx + wide * 0.55, top + 14);
          p.quadraticCurveTo(mx + wide * 0.95, (top + y) / 2, mx + wide * 0.55, y - 16);
          p.closePath();
        }, rng);
        stroke(pen, 1.8, (p) => {
          p.moveTo(mx, top);
          p.lineTo(mx + 14, top + 4);
          p.lineTo(mx, top + 8);
        }, rng);
      }
      pen.beginPath();
      pen.moveTo(c - w, y - 12);
      pen.quadraticCurveTo(c - w * 0.7, y + 12, c - w * 0.4, y + 12);
      pen.lineTo(c + w * 0.6, y + 12);
      pen.quadraticCurveTo(c + w * 0.95, y + 6, c + w * 1.05, y - 16);
      pen.lineTo(c + w * 0.7, y - 8);
      pen.lineTo(c - w * 0.6, y - 8);
      pen.closePath();
      pen.globalAlpha = 0.9;
      pen.fill();
      pen.globalAlpha = 1;
      waves(pen, c - w * 1.2, y + 24, 12, 3, rng);
      waves(pen, c + w * 0.2, y + 28, 12, 3, rng);
    },
  },
  // A whale's back, and its spout.
  whale: {
    span: 5.4, weight: 1, draw(pen, s, rng) {
      const [c, y] = [s / 2, s * 0.64];
      const w = s * 0.3;
      pen.beginPath();
      pen.moveTo(c - w, y);
      pen.bezierCurveTo(c - w * 0.7, y - s * 0.26, c + w * 0.6, y - s * 0.24, c + w, y);
      pen.closePath();
      pen.globalAlpha = 0.85;
      pen.fill();
      pen.globalAlpha = 1;
      // Its flukes, up behind it.
      stroke(pen, 2.6, (p) => {
        p.moveTo(c + w * 1.25, y);
        p.quadraticCurveTo(c + w * 1.3, y - 30, c + w * 1.55, y - 44);
        p.quadraticCurveTo(c + w * 1.3, y - 36, c + w * 1.32, y - 30);
        p.quadraticCurveTo(c + w * 1.16, y - 40, c + w * 1.0, y - 42);
        p.quadraticCurveTo(c + w * 1.2, y - 28, c + w * 1.25, y);
      }, rng);
      for (const lean of [-0.5, -0.15, 0.2, 0.55]) {
        stroke(pen, 1.7, (p) => {
          p.moveTo(c - w * 0.5, y - s * 0.2);
          p.quadraticCurveTo(c - w * 0.5 + lean * 10, y - s * 0.34, c - w * 0.5 + lean * 46, y - s * 0.4 + Math.abs(lean) * 16);
        }, rng);
      }
      waves(pen, c - w * 1.25, y + 8, 12, 3, rng);
      waves(pen, c + w * 0.1, y + 10, 12, 3, rng);
    },
  },
  // Rocks awash: a few teeth of stone with the sea breaking on them.
  rocks: {
    span: 4, weight: 1, turns: true, draw(pen, s, rng) {
      for (let i = 0; i < 4; i++) {
        const x = s * (0.26 + i * 0.15) + (rng.next() - 0.5) * 12;
        const y = s * (0.56 + (rng.next() - 0.5) * 0.16);
        const high = s * (0.1 + rng.next() * 0.1);
        pen.beginPath();
        pen.moveTo(x - high * 0.5, y);
        pen.lineTo(x - high * 0.1, y - high);
        pen.lineTo(x + high * 0.2, y - high * 0.7);
        pen.lineTo(x + high * 0.55, y);
        pen.closePath();
        pen.globalAlpha = 0.85;
        pen.fill();
        pen.globalAlpha = 1;
        waves(pen, x - high * 0.8, y + 6, high * 0.55, 3, rng);
      }
    },
  },
};
// A sea's name, lettered across it. (What it says is picked where it is laid: see `lettered`.)
DEVICES.name = { span: 12, weight: 2, draw() {} };

/** A sea's name in a chartmaker's italic hand, widely spaced, on a gentle arc. */
function lettered(pen: Pen, size: number, text: string) {
  pen.font = `italic ${Math.round(size * 0.085)}px "IM Fell English", "Palatino Linotype", Palatino, Georgia, serif`;
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  const letters = [...text.toUpperCase()];
  const step = Math.min(size * 0.075, (size * 0.9) / letters.length);
  const radius = size * 1.6;
  letters.forEach((ch, i) => {
    const along = (i - (letters.length - 1) / 2) * step;
    const turn = along / radius;
    pen.save();
    pen.translate(size / 2 + Math.sin(turn) * radius, size / 2 + radius - Math.cos(turn) * radius);
    pen.rotate(turn);
    pen.globalAlpha = 0.82;
    pen.fillText(ch, 0, 0);
    pen.restore();
  });
}

const DEVICE_IDS = Object.keys(DEVICES);
const DEVICE_WEIGHT = DEVICE_IDS.reduce((n, id) => n + DEVICES[id].weight, 0);

/** The ink on the atlas's sea. */
export class AtlasInk {
  private readonly chart: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** How far each hex of the window lies from land, 0 (land) to 255 (`COAST_FAR` hexes or more, or unknown). */
  private readonly coast: THREE.DataTexture;
  private readonly size: number;
  private readonly wash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly devices = new THREE.Group();
  private readonly drawn = new Map<string, THREE.CanvasTexture>();
  private readonly flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly stop: () => void;
  /** What the devices now laid were worked out for: the same again is nothing to do. */
  private laid = "";

  /** `reach` is how far the ground it is told of can lie from the middle it is given, in hexes. */
  constructor(private readonly renderer: WorldRenderer, reach: number) {
    this.size = reach * 2 + 5;
    this.coast = new THREE.DataTexture(new Uint8Array(this.size * this.size).fill(255), this.size, this.size, THREE.RedFormat);
    this.coast.magFilter = this.coast.minFilter = THREE.LinearFilter;
    this.coast.needsUpdate = true;
    this.chart = new THREE.Mesh(
      new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: CHART_VERT,
        fragmentShader: CHART_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { uCoast: { value: this.coast }, uOrigin: { value: new THREE.Vector2() }, uSize: { value: this.size }, uRoses: { value: Array.from({ length: ROSES }, () => new THREE.Vector3()) } },
      }),
    );
    this.chart.position.y = INK_Y - 0.004;
    this.chart.frustumCulled = false;
    this.chart.renderOrder = 1;
    renderer.addObject(this.chart);
    const tile = new THREE.CanvasTexture(washTile());
    tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
    tile.repeat.set(WASH_TILES, WASH_TILES);
    tile.colorSpace = THREE.SRGBColorSpace;
    tile.anisotropy = 4;
    this.wash = new THREE.Mesh(
      new THREE.PlaneGeometry(WASH_TILE * WASH_TILES, WASH_TILE * WASH_TILES).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tile, transparent: true, opacity: WASH_INK, depthWrite: false }),
    );
    this.wash.position.y = INK_Y;
    this.wash.frustumCulled = false;
    this.wash.renderOrder = 1;
    renderer.addObject(this.wash);
    renderer.addObject(this.devices);
    this.stop = renderer.addTicker(() => {
      // With the camera, a whole tile at a time: the strokes do not slide over the water.
      const { x, z } = hexToWorld(renderer.focus());
      this.wash.position.set(Math.round(x / WASH_TILE) * WASH_TILE, INK_Y, Math.round(z / WASH_TILE) * WASH_TILE);
      // The chart paints by where each spot is in the world, so it may simply go with the camera.
      this.chart.position.set(x, INK_Y - 0.004, z);
    });
  }

  dispose() {
    this.stop();
    this.renderer.removeObject(this.wash);
    this.renderer.removeObject(this.chart);
    this.chart.geometry.dispose();
    this.chart.material.dispose();
    this.coast.dispose();
    this.renderer.removeObject(this.devices);
    this.clear();
    this.wash.geometry.dispose();
    this.wash.material.map?.dispose();
    this.wash.material.dispose();
    this.flat.dispose();
    for (const t of this.drawn.values()) t.dispose();
  }

  private clear() {
    for (const mesh of [...this.devices.children] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]) {
      this.devices.remove(mesh);
      mesh.material.dispose();
    }
  }

  /** A device's picture, drawn once. `text` is what a sea's name says (each name its own picture). */
  private texture(id: string, text = ""): THREE.CanvasTexture {
    const key = `${id}|${text}`;
    let made = this.drawn.get(key);
    if (!made) {
      const size = id === "rose" || id === "name" ? 768 : 384;
      const [el, pen] = canvas(size);
      if (id === "name") lettered(pen, size, text);
      else DEVICES[id].draw(pen, size, makeRng(seedFromString(`atlas-ink|${id}`)));
      made = new THREE.CanvasTexture(el);
      made.colorSpace = THREE.SRGBColorSpace;
      made.anisotropy = 4;
      this.drawn.set(key, made);
    }
    return made;
  }

  /**
   * Lay the devices of a chart's sea round `centre`, as far as `reach` hexes: at the points of a coarse
   * lattice the seed picks, wherever the water is open all round. The same seed lays the same sea.
   */
  set(seed: string, centre: HexPos, reach: number, tiles: readonly { q: number; r: number; biome: string }[]) {
    this.charted(centre, tiles);
    const mid = { q: Math.round(centre.q / DEVICE_STEP), r: Math.round(centre.r / DEVICE_STEP) };
    const key = `${seed}|${mid.q},${mid.r}|${reach}`;
    if (key === this.laid) return;
    this.laid = key;
    this.clear();
    const roses: { x: number; z: number; far: number }[] = [];
    const memo = new Map<string, number>();
    const open = (hex: HexPos) => atlasLie(seed, hex, memo).open === true;
    const span = Math.ceil(reach / DEVICE_STEP);
    for (let dq = -span; dq <= span; dq++) {
      for (let dr = -span; dr <= span; dr++) {
        const cell = { q: mid.q + dq, r: mid.r + dr };
        const rng = makeRng(seedFromString(`atlas-ink|${seed}|${cell.q},${cell.r}`));
        if (!rng.chance(DEVICE_SHARE)) continue;
        const hex = { q: cell.q * DEVICE_STEP + rng.int(-2, 2), r: cell.r * DEVICE_STEP + rng.int(-2, 2) };
        let pick = rng.next() * DEVICE_WEIGHT;
        const id = DEVICE_IDS.find((d) => (pick -= DEVICES[d].weight) < 0) ?? DEVICE_IDS[0];
        const device = DEVICES[id];
        // Open water under it and all round it, as far as it reaches: no island cuts through a serpent.
        const room = Math.max(DEVICE_ROOM, Math.ceil(device.span / 5));
        let clear = open(hex);
        for (let a = 0; clear && a < 6; a++) {
          const [q, r] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]][a];
          for (let n = 1; clear && n <= room; n++) clear = open({ q: hex.q + q * n, r: hex.r + r * n });
        }
        if (!clear) continue;
        const text = id === "name" ? rng.pick(SEA_NAMES) : "";
        const mesh = new THREE.Mesh(this.flat, new THREE.MeshBasicMaterial({ map: this.texture(id, text), transparent: true, opacity: DEVICE_INK, depthWrite: false }));
        const at = hexToWorld(hex);
        if (id === "rose") roses.push({ x: at.x, z: at.z, far: Math.hypot(hex.q - centre.q, hex.r - centre.r) });
        mesh.position.set(at.x, INK_Y + 0.004, at.z);
        mesh.scale.set(device.span, 1, device.span);
        if (device.turns) mesh.rotation.y = rng.next() * Math.PI * 2;
        mesh.renderOrder = 2;
        this.devices.add(mesh);
      }
    }
    // Rhumb lines from the roses nearest the middle of the window.
    roses.sort((a, b) => a.far - b.far);
    (this.chart.material.uniforms.uRoses.value as THREE.Vector3[]).forEach((u, i) => (roses[i] ? u.set(roses[i].x, roses[i].z, 1) : u.set(0, 0, 0)));
  }

  /** Tell the chart where the land is: how far each hex of the window lies from the nearest land it was given. */
  private charted(centre: HexPos, tiles: readonly { q: number; r: number; biome: string }[]) {
    const half = (this.size - 1) / 2;
    const origin = { q: centre.q - half, r: centre.r - half };
    const n = this.size;
    const far = new Uint8Array(n * n).fill(COAST_FAR);
    let edge: number[] = [];
    for (const t of tiles) {
      const [i, j] = [t.q - origin.q, t.r - origin.r];
      if (t.biome === "water" || i < 0 || j < 0 || i >= n || j >= n) continue;
      far[j * n + i] = 0;
      edge.push(j * n + i);
    }
    // Outward from the land, a hex at a time.
    for (let d = 1; d < COAST_FAR && edge.length; d++) {
      const next: number[] = [];
      for (const k of edge) {
        const [i, j] = [k % n, Math.floor(k / n)];
        for (const [di, dj] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
          const [a, b] = [i + di, j + dj];
          if (a < 0 || b < 0 || a >= n || b >= n || far[b * n + a] <= d) continue;
          far[b * n + a] = d;
          next.push(b * n + a);
        }
      }
      edge = next;
    }
    const data = this.coast.image.data as Uint8Array;
    for (let k = 0; k < data.length; k++) data[k] = Math.round((far[k] / COAST_FAR) * 255);
    this.coast.needsUpdate = true;
    (this.chart.material.uniforms.uOrigin.value as THREE.Vector2).set(origin.q, origin.r);
  }
}
