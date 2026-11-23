// The Harbor's own clock: a day of ten minutes, from the wall clock alone, so every browser (and the server, should
// it need to) agrees on the hour with nothing stored or sent. The sky is drawn from it (apps/game's ambience.ts),
// and the townsfolk keep their hours by it (wander.ts).

/** One full day, in milliseconds. */
export const GAME_DAY_MS = 10 * 60 * 1000;

/** How far through the day it is at `now` (epoch ms): 0 midnight, 0.5 noon. */
export function timeOfDay(now: number): number {
  return (((now % GAME_DAY_MS) + GAME_DAY_MS) % GAME_DAY_MS) / GAME_DAY_MS;
}

/** How high the sun stands at a time of day: below 0 it is down. Night falls over a short way either side of 0. */
const sunHeight = (time: number) => Math.sin((time - 0.25) * Math.PI * 2) + 0.2;

/** How dark it is at a time of day, 0 (broad day) to 1 (deep night), easing through dawn and dusk. */
export function nightAt(time: number): number {
  const t = Math.min(1, Math.max(0, (sunHeight(time) + 0.25) / 0.55));
  return 1 - t * t * (3 - 2 * t);
}

/** The times of day it is half light: the sun's height there is 0.025, the middle of the dusk's easing. */
const HALF_LIGHT = Math.asin(0.025 - 0.2) / (Math.PI * 2);
/** When the day comes (it is more light than dark from here) and when it goes, as times of day. */
export const DAWN = 0.25 + HALF_LIGHT;
export const DUSK = 0.75 - HALF_LIGHT;

// ---------- the weather ----------
// From the wall clock alone too, so a crew shares one sky and the server knows when it is storming (fishingholes.ts).

/** A spell of weather lasts this long; the sky eases from one to the next over the last part of it. */
export const WEATHER_SPELL_MS = 7 * 60 * 1000;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** A hash of two numbers to 0..1. (Kept exactly as the sky has always drawn it, so the weather did not change when it moved here.) */
const hash = (a: number, b: number, salt: number) => {
  const n = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
};

/** How the spell at `now` eases into the next: the spell, how far into the next it has blended, 0 to 1. */
function spellAt(now: number): { spell: number; blend: number } {
  const at = now / WEATHER_SPELL_MS;
  const spell = Math.floor(at);
  return { spell, blend: smooth(0.7, 1, at - spell) };
}

/**
 * The weather at `now`, 0 (clear) to 1 (heavy rain). A new spell starts every few minutes and holds for most of
 * its length. `wet`: a port with streets (the Harbor) runs wetter than an island out on the atlas.
 */
export function weatherAt(now: number, wet = true): number {
  const { spell, blend } = spellAt(now);
  const bias = wet ? 0.12 : -0.08;
  const of = (k: number) => Math.max(0, Math.min(1, hash(k, 7, 700) + bias));
  return of(spell) * (1 - blend) + of(spell + 1) * blend;
}

/**
 * Whether the spell at `now` is a storm, 0 to 1: a downpour with thunder and lightning. About half of the heaviest
 * spells are storms; the rest are plain downpours.
 */
export function stormAt(now: number, wet = true): number {
  const { spell, blend } = spellAt(now);
  const bias = wet ? 0.12 : -0.08;
  const of = (k: number) => (hash(k, 7, 700) + bias > 0.85 && hash(k, 11, 700) < 0.5 ? 1 : 0);
  return of(spell) * (1 - blend) + of(spell + 1) * blend;
}

/** How hard it rains at a weather of 0 to 1: nothing until it is well overcast. */
export const rainOf = (weather: number): number => smooth(0.6, 0.9, weather);

/** The Harbor's sky at `now`, as the rules read it: is it night, and is it storming. Halfway is the line for both. */
export function harborSky(now: number): { night: boolean; storm: boolean } {
  return { night: nightAt(timeOfDay(now)) >= 0.5, storm: stormAt(now) * rainOf(weatherAt(now)) >= 0.5 };
}
