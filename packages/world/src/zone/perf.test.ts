import { it } from "vitest";
import { at, flatBoard, must, standEnemy, standHero, unit } from "../test/zoneBoard";
import type { ZoneEvent, ZoneState } from "./types";

// How long enemy turns take. Only runs when BENCH is set, and asserts nothing about the time: it prints the median
// of three runs, so a speed-up can be shown. `BENCH=1 pnpm --filter @gantt-quest/world exec vitest run perf`.

const bench = process.env.BENCH ? it : it.skip;
const hero = { classId: "qa_paladin", level: 3, armor: 0, power: 1, abilities: ["bash"], items: {} };

/** Four heroes at the left, six enemies with spread and ranged abilities at the right, ten rounds played. */
function fight(): number {
  let state: ZoneState = flatBoard({ rng: 4242, start: at(2, 6), options: { party: 4 }, flags: { shareTurns: true } });
  [["ann", at(3, 6)], ["bob", at(3, 5)], ["cal", at(3, 7)], ["dee", at(2, 6)]].forEach(([id, pos]) => Object.assign(standHero(state, id as string, pos as ReturnType<typeof at>, hero), { hp: 9000, maxHp: 9000 }));
  [["haunt", at(11, 6)], ["archer", at(12, 5)], ["broodmother", at(12, 7)], ["witch", at(11, 4)], ["great_bear", at(11, 8)], ["bat", at(10, 6)]].forEach(([kind, pos]) => standEnemy(state, kind as string, pos as ReturnType<typeof at>, "g1", { hp: 90000, maxHp: 90000 }));
  state = must(state, { type: "dev", by: "ann", dev: { op: "start_fight" } });
  const t0 = performance.now();
  const events: ZoneEvent[] = [];
  for (let i = 0; i < 400 && state.encounter && state.encounter.round <= 10; i++) {
    const enc = state.encounter;
    const mine = enc.acting.find((id) => unit(state, id).side === "hero" && !enc.done.includes(id));
    state = mine ? must(state, { type: "end_turn", by: mine, unit: mine }, events) : must(state, { type: "timeout" }, events);
  }
  return performance.now() - t0;
}

bench("ten rounds of enemy turns", () => {
  fight(); // warm up
  const times = [fight(), fight(), fight()].sort((a, b) => a - b);
  console.log(`BENCH enemy turns: median ${times[1].toFixed(0)} ms (runs ${times.map((t) => t.toFixed(0)).join(", ")})`);
}, 120000);
