// The combat sandbox's enemy (dev toolbox, Maps tab): an enemy in the fight, picked on the map, played by the dev.
// Its abilities take the hero's place on the bottom bar (sandboxSlots). One that needs no aim (a burst round it, a
// call to its own side) is used at once; any other is armed (zoneDev's "strike" tool) and the next click on the map
// aims it (ZoneView). A click on open ground walks it there instead. In the bar's bottom row, a strip says who is being played.
// What it does is what its own turn would do (world: strikes.ts, enemyAct).

import { diceText, strikeAim, unitStrike, type EnemyStrike, type Unit, type ZoneState } from "@gantt-quest/world";
import type { HudSlot } from "../ui/Hud";
import { abilityIcon } from "./actionIcons";
import { setZoneDev, useZoneDev, type ZoneDevState } from "./zoneDev";

/** Who is being played, the way to let them go, and whether their abilities reach anywhere: for the bar's bottom row (HudBar slotsBelow). */
export function SandboxEnemy({ foe }: { foe: Unit }) {
  const dev = useZoneDev();
  return (
    <div className="zone-sandbox-enemy" role="group" aria-label={`Playing ${foe.name}`}>
      <strong>Playing {foe.name}</strong>
      <span className="muted">click open ground to walk it</span>
      <label className="muted"><input type="checkbox" checked={dev.anywhere} onChange={(e) => setZoneDev({ anywhere: e.target.checked })} /> Reach anywhere</label>
      <button className="link" onClick={() => setZoneDev({ picked: null, tool: dev.tool?.tool === "strike" ? null : dev.tool })}>Let go</button>
    </div>
  );
}

/** The enemy being played's abilities, as the bottom bar's slots. */
export function sandboxSlots(state: ZoneState, foe: Unit, dev: ZoneDevState): HudSlot[] {
  const armed = dev.tool?.tool === "strike" && dev.tool.unit === foe.id ? dev.tool.ability : null;
  const use = (s: EnemyStrike) => {
    if (strikeAim(s) === "self") return dev.open?.send({ op: "strike", unit: foe.id, ability: s.id, ...(dev.anywhere ? { anywhere: true } : {}) });
    setZoneDev({ tool: armed === s.id ? null : { tool: "strike", unit: foe.id, ability: s.id } });
  };
  return foe.abilities.flatMap((id) => {
    const s = unitStrike(state, foe, id);
    if (!s) return [];
    const reach = strikeAim(s) === "self" ? "round it" : s.range > 1 ? `range ${s.range}` : "beside it";
    return [{
      id: `foe:${id}`,
      icon: { ...abilityIcon(id), flat: true },
      name: s.name,
      line: [`${s.cost} AP`, s.cooldown ? `cooldown ${s.cooldown} (not in the sandbox)` : "", reach, s.harmless ? "" : `${diceText(s.dice)} damage`].filter(Boolean).join(" · "),
      more: aimHint(s),
      picked: armed === id,
      run: () => use(s),
    }];
  });
}

const aimHint = (s: EnemyStrike): string => {
  const aim = strikeAim(s);
  return aim === "self" ? "Used at once, where it stands." : aim === "hex" ? "Then click the hex to aim it at." : "Then click who to use it on.";
};

/** The enemy picked on the map, if it is one the sandbox lets the dev play: standing, and in the fight. */
export function sandboxFoe(state: ZoneState | null, dev: ZoneDevState): Unit | undefined {
  if (!state?.sandbox || !dev.picked) return undefined;
  return state.units.find((u) => u.id === dev.picked && u.side === "enemy" && !u.down && !!state.encounter?.order.includes(u.id));
}
