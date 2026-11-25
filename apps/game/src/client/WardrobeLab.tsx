// The wardrobe lab: a dev-only page for looking at what a hero wears on the body and the legs, each piece on a
// hero (render/figures.ts) beside its icons (itemArt.ts and its little model, render/gearModels.ts), so the
// look can be held up against the name. Click a piece to see it on one large hero, and pick how large.
// Opened at #lab/wardrobe on the dev server.
//
// Nothing here touches the server or a game being played.

import { useMemo, useState } from "react";
import { GEAR_BASES, HERO_CLASSES, RARITY_COLOR, starterGarb, type Outfit, type Rarity } from "@gantt-quest/world";
import { FigurePreview } from "./FigurePreview";
import { itemArtUrl } from "./itemArt";
import { voxelIconUrl } from "./ui/voxel";

const BODY = ["hauberk", "greatcoat", "diving_plate"];
const LEGS = ["greaves", "trousers", "diving_legs"];
const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
const TURNS: [string, number][] = [["Front", 0.3], ["Side", Math.PI / 2], ["Back", Math.PI]];

export default function WardrobeLab() {
  const [classId, setClassId] = useState(HERO_CLASSES[0].id);
  const [rarity, setRarity] = useState<Rarity>("rare");
  const [aim, setAim] = useState({ turn: 0.3, n: 0 });
  const [walk, setWalk] = useState(false);
  const [big, setBig] = useState(400);
  // One piece looked at closely, on one large hero, with its icons large.
  const [focus, setFocus] = useState<["body" | "legs", string] | null>(null);
  const garb = useMemo(() => starterGarb(classId), [classId]);
  const piece = (ref: string) => {
    const base = GEAR_BASES.find((b) => b.ref === ref);
    if (base) return { icon: base.icon, ref, rarity, name: base.name };
    const g = garb.find((x) => x.ref === ref)!;
    return { icon: g.icon, ref, rarity: g.rarity, name: g.name };
  };
  // Each piece on a hero in the class's own clothes otherwise, so it is seen as it would be worn.
  const dressed = (slot: "body" | "legs", ref: string): Outfit => {
    const out: Outfit = {};
    for (const g of garb) out[g.slot] = { icon: g.icon, ref: g.ref, rarity: g.rarity };
    const p = piece(ref);
    out[slot] = { icon: p.icon, ref: p.ref, rarity: p.rarity };
    return out;
  };
  const rows: ["body" | "legs", string][] = [
    ...(["garb_tunic", ...BODY].map((r) => ["body", r]) as ["body", string][]),
    ...(["garb_trousers", ...LEGS].map((r) => ["legs", r]) as ["legs", string][]),
  ];
  const accent = RARITY_COLOR[rarity];
  return (
    <div style={{ padding: 16, color: "#eee", background: "#1d2233", minHeight: "100vh", overflow: "auto" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {HERO_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
          {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {TURNS.map(([label, turn]) => <button key={label} onClick={() => setAim((a) => ({ turn, n: a.n + 1 }))}>{label}</button>)}
        <button onClick={() => setWalk((w) => !w)}>{walk ? "Stand" : "Walk"}</button>
        <select value={big} onChange={(e) => setBig(Number(e.target.value))} aria-label="Size of the close-up">
          {[400, 700, 1000].map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </div>
      {!focus && (
        <div data-icons style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: 8, justifyContent: "start", marginBottom: 12 }}>
          {rows.map(([, ref]) => (
            <div key={ref} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <img src={voxelIconUrl(piece(ref).icon, accent)} width={88} height={88} alt="" />
              <img src={itemArtUrl(piece(ref).icon, accent)} width={54} height={54} alt="" style={{ imageRendering: "pixelated" }} />
            </div>
          ))}
        </div>
      )}
      {focus && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {rows.map(([slot, ref]) => <button key={ref} data-focus={ref} onClick={() => setFocus([slot, ref])}>{ref}</button>)}
          </div>
          <FigurePreview classId={classId} outfit={dressed(...focus)} size={big} aim={aim} walk={walk} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <img src={voxelIconUrl(piece(focus[1]).icon, accent)} width={96} height={96} alt="" />
            <img src={itemArtUrl(piece(focus[1]).icon, accent)} width={96} height={96} alt="" style={{ imageRendering: "pixelated" }} />
            <span>{piece(focus[1]).name}</span>
            <button onClick={() => setFocus(null)}>Close</button>
          </div>
        </div>
      )}
      <div style={{ display: focus ? "none" : "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
        {rows.map(([slot, ref]) => {
          const p = piece(ref);
          return (
            <figure key={ref} data-ref={ref} style={{ margin: 0, background: "#272d42", borderRadius: 8, padding: 8 }}>
              {!focus && <FigurePreview classId={classId} outfit={dressed(slot, ref)} size={160} aim={aim} walk={walk} />}
              <figcaption style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }} onClick={() => setFocus([slot, ref])}>
                <img src={voxelIconUrl(p.icon, accent)} width={40} height={40} alt="" />
                <span>{p.name}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
