// The combat sandbox's enemy bar (dev toolbox, Maps tab): an enemy in the fight, picked on the map, played by the
// dev. Each of its abilities is a button: one that needs no aim (a burst round it, a call to its own side) is used at
// once; any other is armed (zoneDev's "strike" tool) and the next click on the map aims it (ZoneView). A click on
// open ground walks it there instead. What it does is what its own turn would do (world: strikes.ts, enemyAct).

import { strikeAim, unitStrike, type EnemyStrike, type Unit, type ZoneState } from "@gantt-quest/world";
import { setZoneDev, useZoneDev, type ZoneDevState } from "./zoneDev";

export function SandboxEnemy({ state, foe }: { state: ZoneState; foe: Unit }) {
  const dev = useZoneDev();
  const send = dev.open?.send;
  const strikes = foe.abilities.map((id) => unitStrike(state, foe, id)).filter((s): s is EnemyStrike => !!s);
  const armed = dev.tool?.tool === "strike" && dev.tool.unit === foe.id ? dev.tool.ability : null;
  const use = (s: EnemyStrike) => {
    if (strikeAim(s) === "self") return send?.({ op: "strike", unit: foe.id, ability: s.id, ...(dev.anywhere ? { anywhere: true } : {}) });
    setZoneDev({ tool: armed === s.id ? null : { tool: "strike", unit: foe.id, ability: s.id } });
  };

  return (
    <div className="panel zone-sandbox-enemy" role="group" aria-label={`Play ${foe.name}`}>
      <div className="zone-barmenu-head">
        <strong>{foe.name}</strong>
        <span className="muted">{foe.hp}/{foe.maxHp} HP · click open ground to walk it there</span>
        <button className="link" onClick={() => setZoneDev({ picked: null, tool: armed ? null : dev.tool })}>Let go</button>
      </div>
      <div className="zone-sandbox-enemy-list">
        {strikes.map((s) => (
          <button key={s.id} className={`small ${armed === s.id ? "selected" : ""}`} title={aimHint(s)} onClick={() => use(s)}>
            {s.name} <span className="muted">{s.cost} AP</span>
          </button>
        ))}
      </div>
      <label className="muted"><input type="checkbox" checked={dev.anywhere} onChange={(e) => setZoneDev({ anywhere: e.target.checked })} /> Reach anywhere (no range or line of sight)</label>
    </div>
  );
}

const aimHint = (s: EnemyStrike): string => {
  const aim = strikeAim(s);
  return aim === "self" ? "Used at once, where it stands" : aim === "hex" ? "Then click the hex to aim it at" : "Then click who to use it on";
};

/** The enemy picked on the map, if it is one the sandbox lets the dev play: standing, and in the fight. */
export function sandboxFoe(state: ZoneState | null, dev: ZoneDevState): Unit | undefined {
  if (!state?.sandbox || !dev.picked) return undefined;
  return state.units.find((u) => u.id === dev.picked && u.side === "enemy" && !u.down && !!state.encounter?.order.includes(u.id));
}
