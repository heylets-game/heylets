// The engine's built-in sounds: footsteps, combat and the pub's tables, made from filtered noise
// and simple tones with the Web Audio API, so the game has sound before a
// single file is recorded or encoded. They were the game's only sounds before
// this engine; here they are rendered once each into buffers, in a few takes,
// and from then on they are ordinary files to the engine: mixed, placed,
// reverberated and limited like any recording.
//
// They are listed in the library's index as `synth/...` keys. A manifest event
// names them in `fallback`: a real recording in `files` wins when there is one,
// and a placeholder never beats them.

import type { AudioFile } from "./types";

/** What a footstep lands on, as far as its sound goes. */
export type SynthGround = "grass" | "stone" | "wood" | "floor" | "mud" | "water";

/** Every built-in combat sound. */
export type SynthCombat =
  | "blade" | "blunt" | "swing" | "arrow_loose" | "arrow_hit" | "spell_cast" | "spell_hit" | "zap" | "crit" | "crit_blade" | "crack"
  | "whiff" | "fizzle"
  | "heal" | "heal_fail"
  | "bleed" | "burn" | "stun" | "buff" | "debuff"
  | "hero_down" | "enemy_down" | "boss_down"
  | "boss" | "victory" | "defeat" | "your_turn"
  // A fight on the tiles: the dice, the fight starting, whose turn it is, and what the tiles add.
  | "dice" | "initiative" | "enemy_turn" | "opportunity"
  | "shove" | "fall" | "jump" | "throw" | "shatter"
  | "ignite" | "poison" | "splash" | "oil" | "ice"
  | "sick" | "soak"
  // A delve: a chest's lid creaking open, a crate taking a blow, and a crate breaking apart.
  | "creak" | "knock" | "splinter"
  // The alarm bell on an open map, rung by an enemy to rouse the rest.
  | "alarm"
  // A Pack Leader's Howl, calling its pack on.
  | "howl"
  // A Guardian channelling its Slowing Field: a hum building up through it, and let go.
  | "channel"
  // A Shade's Wail, a ghost's scream; and its Chill Touch, a cold breath and a frost settling.
  | "wail" | "chill"
  // A Skeleton's Memento Mori: bones clattering as it twitches, over a low, sour drone, and a dark rush as it goes out.
  | "rattle"
  // A Haunt's Ghastly Fetter: a chain of iron jingling, paid out link after link, and a stake clanking home.
  | "chains"
  // Words typed out in a conversation, a short soft note a letter.
  | "blip";

/** The pub's game tables: the dice cup, dice on the felt, and the pot. */
export type SynthTable = "shake" | "tumble" | "settle" | "hold" | "coins";

/** How many takes of each: steps vary most, stings least. */
const STEP_TAKES = 6;
const COMBAT_TAKES = 4;
const STING_TAKES = 2;
const TABLE_TAKES = 4;
const TABLE_LENGTH: Record<SynthTable, number> = { shake: 0.5, tumble: 0.75, settle: 0.12, hold: 0.18, coins: 0.7 };
const STINGS: ReadonlySet<SynthCombat> = new Set(["boss", "victory", "defeat", "boss_down", "initiative"]);

const SAMPLE_RATE = 44100;

/**
 * How each ground sounds: a burst of filtered noise (`filter`, around `freq`, ringing by `q`)
 * dying away over `decay` seconds, and for boards a low knock under it.
 */
const STEP: Record<SynthGround, { filter: BiquadFilterType; freq: number; q: number; decay: number; gain: number; knock?: number }> = {
  grass: { filter: "bandpass", freq: 1100, q: 0.6, decay: 0.09, gain: 0.5 },
  stone: { filter: "highpass", freq: 2200, q: 1.4, decay: 0.035, gain: 0.55 },
  wood: { filter: "bandpass", freq: 700, q: 1.6, decay: 0.06, gain: 0.5, knock: 150 },
  floor: { filter: "bandpass", freq: 650, q: 1.6, decay: 0.06, gain: 0.45, knock: 135 },
  mud: { filter: "lowpass", freq: 380, q: 1.0, decay: 0.12, gain: 0.75 },
  water: { filter: "bandpass", freq: 1500, q: 2.5, decay: 0.15, gain: 0.45 },
};

/** How long each sound runs, so the offline render is no longer than it needs to be. */
const COMBAT_LENGTH: Record<SynthCombat, number> = {
  blade: 0.45, blunt: 0.4, swing: 0.28, arrow_loose: 0.4, arrow_hit: 0.3, spell_cast: 0.5, spell_hit: 0.55, zap: 0.6, crit: 1.0, crit_blade: 2.5, crack: 0.45,
  whiff: 0.25, fizzle: 0.25,
  heal: 0.8, heal_fail: 0.3,
  bleed: 0.15, burn: 0.35, stun: 0.35, buff: 0.3, debuff: 0.3,
  hero_down: 0.8, enemy_down: 0.5, boss_down: 1.0,
  boss: 2.0, victory: 1.1, defeat: 1.2, your_turn: 0.4,
  dice: 0.55, initiative: 1.5, enemy_turn: 0.3, opportunity: 0.4,
  shove: 0.35, fall: 0.45, jump: 0.5, throw: 0.35, shatter: 0.5,
  ignite: 0.7, poison: 0.7, splash: 0.5, oil: 0.45, ice: 0.6,
  sick: 0.4, soak: 0.35,
  creak: 0.8, knock: 0.3, splinter: 0.9,
  alarm: 4.8,
  howl: 1.9,
  channel: 2.3,
  wail: 1.6,
  chill: 0.8,
  rattle: 2.1,
  chains: 1.7,
  blip: 0.09,
};

/** Notes of a few bright chords, so heals and stings are not always the same three notes. */
const CHORDS = [[1047, 1319, 1568], [988, 1245, 1480], [1175, 1480, 1760], [932, 1175, 1397]];

/** A small seeded generator, so each take is the same take every time it is rendered. */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything one render needs: its context, where sound goes, a slice of noise and the take's dice. */
interface Render {
  ctx: OfflineAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
  rnd: () => number;
}

const wobble = (r: Render, spread: number) => 1 + (r.rnd() * 2 - 1) * spread;

/** A burst of filtered noise from `at`, its filter sliding from `freq` to `freqTo`, rising over `attack` and dying over `decay`. */
function noiseAt(r: Render, at: number, o: { filter: BiquadFilterType; freq: number; freqTo?: number; q?: number; attack?: number; decay: number; gain: number }) {
  const { ctx } = r;
  const src = ctx.createBufferSource();
  src.buffer = r.noise;
  src.playbackRate.value = wobble(r, 0.1);
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, at);
  const attack = o.attack ?? 0.004;
  if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, at + attack + o.decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + attack + o.decay);
  src.connect(f).connect(env).connect(r.out);
  const length = attack + o.decay + 0.02;
  // The noise is a quarter second: longer sounds loop it.
  src.loop = length > 0.2;
  src.start(at, r.rnd() * 0.05);
  src.stop(at + length);
}

/** A pitched note from `at`, gliding from `freq` to `freqTo`, through a low-pass at `cut` when given. */
function toneAt(r: Render, at: number, o: { type: OscillatorType; freq: number; freqTo?: number; attack?: number; decay: number; gain: number; cut?: number }) {
  const { ctx } = r;
  const osc = ctx.createOscillator();
  osc.type = o.type;
  const attack = o.attack ?? 0.005;
  osc.frequency.setValueAtTime(o.freq, at);
  if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo, at + attack + o.decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + attack + o.decay);
  let out: AudioNode = osc;
  if (o.cut) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.cut;
    out = osc.connect(f);
  }
  out.connect(env).connect(r.out);
  osc.start(at);
  osc.stop(at + attack + o.decay + 0.02);
}

/** One footstep on `ground`. Odd takes are the other foot, pitched a touch apart. */
function step(r: Render, ground: SynthGround, take: number) {
  const look = STEP[ground];
  const pitch = (take % 2 ? 0.94 : 1.06) * wobble(r, 0.08);
  const peak = look.gain * wobble(r, 0.15);
  const decay = look.decay * wobble(r, 0.2);
  noiseAt(r, 0.002, { filter: look.filter, freq: look.freq * wobble(r, 0.18), q: look.q, decay, gain: peak });
  if (look.knock) toneAt(r, 0.002, { type: "sine", freq: look.knock * pitch, freqTo: look.knock * pitch * 0.6, decay: 0.07, gain: peak * 0.9 });
}

/** One combat sound. Takes differ in pitch, level and (for heals and stings) chord. */
function combat(r: Render, sound: SynthCombat) {
  const v = 0.8 * wobble(r, 0.12);
  const p = wobble(r, 0.07);
  const t = 0.005;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r.rnd() * xs.length)];
  switch (sound) {
    case "blade":
      // A bright bite, and the steel ringing after it: two partials that do not agree, as struck metal has.
      noiseAt(r, t, { filter: "highpass", freq: 2600 * p, q: 1.5, decay: 0.05, gain: v * 0.7 });
      toneAt(r, t, { type: "square", freq: 820 * p, freqTo: 560 * p, decay: 0.05, gain: v * 0.12, cut: 2400 });
      toneAt(r, t, { type: "sine", freq: 170 * p, freqTo: 90, decay: 0.09, gain: v * 0.6 });
      toneAt(r, t + 0.01, { type: "sine", freq: 2150 * p, decay: 0.26, gain: v * 0.1 });
      toneAt(r, t + 0.01, { type: "sine", freq: 3380 * p, decay: 0.18, gain: v * 0.06 });
      break;
    case "blunt":
      // A heavy thump with a little grit, and a knock on top so it is felt as well as heard.
      toneAt(r, t, { type: "sine", freq: 120 * p, freqTo: 50, decay: 0.16, gain: v * 1.1 });
      toneAt(r, t, { type: "sine", freq: 62 * p, freqTo: 38, decay: 0.24, gain: v * 0.7 });
      noiseAt(r, t, { filter: "lowpass", freq: 600 * p, q: 0.9, decay: 0.09, gain: v * 0.8 });
      noiseAt(r, t, { filter: "bandpass", freq: 1900 * p, q: 2, decay: 0.02, gain: v * 0.4 });
      break;
    case "swing":
      // A swish through the air as a hand weapon comes round: it rises, then falls away past you.
      noiseAt(r, t, { filter: "bandpass", freq: 700 * p, freqTo: 3200 * p, q: 1.2, attack: 0.04, decay: 0.07, gain: v * 0.55 });
      noiseAt(r, t + 0.09, { filter: "bandpass", freq: 2600 * p, freqTo: 600 * p, q: 1.2, attack: 0.01, decay: 0.12, gain: v * 0.3 });
      break;
    case "arrow_loose":
      // The bowstring's twang, and the arrow hissing off.
      toneAt(r, t, { type: "triangle", freq: 330 * p, freqTo: 300 * p, decay: 0.16, gain: v * 0.45 });
      noiseAt(r, t, { filter: "bandpass", freq: 2000 * p, q: 2, decay: 0.03, gain: v * 0.35 });
      noiseAt(r, t + 0.03, { filter: "bandpass", freq: 4200 * p, freqTo: 1800 * p, q: 2.5, attack: 0.02, decay: 0.24, gain: v * 0.22 });
      break;
    case "arrow_hit":
      // The thunk of it going in, and the shaft quivering.
      noiseAt(r, t, { filter: "lowpass", freq: 1100 * p, q: 1.2, decay: 0.05, gain: v * 0.8 });
      toneAt(r, t, { type: "sine", freq: 240 * p, freqTo: 120, decay: 0.07, gain: v * 0.7 });
      toneAt(r, t + 0.02, { type: "triangle", freq: 520 * p, freqTo: 470 * p, decay: 0.2, gain: v * 0.12 });
      break;
    case "spell_cast":
      // Gathering, then let go: a whoosh that climbs, with a note climbing inside it.
      noiseAt(r, t, { filter: "bandpass", freq: 350 * p, freqTo: 1900 * p, q: 3, attack: 0.16, decay: 0.2, gain: v * 0.5 });
      toneAt(r, t, { type: "sine", freq: 220 * p, freqTo: 880 * p, attack: 0.18, decay: 0.2, gain: v * 0.18 });
      toneAt(r, t, { type: "sine", freq: 331 * p, freqTo: 1320 * p, attack: 0.18, decay: 0.18, gain: v * 0.1 });
      break;
    case "spell_hit":
      // A zap, a low punch under it, and sparks falling away after.
      toneAt(r, t, { type: "sawtooth", freq: 1400 * p, freqTo: 180 * p, decay: 0.13, gain: v * 0.35, cut: 3000 });
      noiseAt(r, t, { filter: "highpass", freq: 1800 * p, q: 0.8, decay: 0.08, gain: v * 0.5 });
      toneAt(r, t, { type: "sine", freq: 110 * p, freqTo: 48, decay: 0.2, gain: v * 0.7 });
      for (let i = 0; i < 4; i++) toneAt(r, t + 0.08 + r.rnd() * 0.3, { type: "sine", freq: 1800 + r.rnd() * 2400, decay: 0.05, gain: v * 0.08 });
      break;
    case "zap":
      // Lightning landing: a white crack, a buzzing sizzle dropping away, a low punch under it, and crackles after.
      noiseAt(r, t, { filter: "highpass", freq: 4200 * p, q: 0.9, decay: 0.035, gain: v * 0.8 });
      toneAt(r, t, { type: "sawtooth", freq: 2400 * p, freqTo: 260 * p, decay: 0.2, gain: v * 0.3, cut: 4500 });
      toneAt(r, t, { type: "square", freq: 92 * p, freqTo: 70 * p, decay: 0.28, gain: v * 0.16, cut: 1800 });
      toneAt(r, t, { type: "sine", freq: 100 * p, freqTo: 42, decay: 0.22, gain: v * 0.6 });
      for (let i = 0; i < 9; i++) noiseAt(r, t + 0.03 + r.rnd() * 0.4, { filter: "bandpass", freq: 2500 + r.rnd() * 3500, q: 2, decay: 0.012 + r.rnd() * 0.015, gain: v * (0.35 - i * 0.025) });
      break;
    case "crit": {
      // Laid over a critical hit, and meant to be noticed: a white crack, a deep punch with a boom under it,
      // a blade's "shing" sweeping up into a long steel ring, a bright chord flaring over it, and sparks after.
      noiseAt(r, t, { filter: "highpass", freq: 3600 * p, q: 1.2, decay: 0.05, gain: v * 0.9 });
      noiseAt(r, t, { filter: "lowpass", freq: 900 * p, q: 0.8, decay: 0.12, gain: v * 0.9 });
      toneAt(r, t, { type: "sine", freq: 150 * p, freqTo: 34, decay: 0.42, gain: v * 1.1 });
      toneAt(r, t, { type: "triangle", freq: 75 * p, freqTo: 30, decay: 0.6, gain: v * 0.5 });
      toneAt(r, t + 0.01, { type: "sawtooth", freq: 1100 * p, freqTo: 4200 * p, attack: 0.002, decay: 0.09, gain: v * 0.22, cut: 7000 });
      noiseAt(r, t + 0.01, { filter: "bandpass", freq: 2500 * p, freqTo: 8000 * p, q: 3, decay: 0.14, gain: v * 0.4 });
      // The steel ringing: partials that do not agree, as struck metal has, each in two voices a hair apart so it shimmers.
      for (const [f, g, d] of [[2637, 0.14, 0.85], [3951, 0.09, 0.7], [5274, 0.06, 0.55], [1760, 0.07, 0.9]] as const)
        for (const detune of [1, 1.004]) toneAt(r, t + 0.03, { type: "sine", freq: f * p * detune, decay: d, gain: v * g });
      // The flare: a major chord high up, swelling in fast and fading slow.
      for (const f of [1568, 1976, 2349, 3136]) toneAt(r, t + 0.04, { type: "triangle", freq: f * p, attack: 0.02, decay: 0.7, gain: v * 0.06 });
      // Sparks flying off: quick high pings scattered over the ring, falling away.
      for (let i = 0; i < 12; i++) toneAt(r, t + 0.06 + i * 0.05 + r.rnd() * 0.04, { type: "sine", freq: 3000 + r.rnd() * 4500, decay: 0.03 + r.rnd() * 0.04, gain: v * (0.16 - i * 0.011) });
      break;
    }
    case "crit_blade": {
      // An enemy's critical hit: a classic fantasy-game slash, an executioner's blow. A quick whoosh rushes in
      // (kept short, as the blow has already landed), and at contact: a sharp crack, the blade's shing ringing with
      // two notes beating against each other, the slash tearing on through, and under it all a heavy chunk with a
      // drop into the floor: a thud, short and dead. Over it the blade goes on ringing a long while: the shing's two
      // notes, and a lower pair that beats slower and lasts the longest, so the tail sinks as it fades.
      const h = t + 0.05;
      noiseAt(r, t, { filter: "bandpass", freq: 500 * p, freqTo: 2600 * p, q: 1.2, attack: 0.045, decay: 0.03, gain: v * 0.55 });
      noiseAt(r, h, { filter: "highpass", freq: 5000 * p, q: 0.8, decay: 0.02, gain: v * 1.0 });
      toneAt(r, h, { type: "sawtooth", freq: 1200 * p, freqTo: 5200 * p, attack: 0.002, decay: 0.05, gain: v * 0.3, cut: 9000 });
      toneAt(r, h + 0.01, { type: "sine", freq: 3520 * p, decay: 1.8, gain: v * 0.12 });
      toneAt(r, h + 0.01, { type: "sine", freq: 3541 * p, decay: 1.8, gain: v * 0.12 });
      toneAt(r, h + 0.01, { type: "sine", freq: 5280 * p, decay: 0.9, gain: v * 0.06 });
      toneAt(r, h + 0.02, { type: "sine", freq: 1760 * p, decay: 2.3, gain: v * 0.08 });
      toneAt(r, h + 0.02, { type: "sine", freq: 1766 * p, decay: 2.3, gain: v * 0.08 });
      noiseAt(r, h + 0.01, { filter: "bandpass", freq: 6000 * p, freqTo: 900 * p, q: 1.5, decay: 0.22, gain: v * 0.8 });
      toneAt(r, h, { type: "sine", freq: 110 * p, freqTo: 40, decay: 0.18, gain: v * 1.4 });
      noiseAt(r, h, { filter: "lowpass", freq: 500 * p, q: 1, decay: 0.2, gain: v * 1.1 });
      toneAt(r, h, { type: "triangle", freq: 220 * p, freqTo: 90, decay: 0.12, gain: v * 0.4 });
      noiseAt(r, h + 0.005, { filter: "bandpass", freq: 1600 * p, q: 2, decay: 0.04, gain: v * 0.5 });
      noiseAt(r, h + 0.01, { filter: "lowpass", freq: 260 * p, q: 0.5, decay: 0.12, gain: v * 0.6 });
      break;
    }
    case "crack":
      // A sharp crack, a drop in the floor, and a little ring after (a heavy pick blow, a fishing line snapping).
      noiseAt(r, t, { filter: "highpass", freq: 3200 * p, q: 1.8, decay: 0.04, gain: v * 0.6 });
      toneAt(r, t, { type: "sine", freq: 95 * p, freqTo: 40, decay: 0.28, gain: v * 0.9 });
      toneAt(r, t + 0.02, { type: "sine", freq: 2637 * p, decay: 0.34, gain: v * 0.1 });
      toneAt(r, t + 0.02, { type: "sine", freq: 3951 * p, decay: 0.26, gain: v * 0.06 });
      break;
    case "whiff":
      // Cutting nothing but air.
      noiseAt(r, t, { filter: "bandpass", freq: 1600 * p, freqTo: 500 * p, q: 1.4, attack: 0.02, decay: 0.12, gain: v * 0.45 });
      break;
    case "fizzle":
      toneAt(r, t, { type: "sine", freq: 620 * p, freqTo: 260 * p, decay: 0.12, gain: v * 0.35 });
      noiseAt(r, t, { filter: "highpass", freq: 3000, decay: 0.1, gain: v * 0.15 });
      break;
    case "heal":
      // A soft rising chime, a different chord each take.
      pick(CHORDS).forEach((f, i) => toneAt(r, t + i * 0.06, { type: "sine", freq: f, attack: 0.01, decay: 0.32, gain: v * 0.35 }));
      break;
    case "heal_fail":
      toneAt(r, t, { type: "triangle", freq: 330 * p, freqTo: 220 * p, decay: 0.18, gain: v * 0.35 });
      break;
    case "bleed":
      // A drip.
      toneAt(r, t, { type: "sine", freq: 700 * p, freqTo: 1500 * p, decay: 0.07, gain: v * 0.4 });
      break;
    case "burn":
      // A short crackle of little pops.
      for (let i = 0; i < 5; i++) noiseAt(r, t + r.rnd() * 0.18, { filter: "highpass", freq: 2200 + r.rnd() * 2000, q: 1, decay: 0.015, gain: v * 0.45 });
      noiseAt(r, t, { filter: "bandpass", freq: 900, q: 0.7, attack: 0.03, decay: 0.15, gain: v * 0.2 });
      break;
    case "stun":
      // Seeing stars: two little falling bell notes.
      toneAt(r, t, { type: "triangle", freq: 1320 * p, freqTo: 990 * p, decay: 0.12, gain: v * 0.3 });
      toneAt(r, t + 0.1, { type: "triangle", freq: 990 * p, freqTo: 740 * p, decay: 0.14, gain: v * 0.3 });
      break;
    case "buff":
      toneAt(r, t, { type: "triangle", freq: 520 * p, freqTo: 880 * p, attack: 0.02, decay: 0.16, gain: v * 0.3 });
      break;
    case "debuff":
      toneAt(r, t, { type: "triangle", freq: 700 * p, freqTo: 360 * p, attack: 0.02, decay: 0.18, gain: v * 0.3 });
      break;
    case "hero_down":
      // Falling: a sinking groan and the thud of landing.
      toneAt(r, t, { type: "sawtooth", freq: 320 * p, freqTo: 70, attack: 0.02, decay: 0.45, gain: v * 0.45, cut: 900 });
      toneAt(r, t + 0.3, { type: "sine", freq: 95, freqTo: 45, decay: 0.2, gain: v * 0.9 });
      noiseAt(r, t + 0.3, { filter: "lowpass", freq: 400, decay: 0.12, gain: v * 0.5 });
      break;
    case "enemy_down":
      // A puff, a falling blip, and the body hitting the ground.
      noiseAt(r, t, { filter: "lowpass", freq: 2400 * p, freqTo: 300, q: 0.8, attack: 0.01, decay: 0.22, gain: v * 0.5 });
      toneAt(r, t + 0.02, { type: "square", freq: 660 * p, freqTo: 180 * p, decay: 0.18, gain: v * 0.16, cut: 2000 });
      toneAt(r, t + 0.2, { type: "sine", freq: 90 * p, freqTo: 44, decay: 0.16, gain: v * 0.7 });
      noiseAt(r, t + 0.2, { filter: "lowpass", freq: 380, decay: 0.09, gain: v * 0.4 });
      break;
    case "howl":
      // A wolf's howl: the voice swells and climbs, holds at the top with a waver in it, and falls away, a second
      // voice a fifth over it and breath under both. Rough, through a low-pass, as a throat is.
      for (const [k, gain] of [[1, 0.42], [1.5, 0.14]] as const) {
        toneAt(r, t, { type: "sawtooth", freq: 300 * p * k, freqTo: 560 * p * k, attack: 0.3, decay: 0.32, gain: v * gain, cut: 1500 * k });
        for (let i = 0; i < 6; i++) toneAt(r, t + 0.55 + i * 0.09, { type: "sawtooth", freq: (575 + (i % 2 ? -18 : 18)) * p * k, decay: 0.1, attack: 0.03, gain: v * gain * 0.85, cut: 1500 * k });
        toneAt(r, t + 1.05, { type: "sawtooth", freq: 570 * p * k, freqTo: 290 * p * k, attack: 0.04, decay: 0.75, gain: v * gain, cut: 1300 * k });
      }
      noiseAt(r, t, { filter: "bandpass", freq: 900 * p, freqTo: 1300 * p, q: 1.5, attack: 0.3, decay: 1.3, gain: v * 0.12 });
      break;
    case "channel": {
      // Drawn up through it for about a second (figures.ts CHANNEL): a deep hum swelling and climbing, a throb in it
      // quickening, a glassy shimmer over the top and a hiss of charge rising under it. Then let go, as the field goes
      // out: a deep soft thump, a long airy whoosh falling away, and a ring left hanging, two notes, as the light fades.
      const go = 1.05;
      toneAt(r, t, { type: "sine", freq: 62 * p, freqTo: 92 * p, attack: go - 0.05, decay: 0.2, gain: v * 0.55 });
      toneAt(r, t, { type: "triangle", freq: 124 * p, freqTo: 186 * p, attack: go - 0.05, decay: 0.15, gain: v * 0.22, cut: 900 });
      for (let i = 0; i < 9; i++) {
        const at = t + 0.2 + go * 0.8 * (1 - (1 - i / 9) ** 1.6);
        toneAt(r, at, { type: "triangle", freq: (110 + i * 6) * p, attack: 0.02, decay: 0.07, gain: v * (0.05 + i * 0.015), cut: 1200 });
      }
      for (const [f, g] of [[880, 0.05], [1320, 0.035], [1760, 0.025]] as const) toneAt(r, t + 0.15, { type: "sine", freq: f * p * wobble(r, 0.01), freqTo: f * 1.08 * p, attack: go - 0.2, decay: 0.12, gain: v * g });
      noiseAt(r, t, { filter: "bandpass", freq: 900 * p, freqTo: 3200 * p, q: 4, attack: go, decay: 0.08, gain: v * 0.12 });
      toneAt(r, t + go, { type: "sine", freq: 170 * p, freqTo: 46, decay: 0.55, gain: v * 0.9 });
      noiseAt(r, t + go, { filter: "lowpass", freq: 4200 * p, freqTo: 260, q: 0.8, attack: 0.02, decay: 1.0, gain: v * 0.35 });
      toneAt(r, t + go + 0.02, { type: "triangle", freq: 523 * p, freqTo: 510 * p, decay: 1.0, gain: v * 0.12 });
      toneAt(r, t + go + 0.02, { type: "sine", freq: 784 * p, freqTo: 770 * p, decay: 1.1, gain: v * 0.08 });
      break;
    }
    case "wail": {
      // A ghost's scream: a breath drawn in, then a thin voice leaping up high and wavering there, a second a little
      // out of tune with it so the two beat against each other, and both sliding down and away, under a cold hiss.
      noiseAt(r, t, { filter: "bandpass", freq: 600 * p, freqTo: 1800 * p, q: 2, attack: 0.3, decay: 0.05, gain: v * 0.12 });
      const go = t + 0.36;
      for (const [k, gain] of [[1, 0.3], [1.06, 0.18], [0.5, 0.12]] as const) {
        toneAt(r, go, { type: "sine", freq: 520 * p * k, freqTo: 980 * p * k, attack: 0.08, decay: 0.12, gain: v * gain });
        for (let i = 0; i < 7; i++) toneAt(r, go + 0.18 + i * 0.08, { type: "triangle", freq: (980 + (i % 2 ? -45 : 45)) * p * k, attack: 0.03, decay: 0.09, gain: v * gain * 0.8, cut: 2600 });
        toneAt(r, go + 0.74, { type: "sine", freq: 960 * p * k, freqTo: 260 * p * k, attack: 0.03, decay: 0.5, gain: v * gain * 0.9 });
      }
      noiseAt(r, go, { filter: "highpass", freq: 2200 * p, attack: 0.1, decay: 1.0, gain: v * 0.08 });
      break;
    }
    case "rattle": {
      // Bones clattering as it twitches: dry clicks, now one, now a few together, coming quicker and harder as it goes
      // on, each a woody knock with a snap of noise. Under them, two low notes a little apart beating sourly against
      // each other, swelling and dying away; and as its waves go out, a dark rush of air sinking low.
      for (let at = 0.05; at < 1.75; ) {
        const k = Math.min(1, at / 0.7);
        const clicks = 1 + Math.floor(r.rnd() * (1 + 2 * k));
        for (let c = 0; c < clicks; c++) {
          const when = t + at + c * (0.012 + r.rnd() * 0.02);
          noiseAt(r, when, { filter: "bandpass", freq: (2400 + r.rnd() * 1800) * p, q: 6, decay: 0.018, gain: v * (0.12 + 0.18 * k) });
          toneAt(r, when, { type: "triangle", freq: (700 + r.rnd() * 500) * p, freqTo: 380 * p, decay: 0.03, gain: v * (0.07 + 0.1 * k) });
        }
        at += (0.13 - 0.07 * k) * (0.6 + r.rnd() * 0.8);
      }
      for (const f of [73.4, 77.8]) toneAt(r, t + 0.05, { type: "sawtooth", freq: f * p, freqTo: f * p * 0.94, attack: 0.55, decay: 1.4, gain: v * 0.16, cut: 420 });
      noiseAt(r, t + 0.55, { filter: "lowpass", freq: 900 * p, freqTo: 140 * p, q: 0.8, attack: 0.08, decay: 1.0, gain: v * 0.32 });
      break;
    }
    case "chains": {
      // Iron links knocking together: each a clink of a few partials pitched apart as struck metal's are (not in
      // harmony), with a snap of bright noise. A soft jingle as it is gathered up, then a quick run of them as the chain
      // pays out through the air, and a heavy clank as the stake goes home, ringing on after (timed to its move,
      // signatureMoves.ts ghastlyFetter: thrown at about half a second, landing at about 0.85).
      const clink = (when: number, loud: number, pitch: number) => {
        const f = (900 + r.rnd() * 700) * pitch * p;
        for (const [ratio, share] of [[1, 1], [2.76, 0.55], [5.4, 0.3]] as const) toneAt(r, when, { type: "sine", freq: f * ratio, decay: 0.05 + 0.04 / ratio, gain: v * loud * share * 0.16 });
        noiseAt(r, when, { filter: "bandpass", freq: f * 3, q: 4, decay: 0.012, gain: v * loud * 0.12 });
      };
      for (let at = 0.02; at < 0.42; at += 0.06 + r.rnd() * 0.08) clink(t + at, 0.45, 0.9 + r.rnd() * 0.2);
      for (let at = 0.46; at < 0.78; at += 0.025 + r.rnd() * 0.02) clink(t + at, 0.7 + 0.3 * r.rnd(), 0.85 + r.rnd() * 0.35);
      const home = t + 0.86;
      // The stake: a low iron clank with a dull thud under it, ringing on, and the chain settling after it.
      for (const [f, share, decay] of [[220, 1, 0.5], [607, 0.5, 0.35], [1188, 0.3, 0.25], [1950, 0.18, 0.18]] as const) toneAt(r, home, { type: "sine", freq: f * p * wobble(r, 0.01), decay, gain: v * share * 0.35 });
      noiseAt(r, home, { filter: "lowpass", freq: 700 * p, freqTo: 120 * p, q: 0.8, decay: 0.18, gain: v * 0.45 });
      noiseAt(r, home, { filter: "bandpass", freq: 3200 * p, q: 3, decay: 0.03, gain: v * 0.2 });
      for (let at = 0.1; at < 0.5; at += 0.07 + r.rnd() * 0.08) clink(home + at, 0.35 * (1 - at), 0.8 + r.rnd() * 0.2);
      break;
    }
    case "chill":
      // A cold breath rushing in, and a frost settling: a glassy shimmer of high notes falling away.
      noiseAt(r, t, { filter: "bandpass", freq: 800 * p, freqTo: 2600 * p, q: 1.2, attack: 0.25, decay: 0.2, gain: v * 0.3 });
      toneAt(r, t + 0.3, { type: "sine", freq: 340 * p, freqTo: 180 * p, decay: 0.3, gain: v * 0.3 });
      for (const [i, f] of [1760, 2349, 1976, 2637].entries()) toneAt(r, t + 0.32 + i * 0.05, { type: "sine", freq: f * p * wobble(r, 0.01), decay: 0.35, gain: v * 0.06 });
      break;
    case "boss_down":
      noiseAt(r, t, { filter: "lowpass", freq: 1800, freqTo: 120, q: 0.7, attack: 0.02, decay: 0.7, gain: v * 0.7 });
      toneAt(r, t, { type: "sawtooth", freq: 180, freqTo: 40, attack: 0.02, decay: 0.8, gain: v * 0.45, cut: 600 });
      toneAt(r, t + 0.05, { type: "sine", freq: 70, freqTo: 35, decay: 0.5, gain: v });
      break;
    case "boss":
      // Something big has turned up: a low swell and a dull gong.
      toneAt(r, t, { type: "sawtooth", freq: 55, attack: 0.35, decay: 1.4, gain: v * 0.5, cut: 380 });
      toneAt(r, t, { type: "sawtooth", freq: 82.4 * wobble(r, 0.01), attack: 0.35, decay: 1.4, gain: v * 0.4, cut: 380 });
      toneAt(r, t + 0.05, { type: "sine", freq: 110, freqTo: 104, decay: 1.8, gain: v * 0.6 });
      break;
    case "victory": {
      // Up the chord and hold the top.
      const [a, b, c] = pick(CHORDS).map((f) => f / 2);
      [a, b, c, a * 2].forEach((f, i) => toneAt(r, t + i * 0.11, { type: "triangle", freq: f, attack: 0.01, decay: i === 3 ? 0.55 : 0.16, gain: v * 0.45 }));
      break;
    }
    case "defeat":
      // Down a minor third or two, slow.
      [392, 311, 262].forEach((f, i) => toneAt(r, t + i * 0.2, { type: "triangle", freq: f * wobble(r, 0.01), attack: 0.02, decay: i === 2 ? 0.7 : 0.22, gain: v * 0.45 }));
      break;
    case "blip":
      // A letter of someone's words: a short rounded note with a breath of noise, never quite the same twice.
      toneAt(r, t, { type: "triangle", freq: 520 * p, freqTo: 470 * p, attack: 0.004, decay: 0.05, gain: v * 0.32 });
      toneAt(r, t, { type: "sine", freq: 1040 * p, attack: 0.004, decay: 0.03, gain: v * 0.08 });
      noiseAt(r, t, { filter: "bandpass", freq: 1800 * p, q: 2, decay: 0.012, gain: v * 0.05 });
      break;
    case "your_turn":
      // Three notes up, the last one held: yours to play.
      toneAt(r, t, { type: "sine", freq: 880 * p, decay: 0.06, gain: v * 0.22 });
      toneAt(r, t + 0.07, { type: "sine", freq: 1175 * p, decay: 0.07, gain: v * 0.22 });
      toneAt(r, t + 0.14, { type: "sine", freq: 1760 * p, decay: 0.2, gain: v * 0.24 });
      toneAt(r, t + 0.14, { type: "triangle", freq: 880 * p, decay: 0.2, gain: v * 0.1 });
      break;
    case "dice": {
      // A die thrown down: it knocks a few times, each knock closer to the last, and comes to rest.
      let at = t;
      for (let i = 0; i < 5; i++) {
        const k = 1 - i / 6;
        noiseAt(r, at, { filter: "bandpass", freq: (2400 + r.rnd() * 1400) * p, q: 3, decay: 0.014, gain: v * 0.55 * k });
        toneAt(r, at, { type: "sine", freq: (210 + r.rnd() * 90) * p, freqTo: 120, decay: 0.03, gain: v * 0.4 * k });
        at += 0.045 + (0.09 * k * k) * (0.7 + r.rnd() * 0.6);
      }
      break;
    }
    case "initiative":
      // A fight is on: two war-drum blows, and a low horn coming up under them.
      for (const at of [0, 0.22]) {
        toneAt(r, t + at, { type: "sine", freq: 105, freqTo: 48, decay: 0.3, gain: v * 1.1 });
        noiseAt(r, t + at, { filter: "lowpass", freq: 900, freqTo: 200, decay: 0.12, gain: v * 0.6 });
        noiseAt(r, t + at, { filter: "bandpass", freq: 2200, q: 2, decay: 0.02, gain: v * 0.3 });
      }
      toneAt(r, t + 0.4, { type: "sawtooth", freq: 110, freqTo: 147, attack: 0.25, decay: 0.7, gain: v * 0.32, cut: 620 });
      toneAt(r, t + 0.4, { type: "sawtooth", freq: 165 * wobble(r, 0.004), freqTo: 220, attack: 0.25, decay: 0.7, gain: v * 0.22, cut: 620 });
      break;
    case "enemy_turn":
      // Not yours: one low, dull tick.
      toneAt(r, t, { type: "triangle", freq: 196 * p, freqTo: 147 * p, decay: 0.16, gain: v * 0.3, cut: 900 });
      noiseAt(r, t, { filter: "lowpass", freq: 700, decay: 0.03, gain: v * 0.25 });
      break;
    case "opportunity":
      // Caught leaving: a quick scrape of steel, cut short.
      noiseAt(r, t, { filter: "bandpass", freq: 3800 * p, freqTo: 6200 * p, q: 4, attack: 0.02, decay: 0.12, gain: v * 0.5 });
      toneAt(r, t + 0.05, { type: "sine", freq: 2480 * p, decay: 0.2, gain: v * 0.1 });
      noiseAt(r, t + 0.1, { filter: "highpass", freq: 3000, q: 1.5, decay: 0.03, gain: v * 0.5 });
      break;
    case "shove":
      // Shoulder into a body: the effort, then the knock.
      noiseAt(r, t, { filter: "bandpass", freq: 520 * p, freqTo: 1100 * p, q: 1.5, attack: 0.03, decay: 0.07, gain: v * 0.45 });
      toneAt(r, t + 0.08, { type: "sine", freq: 140 * p, freqTo: 60, decay: 0.14, gain: v });
      noiseAt(r, t + 0.08, { filter: "lowpass", freq: 800 * p, decay: 0.06, gain: v * 0.6 });
      break;
    case "fall":
      // Somebody hits the ground, all of them at once: a thud, a second smaller one, and grit.
      toneAt(r, t, { type: "sine", freq: 100 * p, freqTo: 42, decay: 0.2, gain: v * 1.1 });
      noiseAt(r, t, { filter: "lowpass", freq: 500 * p, decay: 0.1, gain: v * 0.7 });
      toneAt(r, t + 0.13, { type: "sine", freq: 84 * p, freqTo: 46, decay: 0.12, gain: v * 0.5 });
      noiseAt(r, t + 0.05, { filter: "highpass", freq: 2600, decay: 0.16, gain: v * 0.12 });
      break;
    case "jump":
      // Up with a rush of air, and down on both feet.
      noiseAt(r, t, { filter: "bandpass", freq: 500 * p, freqTo: 2200 * p, q: 1.6, attack: 0.08, decay: 0.14, gain: v * 0.4 });
      toneAt(r, t + 0.3, { type: "sine", freq: 130 * p, freqTo: 60, decay: 0.1, gain: v * 0.8 });
      noiseAt(r, t + 0.3, { filter: "lowpass", freq: 700 * p, decay: 0.06, gain: v * 0.5 });
      break;
    case "throw":
      // An arm coming over, and something small leaving it, turning in the air.
      noiseAt(r, t, { filter: "bandpass", freq: 900 * p, freqTo: 2800 * p, q: 1.4, attack: 0.04, decay: 0.08, gain: v * 0.45 });
      for (let i = 0; i < 3; i++) noiseAt(r, t + 0.12 + i * 0.06, { filter: "bandpass", freq: 3000 * p, q: 5, attack: 0.01, decay: 0.025, gain: v * 0.16 });
      break;
    case "shatter":
      // Glass breaking: a sharp crack, then shards skittering.
      noiseAt(r, t, { filter: "highpass", freq: 3600 * p, q: 1.2, decay: 0.06, gain: v * 0.8 });
      toneAt(r, t, { type: "sine", freq: 3100 * p, freqTo: 2500 * p, decay: 0.09, gain: v * 0.16 });
      for (let i = 0; i < 9; i++) toneAt(r, t + 0.03 + r.rnd() * 0.36, { type: "sine", freq: 2600 + r.rnd() * 4200, decay: 0.03 + r.rnd() * 0.04, gain: v * 0.11 });
      break;
    case "ignite":
      // Fire taking hold: air sucked in, a roar, and the crackle that stays.
      noiseAt(r, t, { filter: "bandpass", freq: 260 * p, freqTo: 1500 * p, q: 0.9, attack: 0.14, decay: 0.34, gain: v * 0.7 });
      toneAt(r, t + 0.05, { type: "sine", freq: 80, freqTo: 52, attack: 0.08, decay: 0.3, gain: v * 0.5 });
      for (let i = 0; i < 8; i++) noiseAt(r, t + 0.18 + r.rnd() * 0.45, { filter: "highpass", freq: 2200 + r.rnd() * 2400, q: 1, decay: 0.014, gain: v * 0.4 });
      break;
    case "poison":
      // Something that should not be breathed: a long hiss, and thick bubbles coming up through it.
      noiseAt(r, t, { filter: "highpass", freq: 5200 * p, q: 0.8, attack: 0.05, decay: 0.5, gain: v * 0.3 });
      for (let i = 0; i < 6; i++) {
        const f = 260 + r.rnd() * 240;
        toneAt(r, t + 0.06 + r.rnd() * 0.5, { type: "sine", freq: f, freqTo: f * 2.1, attack: 0.008, decay: 0.045, gain: v * 0.3 });
      }
      break;
    case "splash":
      // Water thrown down: the slap, the wash going out, and drops landing after.
      noiseAt(r, t, { filter: "lowpass", freq: 3800 * p, freqTo: 700, q: 0.8, decay: 0.2, gain: v * 0.75 });
      noiseAt(r, t + 0.03, { filter: "bandpass", freq: 1500 * p, freqTo: 3200 * p, q: 1.2, attack: 0.05, decay: 0.25, gain: v * 0.3 });
      for (let i = 0; i < 4; i++) toneAt(r, t + 0.2 + r.rnd() * 0.25, { type: "sine", freq: 900 + r.rnd() * 900, freqTo: 1800 + r.rnd() * 600, decay: 0.03, gain: v * 0.16 });
      break;
    case "oil":
      // Thick and slow: a wet slap with a long low spread.
      noiseAt(r, t, { filter: "lowpass", freq: 900 * p, freqTo: 240, q: 1.4, decay: 0.26, gain: v * 0.8 });
      toneAt(r, t + 0.04, { type: "sine", freq: 170 * p, freqTo: 95, decay: 0.2, gain: v * 0.4 });
      toneAt(r, t + 0.22, { type: "sine", freq: 300 * p, freqTo: 520 * p, decay: 0.05, gain: v * 0.2 });
      break;
    case "ice":
      // Water locking: a creak running outward, cracks, and a cold high ring.
      for (let i = 0; i < 7; i++) noiseAt(r, t + i * 0.035 + r.rnd() * 0.03, { filter: "highpass", freq: 3200 + r.rnd() * 3000, q: 2.5, decay: 0.016, gain: v * 0.42 });
      toneAt(r, t, { type: "triangle", freq: 420 * p, freqTo: 760 * p, attack: 0.02, decay: 0.24, gain: v * 0.14, cut: 2200 });
      toneAt(r, t + 0.22, { type: "sine", freq: 3136 * p, decay: 0.34, gain: v * 0.12 });
      toneAt(r, t + 0.22, { type: "sine", freq: 4186 * p, decay: 0.28, gain: v * 0.07 });
      break;
    case "sick":
      // Poison in the blood: two sour notes sliding down, a little out of tune with each other.
      toneAt(r, t, { type: "triangle", freq: 466 * p, freqTo: 311 * p, attack: 0.02, decay: 0.3, gain: v * 0.26 });
      toneAt(r, t + 0.04, { type: "triangle", freq: 494 * p, freqTo: 330 * p, attack: 0.02, decay: 0.3, gain: v * 0.2 });
      break;
    case "creak": {
      // A chest thrown open: the latch knocks, the old hinge groans through the swing in a run of catches, and
      // the lid thumps back against its stop.
      noiseAt(r, t, { filter: "highpass", freq: 2400 * p, q: 1.2, decay: 0.02, gain: v * 0.5 });
      toneAt(r, t, { type: "sine", freq: 320 * p, freqTo: 180 * p, decay: 0.04, gain: v * 0.35 });
      toneAt(r, t + 0.05, { type: "sawtooth", freq: 150 * p, freqTo: 270 * p, attack: 0.06, decay: 0.38, gain: v * 0.07, cut: 1300 });
      toneAt(r, t + 0.12, { type: "triangle", freq: 430 * p, freqTo: 300 * p, attack: 0.04, decay: 0.3, gain: v * 0.05, cut: 2000 });
      const catches = 32;
      for (let i = 0; i < catches; i++) {
        const k = i / catches;
        noiseAt(r, t + 0.05 + 0.42 * k ** 0.85 + r.rnd() * 0.006, { filter: "bandpass", freq: (650 + 950 * Math.sin(Math.PI * k)) * p, q: 6, attack: 0.002, decay: 0.012, gain: v * (0.22 + 0.2 * r.rnd()) });
      }
      toneAt(r, t + 0.5, { type: "sine", freq: 125 * p, freqTo: 55, decay: 0.15, gain: v * 0.8 });
      noiseAt(r, t + 0.5, { filter: "lowpass", freq: 650 * p, decay: 0.06, gain: v * 0.5 });
      break;
    }
    case "knock":
      // A blow into boards: a hollow thump, the wood's own note, and a crack of a split.
      toneAt(r, t, { type: "sine", freq: 210 * p, freqTo: 105, decay: 0.09, gain: v * 0.75 });
      noiseAt(r, t, { filter: "bandpass", freq: 900 * p, q: 1.4, decay: 0.05, gain: v * 0.6 });
      toneAt(r, t + 0.004, { type: "triangle", freq: 520 * p, freqTo: 430 * p, decay: 0.06, gain: v * 0.12, cut: 1800 });
      noiseAt(r, t + 0.01, { filter: "highpass", freq: 2600 * p, q: 1, decay: 0.015, gain: v * 0.3 });
      break;
    case "splinter":
      // A crate giving way: the crack, the box caving in, wood splitting all through it, and boards clattering down.
      noiseAt(r, t, { filter: "highpass", freq: 1800 * p, q: 1, decay: 0.05, gain: v * 0.9 });
      toneAt(r, t, { type: "sine", freq: 170 * p, freqTo: 58, decay: 0.16, gain: v * 0.85 });
      for (let i = 0; i < 11; i++) noiseAt(r, t + 0.02 + r.rnd() * 0.2, { filter: "bandpass", freq: 1200 + r.rnd() * 2800, q: 3, decay: 0.01 + r.rnd() * 0.02, gain: v * 0.35 });
      for (let i = 0; i < 6; i++) {
        const at = t + 0.24 + r.rnd() * 0.42;
        const f = (300 + r.rnd() * 320) * p;
        toneAt(r, at, { type: "sine", freq: f, freqTo: f * 0.6, decay: 0.05, gain: v * 0.24 });
        noiseAt(r, at, { filter: "bandpass", freq: 700 + r.rnd() * 700, q: 2, decay: 0.03, gain: v * 0.3 });
      }
      break;
    case "alarm": {
      // An alarm bell rung hard: five strokes, one to each wave of sound drawn pulsing out of it (SpellFx alarm),
      // each a clang of the clapper and a bell's out-of-tune partials ringing on under the next, the last left to die away.
      // A great bell, not a hand bell: a low strike note with a deep hum under it, and a long ring-out.
      const strike = 165 * p;
      const partials: [number, number, number][] = [[0.5, 0.34, 3.2], [1, 0.32, 2.6], [1.19, 0.2, 1.9], [1.5, 0.12, 1.5], [2, 0.16, 1.3], [2.51, 0.08, 0.9], [3.03, 0.06, 0.6], [4.07, 0.03, 0.4]];
      for (let i = 0; i < 5; i++) {
        const at = t + i * 0.32;
        const hard = 1 - i * 0.08;
        // The iron clapper on bronze: a dull clank and a thump felt through the frame.
        noiseAt(r, at, { filter: "bandpass", freq: 1400 * p, q: 1.2, decay: 0.04, gain: v * 0.4 * hard });
        toneAt(r, at, { type: "sine", freq: strike * 0.4, freqTo: strike * 0.3, decay: 0.12, gain: v * 0.35 * hard });
        for (const [ratio, gain, decay] of partials) toneAt(r, at, { type: "sine", freq: strike * ratio * wobble(r, 0.003), attack: 0.003, decay: i === 4 ? decay : Math.min(decay, 1.4), gain: v * gain * hard });
      }
      break;
    }
    case "soak":
      // Soaked through: a short wash and two drips.
      noiseAt(r, t, { filter: "bandpass", freq: 1800 * p, freqTo: 900 * p, q: 1, attack: 0.02, decay: 0.14, gain: v * 0.4 });
      toneAt(r, t + 0.16, { type: "sine", freq: 820 * p, freqTo: 1500 * p, decay: 0.04, gain: v * 0.25 });
      toneAt(r, t + 0.26, { type: "sine", freq: 700 * p, freqTo: 1300 * p, decay: 0.04, gain: v * 0.2 });
      break;
  }
}

/**
 * One table sound. Dice are small and hard, so they click high (ivory on ivory,
 * or wood) and knock low through the tabletop; the felt deadens the rest.
 */
function table(r: Render, sound: SynthTable) {
  const v = 0.8 * wobble(r, 0.12);
  const p = wobble(r, 0.07);
  /** A die striking something: a bright click, and the knock of the wood under the felt. */
  const clack = (at: number, gain: number, bright = 1) => {
    noiseAt(r, at, { filter: "bandpass", freq: (2600 + r.rnd() * 1800) * p * bright, q: 2.2, decay: 0.012 + r.rnd() * 0.01, gain: gain * 0.8 });
    toneAt(r, at, { type: "sine", freq: (380 + r.rnd() * 160) * p, freqTo: 220 * p, decay: 0.035, gain: gain * 0.55 });
  };
  switch (sound) {
    case "shake": {
      // Dice rattling in a leather cup: a run of quick clicks, muffled, swelling and easing twice as the cup goes back and forth.
      for (let i = 0; i < 22; i++) {
        const at = 0.01 + (i / 22) * 0.42 + r.rnd() * 0.02;
        const swing = 0.55 + 0.45 * Math.abs(Math.sin((at / 0.42) * Math.PI * 2));
        noiseAt(r, at, { filter: "bandpass", freq: (1500 + r.rnd() * 1400) * p, q: 2.5, decay: 0.01 + r.rnd() * 0.008, gain: v * 0.45 * swing });
      }
      noiseAt(r, 0.01, { filter: "lowpass", freq: 500 * p, q: 0.8, attack: 0.06, decay: 0.35, gain: v * 0.18 });
      break;
    }
    case "tumble": {
      // Dice spilled onto the felt: each lands, bounces twice and rolls to a stop, a beat apart, with the odd click of one die on another.
      const dice = 3;
      for (let d = 0; d < dice; d++) {
        let at = 0.005 + d * (0.03 + r.rnd() * 0.04);
        let gain = v * (0.85 + r.rnd() * 0.3);
        let gap = 0.12 + r.rnd() * 0.05;
        for (let b = 0; b < 4; b++) {
          clack(at, gain, 0.8 + r.rnd() * 0.3);
          at += gap;
          gap *= 0.55;
          gain *= 0.5;
        }
      }
      for (let i = 0; i < 3; i++) noiseAt(r, 0.06 + r.rnd() * 0.3, { filter: "highpass", freq: 4200 * p, q: 1.5, decay: 0.008, gain: v * 0.35 });
      // The roll across the cloth.
      noiseAt(r, 0.02, { filter: "bandpass", freq: 900 * p, q: 0.7, attack: 0.04, decay: 0.4, gain: v * 0.12 });
      break;
    }
    case "settle":
      // One die rocking to a stop.
      clack(0.004, v * 0.5, 0.9);
      clack(0.045, v * 0.2, 0.9);
      break;
    case "hold":
      // A die set firmly aside: one solid wooden clack, a touch of ring.
      noiseAt(r, 0.004, { filter: "bandpass", freq: 1500 * p, q: 1.8, decay: 0.025, gain: v * 0.8 });
      toneAt(r, 0.004, { type: "sine", freq: 640 * p, freqTo: 480 * p, decay: 0.07, gain: v * 0.7 });
      toneAt(r, 0.004, { type: "triangle", freq: 1900 * p, decay: 0.06, gain: v * 0.12 });
      break;
    case "coins": {
      // Gold onto the pile: a handful of clinks, each a pair of inharmonic rings, landing over half a second.
      const n = 6 + Math.floor(r.rnd() * 3);
      for (let i = 0; i < n; i++) {
        const at = 0.005 + (i / n) * 0.42 + r.rnd() * 0.04;
        const f = (2900 + r.rnd() * 1600) * p;
        const g = v * (0.25 + r.rnd() * 0.2) * (1 - (i / n) * 0.5);
        toneAt(r, at, { type: "sine", freq: f, decay: 0.08 + r.rnd() * 0.08, gain: g });
        toneAt(r, at, { type: "sine", freq: f * 1.47, decay: 0.05, gain: g * 0.5 });
        noiseAt(r, at, { filter: "highpass", freq: 5000, q: 1, decay: 0.006, gain: g * 0.6 });
      }
      break;
    }
  }
}

const GROUNDS = Object.keys(STEP) as SynthGround[];
const TABLES = Object.keys(TABLE_LENGTH) as SynthTable[];
const COMBATS = Object.keys(COMBAT_LENGTH) as SynthCombat[];
const takesOf = (sound: SynthCombat) => (STINGS.has(sound) ? STING_TAKES : COMBAT_TAKES);

/** What a key renders: a footstep, a combat sound or a table sound, and which take. */
function parse(key: string): { kind: "step"; ground: SynthGround; take: number } | { kind: "combat"; sound: SynthCombat; take: number } | { kind: "table"; sound: SynthTable; take: number } | null {
  const m = /^synth\/(step|combat|table)\/([a-z_]+)_(\d+)$/.exec(key);
  if (!m) return null;
  const take = Number(m[3]);
  if (m[1] === "table") return (TABLES as string[]).includes(m[2]) ? { kind: "table", sound: m[2] as SynthTable, take } : null;
  if (m[1] === "step" && (GROUNDS as string[]).includes(m[2])) return { kind: "step", ground: m[2] as SynthGround, take };
  if (m[1] === "combat" && (COMBATS as string[]).includes(m[2])) return { kind: "combat", sound: m[2] as SynthCombat, take };
  return null;
}

/** Every built-in sound as an index entry, keyed `synth/step/<ground>_<n>`, `synth/combat/<sound>_<n>` and `synth/table/<sound>_<n>`. */
export function synthIndex(): Record<string, AudioFile> {
  const out: Record<string, AudioFile> = {};
  const entry = (duration: number): AudioFile => ({ urls: {}, duration, sampleRate: SAMPLE_RATE, channels: 1, synth: true });
  for (const g of GROUNDS) for (let i = 1; i <= STEP_TAKES; i++) out[`synth/step/${g}_${i}`] = entry(STEP[g].decay + 0.12);
  for (const c of COMBATS) for (let i = 1; i <= takesOf(c); i++) out[`synth/combat/${c}_${i}`] = entry(COMBAT_LENGTH[c]);
  for (const t of TABLES) for (let i = 1; i <= TABLE_TAKES; i++) out[`synth/table/${t}_${i}`] = entry(TABLE_LENGTH[t]);
  return out;
}

/** Render one built-in sound to a buffer. Null for a key that is not one. */
export async function renderSynth(key: string): Promise<AudioBuffer | null> {
  const what = parse(key);
  if (!what) return null;
  const Offline = globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) return null;
  const seconds = what.kind === "step" ? STEP[what.ground].decay + 0.12 : what.kind === "table" ? TABLE_LENGTH[what.sound] : COMBAT_LENGTH[what.sound];
  const ctx = new Offline(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  // A quarter second of white noise, the stuff every scuff and swish is cut from; seeded, like everything in a take.
  const rnd = seeded(key);
  const noise = ctx.createBuffer(1, Math.floor(SAMPLE_RATE * 0.25), SAMPLE_RATE);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
  const r: Render = { ctx, out: ctx.destination, noise, rnd };
  if (what.kind === "step") step(r, what.ground, what.take);
  else if (what.kind === "table") table(r, what.sound);
  else combat(r, what.sound);
  return ctx.startRendering();
}
