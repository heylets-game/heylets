// The dev toolbox: a small spanner at the foot of the camera's buttons on the
// right edge of a map (in the bottom-right corner where there is none), there
// only on a development deployment (the worker's ENVIRONMENT is "dev":
// local and staging; see devTools.ts). It opens a window docked down the left
// side of the screen, top to bottom, and no wider than leaves the bottom bar
// and the turn bar over it clear (dockWidth), in the fight
// interface's timber (the combat log's: zone/fight.css): its name, its tabs
// and its close and minimize buttons stay put at the top, and only the tab
// under them scrolls. Minimized, it is that top alone. It has a tab for each
// kind of tool:
//
//   Audio/visual  open the model preview, a stage for trying any figure's
//                 animations (FigureLab.tsx); hold the time of day and the
//                 weather where you want them, and see what the audio engine
//                 is doing. Your own tab only.
//   Items         add gold to your hero's purse, or take it away; put a
//                 chosen piece of gear, or some of a material, in your
//                 hero's pack, or take a material away.
//   Maps/combat   make a zone (a map to walk and fight on) and walk into it;
//                 while one is on screen, place enemies, paint the ground and
//                 the rest (zone/MapsTab.tsx).
//
// Gold and items are changed on the server (server/dev.ts), which refuses
// outside a development deployment. They are your own hero's alone.
//
// T opens it in full (from shut or minimized), and shuts it when it is open.
//
// Open or shut, minimized or not, and the tab it was on, it stays that way
// from view to view and across a reload.

import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GEAR_BASES, HERO_CLASSES, RARITIES, RESOURCE_KINDS, SLOTS, SLOT_LABEL, WEAPONS, slotOfRef, type Rarity, type ResourceKind, type Slot } from "@gantt-quest/world";
import { api, type Me } from "./api";
import { SkyAndSound } from "./audio/SoundButton";
import { itemName, label } from "./labels";
import { PixelIcon } from "./PixelIcon";
import { BLOCKY_KEY } from "./render/figures";
import { DevSection } from "./DevSection";
import { WRENCH } from "./ui/menuIcons";
import { MapsTab } from "./zone/MapsTab";

/** Loaded only when it is opened: it is a dev tool, and no part of the game. */
const FigureLab = lazy(() => import("./FigureLab"));

const OPEN_KEY = "gq.dev.readout";
const TAB_KEY = "gq.dev.tab";
const FOLDED_KEY = "gq.dev.folded";
const TABS = [
  ["av", "Audio/visual"],
  ["items", "Items"],
  ["maps", "Maps/combat"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Tabs there once were, and where what was on them is now. */
const FORMER_TABS: Record<string, Tab> = { gold: "items", sky: "av", figures: "av" };

const recall = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Blocked storage: it stays as it is until the page is closed.
  }
};

/**
 * The camera's column of buttons on the right edge of the map on screen (render/WorldRenderer.ts builds it, outside
 * React), so the spanner can sit at its foot. Null on a screen with no map. A window's view in a hut is drawn by a
 * renderer of its own, with a column nobody sees, so only one that is laid out counts.
 */
function useCameraColumn(): HTMLElement | null {
  const [column, setColumn] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => {
      const shown = [...document.querySelectorAll<HTMLElement>(".camera-rotate")].filter((el) => el.getClientRects().length > 0);
      const next = shown[shown.length - 1] ?? null;
      setColumn((prev) => (prev === next ? prev : next));
    };
    find();
    // Looked for again once a frame at most, however much of the page changes in it.
    let frame = 0;
    const watch = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), find()));
    });
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return column;
}

/** The bottom bar and the turn bar over it: the toolbox stays to the left of both. */
const BARS = ".hud.full .hud-rack, .fight-turn-bar";
/** The toolbox's widest, and the gap it keeps from the bars. */
const DOCK_MAX = 500;
const DOCK_GAP = 10;

/**
 * How wide the docked toolbox may be: DOCK_MAX, or less where the bars on screen come nearer the left edge than
 * that. Measured on the screen (the toolbox is outside the views the UI scale zooms), looked at again twice a
 * second and on resizing, as the bars come and go with fights. Null: as wide as it likes.
 */
function useDockWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const lefts = [...document.querySelectorAll<HTMLElement>(BARS)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.left);
      const room = lefts.length > 0 ? Math.floor(Math.min(...lefts)) - 8 - DOCK_GAP : null;
      const next = room === null || room >= DOCK_MAX ? null : Math.max(260, room);
      setWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    const timer = setInterval(measure, 500);
    addEventListener("resize", measure);
    return () => {
      clearInterval(timer);
      removeEventListener("resize", measure);
    };
  }, []);
  return width;
}

export function DevToolbox({ me, refresh }: { me: Me; refresh(): Promise<void> }) {
  const column = useCameraColumn();
  const [open, setOpen] = useState(() => recall(OPEN_KEY) === "1");
  // (Gold, Sky & sound and Figures had tabs of their own once: they are on Items and Audio/visual now.)
  const [tab, setTab] = useState<Tab>(() => TABS.find(([id]) => id === (FORMER_TABS[recall(TAB_KEY) ?? ""] ?? recall(TAB_KEY)))?.[0] ?? "av");
  const [lab, setLab] = useState(false);
  // The old box people had a switch here once; with it gone, nobody is left stuck with them (from the next reload).
  useEffect(() => {
    if (recall(BLOCKY_KEY) === "1") remember(BLOCKY_KEY, null);
  }, []);
  const width = useDockWidth();
  const [folded, setFolded] = useState(() => recall(FOLDED_KEY) === "1");
  const fold = (on: boolean) => {
    remember(FOLDED_KEY, on ? "1" : null);
    setFolded(on);
  };
  // T: open in full, from shut or minimized; open, shut. Not while typing, or with a modifier held.
  const shown = open && !folded;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const at = e.target as HTMLElement | null;
      if (at?.closest?.("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (shown) return show(false);
      fold(false);
      show(true);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [shown]);
  const show = (on: boolean) => {
    remember(OPEN_KEY, on ? "1" : null);
    setOpen(on);
  };
  const pick = (id: Tab) => {
    remember(TAB_KEY, id);
    setTab(id);
  };
  const spanner = (
    <button type="button" className={`dev-corner ${column ? "in-column" : ""} ${open ? "selected" : ""}`} title="Dev toolbox (T)" aria-label="Dev toolbox" aria-keyshortcuts="T" aria-pressed={open} onClick={() => show(!open)}>
      <PixelIcon rows={WRENCH} size={column ? 18 : 14} />
    </button>
  );
  return (
    <>
      {column ? createPortal(spanner, column) : spanner}
      {open && (
        <aside className={`dev-dock ${folded ? "folded" : ""}`} role="dialog" aria-label="Dev toolbox" style={width ? { width } : undefined}>
          {/* Stays put while the tab under it scrolls. */}
          <div className="dev-dock-top">
            <strong className="dev-dock-title">Dev toolbox</strong>
            {/* Minimized, the name and the two buttons are all there is. */}
            {folded ? <span className="dev-dock-gap" /> : (
              <div className="dev-tabs" role="tablist" aria-label="Dev tools">
                {TABS.map(([id, name]) => (
                  <button key={id} role="tab" aria-selected={tab === id} className={`small ${tab === id ? "selected" : ""}`} onClick={() => (pick(id), fold(false))}>
                    {name}
                  </button>
                ))}
              </div>
            )}
            <button className="dev-dock-btn" aria-expanded={!folded} aria-label={folded ? "Show the dev toolbox" : "Minimize the dev toolbox"} title={folded ? "Show" : "Minimize"} onClick={() => fold(!folded)}>
              {folded ? "+" : "–"}
            </button>
            <button className="dev-dock-btn" aria-label="Close" title="Close" onClick={() => show(false)}>×</button>
          </div>
          {!folded && (
            <div className="dev-dock-body">
          {tab === "av" && (
            <div className="dev-seed">
              <DevSection id="av.models" title="Model preview" open>
                <p className="muted">A stage for any hero, townsperson or enemy: walk, strike, shoot, sit, row, slowed or a frame at a time.</p>
                <div className="dev-row">
                  <button className="small primary" onClick={() => setLab(true)}>Open the model preview</button>
                </div>
              </DevSection>
              <DevSection id="av.sky" title="Sky & sound" open>
                <SkyAndSound />
              </DevSection>
            </div>
          )}
          {tab === "maps" && (me.character?.status === "active" ? <MapsTab /> : <p className="muted">Create a character first: there is no hero to walk in.</p>)}
          {tab === "items" && <Seeding key="items" me={me} refresh={refresh}>{(seed) => (
            <>
              <h4>Gold</h4>
              <GoldSeed me={me} seed={seed} />
              <ItemSeed me={me} seed={seed} />
            </>
          )}</Seeding>}
            </div>
          )}
        </aside>
      )}
      {lab && (
        <Suspense fallback={null}>
          <FigureLab me={me} onClose={() => setLab(false)} />
        </Suspense>
      )}
    </>
  );
}

/** Run one seeding call, then read the hero again so the bar and the bag show it. `said` turns the answer into a line. */
type Seed = <T>(call: () => Promise<T>, said: (result: T) => string) => void;

/** A seeding tab: its controls, and under them what the last press did, or why it did nothing. It needs a hero to give things to. */
function Seeding({ me, refresh, children }: { me: Me; refresh(): Promise<void>; children(seed: Seed): ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null);
  if (me.character?.status !== "active") return <p className="muted">Create a character first: there is no hero to give things to yet.</p>;
  const seed: Seed = (call, line) => {
    setBusy(true);
    call()
      .then(async (result) => {
        await refresh();
        setSaid({ text: line(result) });
      })
      .catch((err: Error) => setSaid({ text: err.message, bad: true }))
      .finally(() => setBusy(false));
  };
  return (
    <fieldset className="dev-seed" disabled={busy}>
      {children(seed)}
      <p className={`dev-said ${said?.bad ? "bad" : "muted"}`} role="status">
        {said?.text}
      </p>
    </fieldset>
  );
}

const count = (n: number) => n.toLocaleString("en");
/** A whole number above nothing from a field, or null if it is not one. */
const wholeOf = (text: string) => (/^\d+$/.test(text.trim()) && Number(text) > 0 ? Number(text) : null);

function GoldSeed({ me, seed }: { me: Me; seed: Seed }) {
  const c = me.character!;
  const [amount, setAmount] = useState("1000");
  const n = wholeOf(amount);
  const give = (by: number) => seed(() => api.devGold(by), (r) => `${by > 0 ? "Added" : "Took"} ${count(Math.abs(by))} gold. The purse holds ${count(r.gold)}.`);
  return (
    <>
      <p>
        {c.name} has <strong>{count(c.gold)}</strong> gold.
      </p>
      <div className="dev-row">
        <input type="number" min={1} step={100} value={amount} aria-label="Gold" onChange={(e) => setAmount(e.target.value)} />
        <button className="small primary" disabled={!n} onClick={() => give(n!)}>
          Add
        </button>
        <button className="small" disabled={!n || c.gold === 0} onClick={() => give(-Math.min(n!, c.gold))}>
          Take
        </button>
      </div>
      <div className="dev-row">
        {[100, 1000, 10_000, 100_000].map((by) => (
          <button key={by} className="small" onClick={() => give(by)}>
            +{count(by)}
          </button>
        ))}
      </div>
    </>
  );
}

/** Every piece of gear there is, grouped for the picker: each class's weapons, then the armor and trinkets slot by slot. */
const GEAR_GROUPS: ({ classId: string; refs: string[] } | { slot: Slot; refs: string[] })[] = [
  ...HERO_CLASSES.map((c) => ({ classId: c.id, refs: Object.values(WEAPONS).filter((w) => w.classId === c.id).map((w) => w.id) })),
  ...SLOTS.filter((s) => s !== "main_hand").map((slot) => ({ slot, refs: GEAR_BASES.filter((b) => slotOfRef(b.ref) === slot).map((b) => b.ref) })),
].filter((g) => g.refs.length > 0);

function ItemSeed({ me, seed }: { me: Me; seed: Seed }) {
  const c = me.character!;
  // The hero's own first weapon to start with, so the first press gives something they can use.
  const [ref, setRef] = useState(() => HERO_CLASSES.find((h) => h.id === c.class_id)?.weapons[0] ?? GEAR_GROUPS[0].refs[0]);
  const [rarity, setRarity] = useState<Rarity>("rare");
  const [level, setLevel] = useState(String(c.level));
  const [kind, setKind] = useState<ResourceKind>("wood");
  const [qty, setQty] = useState("10");
  const lv = wholeOf(level);
  const n = wholeOf(qty);
  const held = me.materials?.[kind] ?? 0;
  const material = label("resource", kind).toLowerCase();
  const giveMaterial = (by: number) => seed(() => api.devMaterial(kind, by), (r) => `${by > 0 ? "Added" : "Took"} ${count(Math.abs(by))} ${material}. The pack holds ${count(r.qty)}.`);
  return (
    <>
      {me.carry && (
        <p className="muted">
          Pack: {me.carry.carried} of {me.carry.limit} squares filled.
        </p>
      )}
      <h4>Gear</h4>
      <div className="dev-row">
        <select value={ref} aria-label="Gear" onChange={(e) => setRef(e.target.value)}>
          {GEAR_GROUPS.map((g) =>
            "classId" in g ? (
              <optgroup key={g.classId} label={`${label("class", g.classId)}${g.classId === c.class_id ? " (your class)" : ""}`}>
                {g.refs.map((r) => (
                  <option key={r} value={r}>
                    {label("weapon", r)}
                  </option>
                ))}
              </optgroup>
            ) : (
              <optgroup key={g.slot} label={SLOT_LABEL[g.slot]}>
                {g.refs.map((r) => (
                  <option key={r} value={r}>
                    {label("gear", r)}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
      </div>
      <div className="dev-row">
        <select value={rarity} aria-label="Rarity" onChange={(e) => setRarity(e.target.value as Rarity)}>
          {RARITIES.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
        <label>
          Level <input type="number" min={1} max={50} value={level} onChange={(e) => setLevel(e.target.value)} />
        </label>
        <button className="small primary" disabled={!lv} onClick={() => seed(() => api.devGear(ref, rarity, lv!), (r) => `${itemName(r.item)} is in the pack.`)}>
          Add to pack
        </button>
      </div>
      <h4>Materials</h4>
      <div className="dev-row">
        <select value={kind} aria-label="Material" onChange={(e) => setKind(e.target.value as ResourceKind)}>
          {RESOURCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {label("resource", k)}
            </option>
          ))}
        </select>
        <input type="number" min={1} value={qty} aria-label="How many" onChange={(e) => setQty(e.target.value)} />
        <button className="small primary" disabled={!n} onClick={() => giveMaterial(n!)}>
          Add
        </button>
        <button className="small" disabled={!n || held === 0} onClick={() => giveMaterial(-Math.min(n!, held))}>
          Take
        </button>
        <span className="muted">{count(held)} in the pack</span>
      </div>
    </>
  );
}
