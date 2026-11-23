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
