// What is drawn on small canvases rather than modelled: name plates (in the
// interface's own type), and speech bubbles, floating numbers and battle
// effects, pixel-crisp. Also the
// characters' pictures for the HUD, which are rendered from their models
// (figures.ts) by portraits.ts.

import * as THREE from "three";
import { SLOTS, appearanceKey, parseAppearance, type Appearance, type Outfit } from "@gantt-quest/world";
import { outlines } from "./fancy";
import { LOOKS, mergeLook, type Look, type LookPalette } from "./looks";
import { PIXEL_LINE_ROWS, canDrawPixelText, drawPixelText, pixelTextWidth } from "./pixelFont";
import { hasOwnFace } from "./figures";
import { isBlankPortrait, portraitUrl } from "./portraits";

const OUTLINE = "#1b1830";

const pictures = new Map<string, string>();

// Admin palette overrides (from the content bundle), laid over LOOKS. Every
// change bumps the revision, which is part of every figure's key: the pictures
// start afresh and the world renderer, which compares keys, rebuilds its units.
let palettes: Record<string, LookPalette> = {};
let revision = 0;

/** Replace the palette overrides in force. Figures built from now on use them. */
export function setLookOverrides(next: Record<string, LookPalette>): void {
  if (JSON.stringify(next) === JSON.stringify(palettes)) return;
  palettes = next;
  revision++;
  pictures.clear();
}

/** A kind's look as currently drawn: the stock look with any admin palette over it. Unknown kinds get the bandit. */
export function lookFor(kind: string): Look {
  return mergeLook(LOOKS[kind] ?? LOOKS.bandit, palettes[kind]);
}

/** What tells one figure from another: the kind plus whatever is being worn, whether they are asleep or fishing, and the overrides in force. */
export function spriteKey(kind: string, outfit?: Outfit, asleep = false, rod: boolean | "gilded" = false): string {
  const worn = outfit ? `|${SLOTS.map((s) => (outfit[s] ? `${outfit[s]!.ref}:${outfit[s]!.rarity[0]}` : "-")).join(",")}${outfit.appearance ? `|${appearanceKey(outfit.appearance)}` : ""}` : "";
  return `${kind}${worn}${asleep ? "|zz" : ""}${rod === "gilded" ? "|rodG" : rod ? "|rod" : ""}|r${revision}`;
}

/** An outfit with the hero's chosen look on it (a stored JSON string or an Appearance), if they have one. */
export function withLook(outfit: Outfit, appearance: string | Appearance | null | undefined): Outfit {
  const look = typeof appearance === "string" || appearance == null ? parseAppearance(appearance ?? null) : appearance;
  return look ? { ...outfit, appearance: look } : outfit;
}

/**
 * A figure's picture drawn with a given palette (undefined: the stock look) rather than the one in force,
 * as an image URL: the admin page's live preview. Same models as the game, no cache.
 */
export function previewSpriteUrl(kind: string, palette: LookPalette | undefined, outfit?: Outfit, asleep = false): string {
  return portraitUrl(kind, mergeLook(LOOKS[kind] ?? LOOKS.bandit, palette), outfit, asleep);
}

/**
 * A hero class, enemy kind or townsperson as an image URL, for the HUD. Pass a hero's outfit to show
 * them wearing it. `large` draws it at twice the detail, for the character sheet's full figure. `face`
 * (an enemy's id) picks the face of one drawn as a person, to match the one on the board.
 */
export function spriteDataUrl(kind: string, outfit?: Outfit, large = false, face?: string): string {
  const faced = face && hasOwnFace(kind) ? face : undefined;
  // Drawn with outlines or without, as the setting is now (see outlines).
  const key = `${spriteKey(kind, outfit)}${large ? "|L" : ""}${faced ? `|f:${faced}` : ""}${outlines.get() ? "|ink" : ""}`;
  let url = pictures.get(key);
  if (url) return url;
  url = portraitUrl(kind, lookFor(kind), outfit, false, large ? 2 : 1, faced);
  // An empty picture (the renderer's context was lost) is not kept: it is drawn again the next time it is asked for.
  if (!isBlankPortrait(url)) pictures.set(key, url);
  return url;
}

let zTexture: THREE.CanvasTexture | null = null;

/** A pixel-art "Z" for someone asleep: pale blue with a dark outline. Shared by every sleeper. */
export function sleepZTexture(): THREE.CanvasTexture {
  if (zTexture) return zTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 9;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#dbe9ff";
  ctx.fillRect(2, 2, 5, 1);
  ctx.fillRect(5, 3, 1, 1);
  ctx.fillRect(4, 4, 1, 1);
  ctx.fillRect(3, 5, 1, 1);
  ctx.fillRect(2, 6, 5, 1);
  // A one-pixel dark outline around the letter.
  const img = ctx.getImageData(0, 0, 9, 9);
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < 9 && y < 9 && img.data[(y * 9 + x) * 4 + 3] > 0;
  ctx.fillStyle = OUTLINE;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) ctx.fillRect(x, y, 1, 1);
  zTexture = new THREE.CanvasTexture(canvas);
  zTexture.magFilter = THREE.NearestFilter;
  zTexture.minFilter = THREE.NearestFilter;
  zTexture.generateMipmaps = false;
  zTexture.colorSpace = THREE.SRGBColorSpace;
  return zTexture;
}

/** A short text label as a pixel-crisp texture, for floating combat numbers. */
export function textTexture(text: string, color: string): THREE.CanvasTexture {
  const font = "bold 18px ui-monospace, Menlo, monospace";
  const canvas = document.createElement("canvas");
  // 64 wide fits a damage number; longer text ("+10 XP", "LEVEL UP") gets a wider canvas, so the sprite's aspect follows it.
  const measureCtx = canvas.getContext("2d")!;
  measureCtx.font = font;
  canvas.width = Math.max(64, Math.ceil(measureCtx.measureText(text).width) + 10);
  canvas.height = 24;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, canvas.width / 2, 12);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, 12);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- name plates ----------

/**
 * What a plate shows under the name: how full the HP is (0 to 1), any shield, and for a hero their level. With
 * no `hp` it is the name alone (and the level), as in the Harbor, where nobody is hurt.
 */
export interface PlateStats {
  /** Before the name, in brass. None on an enemy's. */
  level?: number;
  hp?: number;
  /** A shield (Bolstered), as a share of max HP like `hp`: its own steel bar over the HP, and its points on a little shield. */
  shield?: number;
  /** The shield's points, for the number on it. */
  shieldPoints?: number;
  /** Just earned XP: the name is lit up gold for a moment. */
  glow?: boolean;
}

/**
 * Whose plate it is, which colours the name and the HP bar as the fight interface does (fight.css): your own in
 * gold, another hero in sea-green, an enemy in red, and anyone else (a townsperson) in plain parchment.
 */
export type PlateTone = "you" | "ally" | "foe" | "plain";

const TONE_INK: Record<PlateTone, string> = { you: "#f6cf68", ally: "#8fd3c8", foe: "#ff8571", plain: "#eadfc4" };
/** The HP bar's liquid, lit at the top: green for a friend, red for an enemy (the turn order's bars, .fo-hp). */
const HP_FILL: Record<"friend" | "foe", [string, string]> = { friend: ["#b6f09a", "#5fbf4a"], foe: ["#ff9a86", "#d8342a"] };
const SHIELD_FILL: [string, string] = ["#f4f8ff", "#9fb4cf"];
const PLATE_OUT = "#1c0d0e";
const PLATE_WELL = "#120908";
/** The level's medallion: brass lit from above, a darker rim inside the outline, the number stamped in dark ink. */
const LEVEL_FILL: [string, string] = ["#f6e2a1", "#c9a24a"];
const LEVEL_RIM = "#7a5a26";
const BADGE_INK = "#33180e";
const GLOW_INK = "#ffe9a8";

/**
 * Plates are drawn this many texture pixels to one plate pixel (which is two screen pixels), so their text is
 * smooth type in the interface's own faces rather than the bitmap font, and still sharp when shown.
 */
const RES = 4;
/** One screen pixel, in texture pixels. */
const PX = RES / 2;

const NAME_FONT = `${16 * PX}px "IM Fell English SC", "IM Fell English", Georgia, serif`;
const LEVEL_FONT = `${14 * PX}px "Pirata One", "IM Fell English", Georgia, serif`;
const SHIELD_FONT = `bold ${11 * PX}px "IM Fell English", Georgia, serif`;

/** Screen pixels: the clear border round everything (room for the outline and a glow), the bars' width and heights. */
const PAD = 3;
const BAR_W = 58;
const HP_H = 5;
const SHIELD_H = 4;
const NAME_H = 18;
const GAP = 2;
/** The little shield the shield's points are on: its size, and its gap from the bars. */
const BADGE_W = 14;
const BADGE_H = 15;
const BADGE_GAP = 3;
/** The level's medallion: round for one or two digits (this across), drawn out into a pill for more. */
const MEDAL = 18;

let plateCtx: CanvasRenderingContext2D | null = null;
/** A little air between the name's letters, in texture pixels: small capitals read better for it. */
const NAME_SPACING = `${0.6 * PX}px`;
function textWidth(text: string, font: string, spacing = "0px"): number {
  plateCtx ??= document.createElement("canvas").getContext("2d")!;
  plateCtx.font = font;
  (plateCtx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
  return Math.ceil(plateCtx.measureText(text).width);
}

let fontsReady: Promise<void> | null = null;
/**
 * Resolves once the plates' faces are loaded (at once if they are). A plate drawn before then is in the fallback
 * face, so whoever draws plates draws them again when this resolves.
 */
export function plateFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  fontsReady ??= Promise.all([NAME_FONT, LEVEL_FONT, SHIELD_FONT].map((f) => document.fonts.load(f))).then(
    () => undefined,
    () => undefined,
  );
  return fontsReady;
}

/** How many of the bar's screen pixels a share (0 to 1) fills: at least one for anything above nothing. */
const fill = (share: number, w: number) => (share > 0 ? Math.max(1, Math.round(Math.min(1, share) * w)) : 0);

/** The key a plate is cached and redrawn by: it changes only when a pixel of it would. */
export function plateKey(text: string, plate?: PlateStats, tone: PlateTone = "plain"): string {
  if (!plate) return `${tone}|${text}`;
  const hp = plate.hp !== undefined ? fill(plate.hp, BAR_W) : "";
  const shield = plate.shield ? `${fill(plate.shield, BAR_W)}/${plate.shieldPoints ?? ""}` : "";
  return `${tone}|${text}|${plate.level ?? ""}|${hp}|${shield}${plate.glow ? "|glow" : ""}`;
}

/** A heater shield's outline, `w` by `h`, top-left at (x, y): flat across the top, curving in to a point. */
function shieldPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h * 0.45);
  ctx.quadraticCurveTo(x + w, y + h * 0.85, x + w / 2, y + h);
  ctx.quadraticCurveTo(x, y + h * 0.85, x, y + h * 0.45);
  ctx.closePath();
}

/** A round-ended box `w` by `h`, top-left at (x, y): a circle when `w` is `h`. */
function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

/**
 * A plate over someone's head: no box behind it, only the name in the interface's small capitals, outlined dark so
 * it reads on any ground, in its owner's colour (see PlateTone), with a hero's level before it on a brass
 * medallion. Under it, with HP to show, a slim bar of it; a shield sits on top of that as a steel bar of its own,
 * its points on a little steel shield at the end, so it is never mistaken for HP. Everything is centred, so the
 * plate stands square over its owner. `rows` is its height in plate pixels.
 */
export function labelTexture(text: string, plate?: PlateStats, tone: PlateTone = "plain"): { texture: THREE.CanvasTexture; aspect: number; rows: number } {
  const p = plate ?? {};
  const level = p.level !== undefined ? String(p.level) : "";
  const nameW = textWidth(text, NAME_FONT, NAME_SPACING) / PX;
  const medalW = level ? Math.max(MEDAL, Math.ceil(textWidth(level, LEVEL_FONT) / PX) + 7) : 0;
  const levelW = level ? medalW + 4 : 0;
  const lineW = nameW + levelW;
  const bars = p.hp !== undefined;
  const shielded = bars && !!p.shield && p.shield > 0;
  const barsH = bars ? HP_H + (shielded ? SHIELD_H : 0) : 0;
  // The shield's badge hangs off the right of the bars; the same room is left on the left, so the bars stay centred.
  const side = shielded ? BADGE_GAP + BADGE_W : 0;
  const w = Math.ceil(Math.max(lineW, bars ? BAR_W + 2 * side : 0)) + 2 * PAD;
  const below = bars ? GAP + Math.max(barsH, shielded ? BADGE_H - 3 : 0) : 0;
  const h = PAD + NAME_H + below + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = w * PX;
  canvas.height = h * PX;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(PX, PX);
  ctx.lineJoin = "round";
  const mid = w / 2;

  // The name (and level), outlined and with a short drop shadow, on no background.
  const baseline = PAD + NAME_H - 3;
  const left = mid - lineW / 2;
  const ink = TONE_INK[tone];
  const word = (s: string, font: string, x: number, colour: string, glow = false) => {
    ctx.save();
    ctx.scale(1 / PX, 1 / PX);
    ctx.font = font;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = NAME_SPACING;
    ctx.textBaseline = "alphabetic";
    const X = x * PX;
    const Y = baseline * PX;
    ctx.lineWidth = 3 * PX;
    ctx.strokeStyle = PLATE_OUT;
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowOffsetY = PX;
    ctx.strokeText(s, X, Y);
    ctx.shadowColor = "transparent";
    if (glow) {
      ctx.shadowColor = "rgba(255, 214, 110, 0.95)";
      ctx.shadowBlur = 7 * PX;
    }
    ctx.fillStyle = colour;
    ctx.fillText(s, X, Y);
    // A second pass deepens the glow.
    if (glow) ctx.fillText(s, X, Y);
    ctx.restore();
  };
  if (level) {
    // The level on its medallion, level with the middle of the name.
    const my = PAD + (NAME_H - MEDAL) / 2 + 0.5;
    pillPath(ctx, left - 1, my - 1, medalW + 2, MEDAL + 2);
    ctx.fillStyle = PLATE_OUT;
    ctx.fill();
    pillPath(ctx, left, my, medalW, MEDAL);
    const g = ctx.createLinearGradient(0, my, 0, my + MEDAL);
    g.addColorStop(0, LEVEL_FILL[0]);
    g.addColorStop(1, LEVEL_FILL[1]);
    ctx.fillStyle = g;
    ctx.fill();
    pillPath(ctx, left + 1.5, my + 1.5, medalW - 3, MEDAL - 3);
    ctx.lineWidth = 1;
    ctx.strokeStyle = LEVEL_RIM;
    ctx.stroke();
    ctx.save();
    ctx.scale(1 / PX, 1 / PX);
    ctx.font = LEVEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = BADGE_INK;
    ctx.fillText(level, (left + medalW / 2) * PX, (my + MEDAL / 2 + 0.5) * PX);
    ctx.restore();
  }
  word(text, NAME_FONT, left + levelW, p.glow ? GLOW_INK : ink, !!p.glow);

  if (bars) {
    const x = mid - BAR_W / 2;
    const y = PAD + NAME_H + GAP;
    // One dark frame round both bars, a hair of the turn order's rim colour outside it.
    ctx.fillStyle = PLATE_OUT;
    ctx.fillRect(x - 1, y - 1, BAR_W + 2, barsH + 2);
    ctx.fillStyle = PLATE_WELL;
    ctx.fillRect(x, y, BAR_W, barsH);
    const liquid = (top: number, height: number, share: number, [lit, body]: [string, string]) => {
      const filled = fill(share, BAR_W);
      if (filled <= 0) return;
      const g = ctx.createLinearGradient(0, top, 0, top + height);
      g.addColorStop(0, lit);
      g.addColorStop(0.45, body);
      g.addColorStop(1, body);
      ctx.fillStyle = g;
      ctx.fillRect(x, top, filled, height);
    };
    if (shielded) {
      liquid(y, SHIELD_H - 1, p.shield!, SHIELD_FILL);
      // A dark line between the shield and the HP, so the two never run together.
      ctx.fillStyle = PLATE_OUT;
      ctx.fillRect(x, y + SHIELD_H - 1, BAR_W, 1);
    }
    liquid(y + (shielded ? SHIELD_H : 0), HP_H, p.hp!, HP_FILL[tone === "foe" ? "foe" : "friend"]);

    if (shielded) {
      // The shield's points, on a little steel shield at the end of the bars.
      const bx = x + BAR_W + BADGE_GAP;
      const by = y + barsH / 2 - BADGE_H / 2 + 1;
      shieldPath(ctx, bx - 1, by - 1, BADGE_W + 2, BADGE_H + 2);
      ctx.fillStyle = PLATE_OUT;
      ctx.fill();
      shieldPath(ctx, bx, by, BADGE_W, BADGE_H);
      const g = ctx.createLinearGradient(0, by, 0, by + BADGE_H);
      g.addColorStop(0, SHIELD_FILL[0]);
      g.addColorStop(1, SHIELD_FILL[1]);
      ctx.fillStyle = g;
      ctx.fill();
      const points = p.shieldPoints !== undefined ? String(Math.min(99, p.shieldPoints)) : "";
      if (points) {
        ctx.save();
        ctx.scale(1 / PX, 1 / PX);
        ctx.font = SHIELD_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = BADGE_INK;
        ctx.fillText(points, (bx + BADGE_W / 2) * PX, (by + BADGE_H * 0.44) * PX);
        ctx.restore();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { texture, aspect: canvas.width / canvas.height, rows: h / 2 };
}

// ---------- the pixel name tag (the pub's table) ----------

const PLATE_BG: [number, number, number, number] = [27, 24, 48, 225];
const NAME_INK = "#f1eee4";
/** Rows of a plain name tag: a line of text with a row of margin above and below. */
const TAG_ROWS = PIXEL_LINE_ROWS + 3;

const LABEL_FONT = "12px ui-monospace, Menlo, Consolas, monospace";
let measurer: CanvasRenderingContext2D | null = null;
function measure(text: string): number {
  if (!measurer) {
    measurer = document.createElement("canvas").getContext("2d")!;
    measurer.font = LABEL_FONT;
    (measurer as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "1px";
  }
  return Math.ceil(measurer.measureText(text).width);
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A plain name tag in the bitmap font, where it can draw the name, and the system font where it cannot: the
 * pub's table draws its players' names so, with a crate of their score beside each (TableStage.ts).
 */
export function pixelTagTexture(text: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  if (canDrawPixelText(text)) {
    canvas.width = pixelTextWidth(text) + 6;
    canvas.height = TAG_ROWS;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = `rgba(${PLATE_BG[0]}, ${PLATE_BG[1]}, ${PLATE_BG[2]}, ${PLATE_BG[3] / 255})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawPixelText(ctx, text, 3, 1, NAME_INK);
    return { texture: makeTexture(canvas), aspect: canvas.width / canvas.height };
  }
  // A name the bitmap font cannot draw: the system font, snapped to solid pixels.
  canvas.width = measure(text) + 8;
  canvas.height = 15;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = LABEL_FONT;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "1px";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, canvas.width / 2, 15 / 2 + 1);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let k = 0; k < px.length; k += 4) {
    const ink = px[k + 3] >= 96;
    px[k] = ink ? 241 : PLATE_BG[0];
    px[k + 1] = ink ? 238 : PLATE_BG[1];
    px[k + 2] = ink ? 228 : PLATE_BG[2];
    px[k + 3] = ink ? 255 : PLATE_BG[3];
  }
  ctx.putImageData(image, 0, 0);
  return { texture: makeTexture(canvas), aspect: canvas.width / canvas.height };
}


// ---------- speech bubbles ----------

const BUBBLE_FILL: [number, number, number] = [250, 246, 232];
const BUBBLE_EDGE: [number, number, number] = [27, 24, 48];
const BUBBLE_INK: [number, number, number] = [35, 31, 58];
/** Widest a line of speech may be, in pixels of text, so a bubble stays narrow on a phone. */
const BUBBLE_TEXT_WIDTH = 120;
const BUBBLE_MAX_LINES = 3;
/** Rows per line: the system font's, and the pixel font's (9 rows of glyph and 2 between lines). */
const BUBBLE_LINE_ROWS = 13;
const BUBBLE_PIXEL_LINE_ROWS = PIXEL_LINE_ROWS + 2;
/** Rows the tail hangs below the box. */
export const BUBBLE_TAIL_ROWS = 4;

/**
 * Break speech into at most three lines that fit the bubble, ending in an
 * ellipsis if it had to be cut. `width` measures a line in whichever font
 * the bubble is drawn in.
 */
export function wrapSpeech(text: string, width: (s: string) => number = measure): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let cut = false;
  const fits = (s: string) => width(s) <= BUBBLE_TEXT_WIDTH;
  for (let word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    if (fits(tryLine)) {
      line = tryLine;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
      if (lines.length === BUBBLE_MAX_LINES) {
        cut = true;
        break;
      }
    }
    // A word too long for a line on its own is broken wherever it runs out of room.
    while (!fits(word)) {
      let n = word.length - 1;
      while (n > 1 && !fits(word.slice(0, n))) n--;
      lines.push(word.slice(0, n));
      word = word.slice(n);
      if (lines.length === BUBBLE_MAX_LINES) {
        cut = true;
        break;
      }
    }
    if (cut) break;
    line = word;
  }
  if (!cut && line) lines.push(line);
  if (cut && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines.length > 0 ? lines : ["…"];
}

/**
 * A speech bubble: pale, with a one-pixel dark outline, clipped corners and a
 * tail at the bottom middle pointing down at the speaker. The text is drawn as
 * text on a canvas (never markup): in the bitmap font the plates use, or, for
 * speech it has no glyphs for (an emoji, another script), in the system font
 * snapped to solid pixels.
 */
export function bubbleTexture(text: string): { texture: THREE.CanvasTexture; width: number; rows: number } {
  // The ellipsis a cut line ends with is in the bitmap font too, so the check is on the speech itself.
  const pixel = canDrawPixelText(text);
  const lineWidth = pixel ? pixelTextWidth : measure;
  const lines = wrapSpeech(text, lineWidth);
  const textW = Math.max(...lines.map(lineWidth));
  const width = Math.max(16, textW + 10);
  const lineRows = pixel ? BUBBLE_PIXEL_LINE_ROWS : BUBBLE_LINE_ROWS;
  // Pixel font: outline, a row of margin, the lines, a row of margin, outline.
  const box = pixel ? lines.length * lineRows + 2 : lines.length * lineRows + 4;
  const rows = box + BUBBLE_TAIL_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const left = Math.floor((width - textW) / 2);
  if (pixel) {
    lines.forEach((line, i) => drawPixelText(ctx, line, left, 2 + i * lineRows, "#ffffff"));
  } else {
    ctx.font = LABEL_FONT;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "1px";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    lines.forEach((line, i) => ctx.fillText(line, left, 2 + i * lineRows + lineRows / 2 + 1));
  }
  const image = ctx.getImageData(0, 0, width, rows);
  const px = image.data;
  const mid = Math.floor(width / 2);
  // What each pixel is: outside, edge, or inside the bubble (box with clipped corners, plus the tail).
  const shape = (x: number, y: number): 0 | 1 | 2 => {
    if (y < box) {
      const sideX = x === 0 || x === width - 1;
      const sideY = y === 0 || y === box - 1;
      // Corners are clipped, and the pixel diagonally inside each one is outline, so they read as round.
      if (sideX && sideY) return 0;
      if ((x === 1 || x === width - 2) && (y === 1 || y === box - 2)) return 1;
      // The outline is open where the tail joins the box.
      if (y === box - 1 && Math.abs(x - mid) <= 2) return 2;
      return sideX || sideY ? 1 : 2;
    }
    // The tail narrows a pixel each row to a point.
    const t = y - box;
    const half = 2 - t;
    if (half < 0) return x === mid ? 1 : 0;
    if (x === mid - half - 1 || x === mid + half + 1) return 1;
    if (x >= mid - half && x <= mid + half) return 2;
    return 0;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const ink = px[k + 3] >= 96;
      const s = shape(x, y);
      const colour = s === 0 ? null : s === 1 ? BUBBLE_EDGE : ink ? BUBBLE_INK : BUBBLE_FILL;
      px[k] = colour?.[0] ?? 0;
      px[k + 1] = colour?.[1] ?? 0;
      px[k + 2] = colour?.[2] ?? 0;
      px[k + 3] = colour ? 255 : 0;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, width, rows };
}

// ---------- battle effects ----------

export type FxKind = "slash" | "bolt" | "arrow" | "burst" | "spark" | "mote" | "dust" | "fleck" | "splash" | "rock" | "note" | "notes" | "bang" | "streak";

const fxCache = new Map<string, THREE.CanvasTexture>();

/**
 * A small pixel effect in one colour: a crescent swipe, a spell bolt, an
 * arrow, an impact burst, or healing sparkles. `flip` mirrors it for
 * attacks travelling right to left.
 */
export function fxTexture(kind: FxKind, color: string, flip = false): THREE.CanvasTexture {
  const key = `${kind}|${color}|${flip}`;
  const hit = fxCache.get(key);
  if (hit) return hit;
  const N = 16;
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d")!;
  const dot = (x: number, y: number, c = color) => {
    ctx.fillStyle = c;
    ctx.fillRect(flip ? N - 1 - x : x, y, 1, 1);
  };
  if (kind === "slash") {
    // A crescent sweeping from upper left round to lower right, thickest in the middle.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x - 2.5;
        const dy = y - 13.5;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(-dy, dx);
        if (a < 0.05 || a > 1.5) continue;
        const width = 0.6 + 2.6 * Math.sin(((a - 0.05) / 1.45) * Math.PI);
        if (Math.abs(d - 11) <= width / 2 + 0.3) dot(x, y, Math.abs(d - 11.4) < 0.7 ? "#ffffff" : color);
      }
    }
  } else if (kind === "bolt") {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - 9.5, y - 7.5);
      if (d < 3.6) dot(x, y, d < 1.8 ? "#ffffff" : color);
    }
    // A short trail behind it.
    for (let x = 1; x < 6; x++) if (x % 2) dot(x, 7);
    dot(3, 9);
    dot(4, 5);
  } else if (kind === "arrow") {
    for (let x = 2; x < 12; x++) dot(x, 8, "#e8dcc0");
    dot(12, 8);
    dot(13, 8);
    dot(11, 7);
    dot(11, 9);
    dot(12, 7);
    dot(12, 9);
    dot(2, 7, "#ffffff");
    dot(2, 9, "#ffffff");
    dot(3, 7, "#ffffff");
    dot(3, 9, "#ffffff");
  } else if (kind === "burst") {
    for (let i = 2; i < 7; i++) {
      dot(8 + i, 8);
      dot(7 - i, 8);
      dot(8, 8 + i - 1);
      dot(8, 7 - i + 1);
    }
    for (let i = 2; i < 5; i++) {
      dot(8 + i, 8 + i);
      dot(7 - i, 7 - i);
      dot(8 + i, 7 - i);
      dot(7 - i, 8 + i);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(7, 7, 2, 2);
  } else if (kind === "streak") {
    // A speed line, for something going fast to the right: long and thin, white at its head and thinning to a
    // broken tail behind.
    for (let x = 1; x < 15; x++) {
      if (x < 5 && x % 2) continue;
      dot(x, 8, x >= 11 ? "#ffffff" : color);
    }
    for (let x = 8; x < 14; x++) dot(x, 7, x >= 12 ? "#ffffff" : color);
  } else if (kind === "dust") {
    // A footfall's puff: a lumpy little cloud, paler at the top, with a speck thrown off each side.
    for (const [x, y, w] of [[6, 7, 3], [5, 8, 6], [4, 9, 8], [5, 10, 6]] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, 1);
    }
    dot(7, 7, "#ffffff");
    dot(2, 9);
    dot(13, 8);
  } else if (kind === "fleck") {
    // Grass kicked up: short blades, each a bright tip over a dark root so they read against the grass.
    for (const [x, y] of [[3, 9], [5, 7], [8, 8], [10, 6], [12, 8], [6, 10]] as const) {
      dot(x, y);
      dot(x, y + 1, "#3f7a2c");
    }
    dot(4, 8, "#3f7a2c");
    dot(11, 7);
  } else if (kind === "splash") {
    // A splash: drops flung up and out from a flat ring.
    for (let x = 4; x < 12; x++) dot(x, 11);
    dot(3, 10);
    dot(12, 10);
    for (const [x, y] of [[4, 7], [3, 5], [11, 7], [12, 5], [7, 6], [8, 4]] as const) dot(x, y);
    dot(8, 5, "#ffffff");
  } else if (kind === "rock") {
    // A thrown stone: a lumpy rock, dark round its edge and lit across its top.
    const edge = "#2f2b33";
    for (const [x, y, w] of [[6, 4, 4], [5, 5, 6], [4, 6, 8], [4, 7, 8], [4, 8, 8], [5, 9, 7], [6, 10, 4]] as const) {
      for (let i = 0; i < w; i++) dot(x + i, y, i === 0 || i === w - 1 || y === 4 || y === 10 ? edge : color);
    }
    for (const [x, y] of [[6, 5], [7, 5], [5, 6]] as const) dot(x, y, "#b9b3a6");
    dot(9, 9, "#4a4650");
    dot(10, 8, "#4a4650");
  } else if (kind === "bang") {
    // An exclamation mark, the colour with a dark line round it: a challenge taken up (Taunted).
    const filled = new Set<string>();
    for (let y = 2; y <= 9; y++) for (const x of [7, 8]) filled.add(`${x},${y}`);
    for (const x of [6, 9]) for (let y = 3; y <= 6; y++) filled.add(`${x},${y}`);
    for (let y = 11; y <= 12; y++) for (const x of [7, 8]) filled.add(`${x},${y}`);
    const edge = "#1b1830";
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (filled.has(`${x},${y}`)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled.has(`${x + dx},${y + dy}`))) dot(x, y, edge);
      }
    }
    for (const key of filled) {
      const [x, y] = key.split(",").map(Number);
      dot(x, y);
    }
    dot(7, 3, "#ffffff");
  } else if (kind === "note" || kind === "notes") {
    // A music note (a quaver, or two beamed together), in the colour with a dark line round it and a glint on
    // each head, so it reads over grass, water or a dark cave alike.
    const filled = new Set<string>();
    const put = (x: number, y: number) => filled.add(`${x},${y}`);
    const head = (x: number, y: number) => {
      for (const [dx, dy] of [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2]] as const) put(x + dx, y + dy);
    };
    if (kind === "note") {
      head(4, 10);
      for (let y = 3; y <= 11; y++) put(7, y);
      for (const [x, y] of [[8, 3], [9, 4], [10, 5], [10, 6], [9, 7]] as const) put(x, y);
    } else {
      head(2, 11);
      head(8, 10);
      for (let y = 4; y <= 12; y++) put(5, y);
      for (let y = 3; y <= 11; y++) put(11, y);
      for (let x = 5; x <= 11; x++) {
        put(x, 3);
        put(x, 4);
      }
    }
    const edge = "#1b1830";
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (filled.has(`${x},${y}`)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled.has(`${x + dx},${y + dy}`))) dot(x, y, edge);
      }
    }
    for (const key of filled) {
      const [x, y] = key.split(",").map(Number);
      dot(x, y);
    }
    if (kind === "note") dot(5, 11, "#ffffff");
    else {
      dot(3, 12, "#ffffff");
      dot(9, 11, "#ffffff");
    }
  } else if (kind === "mote") {
    // One XP mote: a solid 4x4 pixel, a white glint in its corner, in the middle of the tile.
    ctx.fillStyle = color;
    ctx.fillRect(6, 6, 4, 4);
    dot(6, 6, "#ffffff");
  } else {
    for (const [cx, cy] of [[4, 4], [11, 6], [6, 11], [12, 12]]) {
      dot(cx, cy, "#ffffff");
      dot(cx - 1, cy);
      dot(cx + 1, cy);
      dot(cx, cy - 1);
      dot(cx, cy + 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  fxCache.set(key, tex);
  return tex;
}

// ---------- status badges ----------

/** A condition on a unit, as its badge shows it: what it is, its colour, and rounds left. */
export interface Badge {
  kind: string;
  color: string;
  rounds: number;
  /** For a condition that comes in stacks (Burning, Drowning), how many, when there is more than one. */
  stacks?: number;
}

/** A small pixel glyph for each condition, 7 by 7, "#" lit. */
const GLYPHS: Record<string, string[]> = {
  // The alarm bell: an enemy sent to ring it.
  bell: ["...#...", "..###..", "..###..", ".#####.", ".#####.", "#######", "...#..."],
  bleeding: ["...#...", "...#...", "..###..", ".#####.", ".#####.", ".#####.", "..###.."],
  burning: ["...#...", "..##...", "..###..", ".####.#", ".######", ".#####.", "..###.."],
  stunned: ["#.....#", ".#...#.", "...#...", "..###..", "...#...", ".#...#.", "#.....#"],
  guarded: [".#####.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."],
  taunting: ["...#...", "..###..", "..###..", "...#...", "...#...", ".......", "...#..."],
  slowed: ["...#...", "...#...", "...#...", "#..#..#", ".#.#.#.", "..###..", "...#..."],
  hasted: ["...#...", "..###..", ".#.#.#.", "#..#..#", "...#...", "...#...", "...#..."],
  glitched: ["#..#...", ".#.#.#.", "..#.#..", ".#...#.", "#.#...#", "...#.#.", "....#.."],
  exposed: ["..###..", ".#...#.", "#..#..#", "#.###.#", "#..#..#", ".#...#.", "..###.."],
  sundered: ["#.#.#.#", "#######", "#..#..#", "##.#.##", "#..#..#", "#######", ".#.#.#."],
  poisoned: ["..###..", ".#####.", "##.#.##", ".#####.", "..#.#..", ".......", ".#.#.#."],
  prone: [".......", ".......", "##.....", "#######", "#######", ".......", "......."],
  tailwind: ["##.....", "..#.##.", "##.#..#", "....##.", ".###...", "#...#..", ".###..."],
  wet: ["..#....", ".###...", ".###.#.", "..#.###", "....###", ".....#.", "......."],
  beacon: ["#..#..#", ".#.#.#.", "..###..", "###.###", "..###..", ".#.#.#.", "#..#..#"],
  mending: ["..###..", "..#.#..", "###.###", "#.....#", "###.###", "..#.#..", "..###.."],
  bolstered: ["#######", "#.....#", "#.###.#", "#.###.#", ".#.#.#.", "..#.#..", "...#..."],
  invisible: ["..###..", ".#...#.", "#.#.#.#", "#.....#", "#.....#", "#.#.#.#", ".#.#.#."],
  contraband: ["...##..", "..#....", ".#####.", "#######", "#######", "#######", ".#####."],
  regenerating: ["...#...", "..###..", ".#####.", ".##.##.", "##...##", ".#...#.", "..###.."],
  rallied: ["..#.#..", ".#####.", "#######", ".#####.", "..###..", "...#...", "...#..."],
  rejuvenating: ["..#.#..", ".#####.", ".#####.", "..###..", "...#...", "..###..", ".#...#."],
  lively_shanty: ["...##..", "...#.#.", "...#..#", "...#...", ".###...", "####...", ".##...."],
  dour_shanty: ["....##.", "....#.#", "....#..", "....#..", "..###..", ".####..", "..##..."],
  windgod_shanty: ["#####..", "......#", "####..#", "....##.", "######.", "......#", "#####.."],
  inspired: ["...#...", "...#...", "#######", ".#####.", "..###..", ".##.##.", "#.....#"],
  guiding_light: ["...#...", ".#.#.#.", "..###..", "#######", "..###..", ".#.#.#.", "...#..."],
  north_star: ["...#...", "...#...", "..###..", "#######", "..###..", "...#...", "...#..."],
  taunted: ["##...##", "#.#.#.#", "...#...", ".#####.", "#.....#", ".......", "..###.."],
  charted: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
  // The Warlock's: bubbles rising off a sinking head; a hand reaching up out of the waves; a black spot on a scrap of paper; a red sun on the sea.
  drowning: [".#...#.", "....#..", ".#.....", "..###..", ".#####.", "#.#.#.#", ".#.#.#."],
  drowning_curse: ["..#.#..", "..#.#.#", "..#####", "..####.", "...###.", "#.#.#.#", ".#.#.#."],
  black_spot: ["#######", "#.....#", "#.###.#", "#.###.#", "#.###.#", "#.....#", "#######"],
  red_sky: ["..###..", ".#####.", "#######", ".......", "#######", ".......", "##.##.#"],
  coral_armor: ["#..#..#", "#.##.##", ".##.##.", "..###..", "#..#..#", ".###.#.", "..##..."],
};

/** The key a badge row is drawn for, to know when it has changed. */
export const badgesKey = (badges: readonly Badge[]): string => badges.map((b) => `${b.kind}:${b.rounds}:${b.stacks ?? 1}`).join(",");

/**
 * A row of status badges: each a dark square edged and tinted in the condition's colour, its glyph in that
 * colour, how many rounds it has left in the bottom corner, and its stacks (if more than one) in the top one. Drawn crisp, like the plates.
 */
export function badgeTexture(badges: readonly Badge[]): { texture: THREE.CanvasTexture; aspect: number } {
  const SIZE = 22;
  const GAP = 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, badges.length * (SIZE + GAP) - GAP);
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  badges.forEach((b, i) => {
    const x = i * (SIZE + GAP);
    ctx.fillStyle = "#1c0d0e";
    ctx.fillRect(x, 0, SIZE, SIZE);
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x + 1, 1, SIZE - 2, SIZE - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, 1, SIZE - 2, SIZE - 2);
    const glyph = GLYPHS[b.kind] ?? GLYPHS.exposed;
    ctx.fillStyle = b.color;
    glyph.forEach((row, y) => [...row].forEach((c, gx) => c === "#" && ctx.fillRect(x + 3 + gx * 2, 3 + y * 2, 2, 2)));
    if (b.rounds > 0) {
      ctx.font = "bold 9px ui-monospace, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#1c0d0e";
      ctx.strokeText(String(b.rounds), x + SIZE - 1, SIZE);
      ctx.fillStyle = "#fbe6c8";
      ctx.fillText(String(b.rounds), x + SIZE - 1, SIZE);
    }
    if ((b.stacks ?? 1) > 1) {
      ctx.font = "bold 9px ui-monospace, Menlo, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#14101f";
      ctx.strokeText(`×${b.stacks}`, x + 1, 0);
      ctx.fillStyle = b.color;
      ctx.fillText(`×${b.stacks}`, x + 1, 0);
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}
