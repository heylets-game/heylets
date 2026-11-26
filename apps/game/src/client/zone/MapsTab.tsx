// The dev toolbox's Maps tab: make a zone to try fights in and walk into
// it, and, while one is on screen, set up whatever is being tested: put an
// enemy group down, paint the ground, add a stand-in crewmate, heal up,
// end the fight, take every enemy off the map, stop the enemy taking turns,
// keep heroes from going down, take the time limit off turns, have any
// enemy use any of its abilities (the Combat section: every turn before its
// own is passed for it),
// and make any hero of yours on it (you, or a stand-in) any class, level and
// weapon with any of the class's abilities. That last holds on that map,
// through a reload, and leaves your own character as it is.
//
// Making a map is a dev route (worker.ts, /api/dev/zone); everything done
// to an open one is a dev action over its socket (zoneDev.ts), which the
// server refuses outside a development deployment.

import { useEffect, useState } from "react";
import { ABILITIES, ENEMY_ABILITIES, MAX_PARTY, CLIMES, DEFAULT_ZONE_OPTIONS, ENEMIES, HERO_CLASSES, SITES, SITE_IDS, SURFACE_INFO, WEAPONS, poolFor, type SurfaceKind, type ZoneBiome, type ZoneSize } from "@gantt-quest/world";
import { api, PROFILE } from "../api";
import { setZoneDev, useZoneDev, type KitHero, type ZoneDevState } from "./zoneDev";

const SIZES: ZoneSize[] = ["small", "medium", "large"];
const BIOMES: ZoneBiome[] = ["meadow", "woods", "caves", "shore"];
const SURFACES = Object.keys(SURFACE_INFO) as SurfaceKind[];
const KINDS = Object.keys(ENEMIES);
const LEVELS = ["none", "a little", "some", "a lot"];
const OPTIONS_KEY = "gq.dev.zone";

const recall = (): Record<string, unknown> => {
  try {
    return JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
  } catch {
    return {};
  }
};

export function MapsTab() {
  const dev = useZoneDev();
  // `site` and `clime` empty: whatever suits the ground. `tier` 0: not a place on the atlas (no spoils when it is cleared).
  const [options, setOptions] = useState(() => ({ ...DEFAULT_ZONE_OPTIONS, lead: "", seed: "", site: "", clime: "", tier: 0, stone: 0, ...recall() }));
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [spawn, setSpawn] = useState({ kind: "wolf", count: 2 });
  const [paint, setPaint] = useState<{ surface: SurfaceKind | "clear"; wide: boolean }>({ surface: "poison", wide: true });
  const [standIn, setStandIn] = useState(HERO_CLASSES[0].id);
  const set = (change: Partial<typeof options>) => {
    const next = { ...options, ...change };
    setOptions(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // Blocked storage: the choices last until the page is closed.
    }
  };

  const generate = () => {
    setBusy(true);
    const { lead, seed, site, clime, tier, stone, ...rest } = options;
    api
      .devZone({ ...rest, kinds: lead ? [lead] : [], seed: seed.trim() || undefined, ...(site ? { site } : {}), ...(clime ? { clime } : {}), ...(tier > 0 ? { tier, stone } : {}) })
      .then(({ code, seed: used }) => {
        setSaid({ text: `Map ${code}, from seed "${used}". Walking in.` });
        location.hash = `zone/${code}`;
      })
      .catch((err: Error) => setSaid({ text: err.message, bad: true }))
      .finally(() => setBusy(false));
  };
  const number = (key: "groups" | "clear" | "party" | "tier" | "stone", min: number, max: number, label: string) => (
    <label>
      {label}
      <input type="number" min={min} max={max} value={options[key]} onChange={(e) => set({ [key]: Math.max(min, Math.min(max, Number(e.target.value) || min)) })} />
    </label>
  );
  const level = (key: "elevation" | "obstacles", label: string) => (
    <label>
      {label}
      <select value={options[key]} onChange={(e) => set({ [key]: Number(e.target.value) })}>
        {LEVELS.map((name, i) => <option key={i} value={i}>{name}</option>)}
      </select>
    </label>
  );
  const send = dev.open?.send;
  const tool = dev.tool;
  const link = dev.open ? `${location.origin}${location.pathname}?p=${PROFILE === "2" ? "3" : "2"}#zone/${dev.open.code}` : "";

  return (
    <fieldset className="dev-seed dev-maps" disabled={busy}>
      <p><strong>Make a map</strong> <span className="muted">and walk into it. The start is open ground; the enemy stand beyond it, and a fight starts when you run up to one (or hit one from afar).</span></p>
      <div className="dev-row">
        <label>
          Size
          <select value={options.size} onChange={(e) => set({ size: e.target.value as ZoneSize })}>{SIZES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label>
          Ground
          <select value={options.biome} onChange={(e) => set({ biome: e.target.value as ZoneBiome })}>{BIOMES.map((b) => <option key={b}>{b}</option>)}</select>
        </label>
        <label>
          Place
          <select value={options.site} onChange={(e) => set({ site: e.target.value })}>
            <option value="">whatever suits</option>
            {SITE_IDS.map((s) => <option key={s} value={s}>{SITES[s].name}</option>)}
          </select>
        </label>
        <label>
          Climate
          <select value={options.clime} onChange={(e) => set({ clime: e.target.value })}>
            <option value="">greenwood</option>
            {CLIMES.filter((c) => c !== "greenwood").map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="dev-row">
        {number("groups", 0, 8, "Enemy groups")}
        <label>
          Led by
          <select value={options.lead} onChange={(e) => set({ lead: e.target.value })}>
            <option value="">whatever suits</option>
            {KINDS.filter((k) => k !== "dummy").map((k) => <option key={k} value={k}>{ENEMIES[k].name}</option>)}
            <option value="dummy">{ENEMIES.dummy.name}</option>
          </select>
        </label>
        {number("party", 1, MAX_PARTY, "Sized for")}
      </div>
      <div className="dev-row">
        {level("elevation", "High ground")}
        {level("obstacles", "Clutter")}
        {number("clear", 2, 8, "Open start")}
        {number("tier", 0, 40, "Atlas ring (0: none)")}
        {number("stone", 0, 3, "Stone carried")}
      </div>
      <div className="dev-row">
        <label>
          Seed
          <input value={options.seed} placeholder="a new one each time" onChange={(e) => set({ seed: e.target.value })} />
        </label>
        <button className="small primary" onClick={generate}>Make it and walk in</button>
      </div>

      {dev.open && send && (
        <>
          <p><strong>Map <span className="selectable code">{dev.open.code}</span></strong> <span className="muted">is on screen.</span></p>
          <div className="dev-row">
            <button className="small" onClick={() => send({ op: "heal" })}>Heal and restock everyone</button>
            <button className="small" onClick={() => send({ op: "start_fight" })}>Start a fight here</button>
            <button className="small" onClick={() => send({ op: "end_fight" })}>End the fight</button>
            <button className="small" onClick={() => send({ op: "clear_surfaces" })}>Clear the ground</button>
            <button className="small" onClick={() => send({ op: "clear_enemies" })}>Clear all enemies</button>
          </div>
          <div className="dev-row">
            <label><input type="checkbox" checked={dev.flags.aiOff} onChange={(e) => send({ op: "ai", off: e.target.checked })} /> Enemy takes no turns</label>
            <label><input type="checkbox" checked={dev.flags.undying} onChange={(e) => send({ op: "undying", on: e.target.checked })} /> Heroes cannot die</label>
            <label><input type="checkbox" checked={dev.flags.timerOff} onChange={(e) => send({ op: "timer", off: e.target.checked })} /> No turn timer</label>
          </div>
          <Combat dev={dev} send={send} />
          <div className="dev-row">
            <label>
              Enemy
              <select value={spawn.kind} onChange={(e) => setSpawn({ ...spawn, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{ENEMIES[k].name}</option>)}</select>
            </label>
            <label>
              How many
              <input type="number" min={1} max={6} value={spawn.count} onChange={(e) => setSpawn({ ...spawn, count: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })} />
            </label>
            <button className={`small ${tool?.tool === "spawn" ? "selected" : ""}`} onClick={() => setZoneDev({ tool: tool?.tool === "spawn" ? null : { tool: "spawn", kinds: Array.from({ length: spawn.count }, () => spawn.kind) } })}>
              {tool?.tool === "spawn" ? "Done placing" : "Place a group: click the map"}
            </button>
          </div>
          <div className="dev-row">
            <label>
              Ground
              <select value={paint.surface} onChange={(e) => setPaint({ ...paint, surface: e.target.value as SurfaceKind | "clear" })}>
                {SURFACES.map((s) => <option key={s} value={s}>{SURFACE_INFO[s].name}</option>)}
                <option value="clear">Clear it</option>
              </select>
            </label>
            <label><input type="checkbox" checked={paint.wide} onChange={(e) => setPaint({ ...paint, wide: e.target.checked })} /> a hex and those round it</label>
            <button className={`small ${tool?.tool === "paint" ? "selected" : ""}`} onClick={() => setZoneDev({ tool: tool?.tool === "paint" ? null : { tool: "paint", surface: paint.surface === "clear" ? null : paint.surface, wide: paint.wide } })}>
              {tool?.tool === "paint" ? "Done painting" : "Paint: click the map"}
            </button>
          </div>
          <div className="dev-row">
            <label>
              Stand-in crewmate
              <select value={standIn} onChange={(e) => setStandIn(e.target.value)}>{HERO_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <button className="small" onClick={() => send({ op: "standin", classId: standIn })}>Add one beside you</button>
          </div>
          {dev.heroes.map((h) => <HeroKit key={h.id} hero={h} send={send} />)}
          <p className="muted">A second player: open <a href={link} target="_blank" rel="noreferrer">this link</a> in another window. Stand-ins are yours to play on their turns.</p>
        </>
      )}
      <p className={`dev-said ${said?.bad ? "bad" : "muted"}`} role="status">{said?.text}</p>
    </fieldset>
  );
}

/**
 * Combat: pick an enemy (from the list, or by clicking it on the map) and have it use one of its abilities, at a hero
 * of your choosing or whoever it likes. Every turn before its own is passed for it (DevOp "enemy_use").
 */
function Combat({ dev, send }: { dev: ZoneDevState; send: NonNullable<ZoneDevState["open"]>["send"] }) {
  const enemies = dev.units.filter((u) => u.side === "enemy");
  const heroes = dev.units.filter((u) => u.side === "hero");
  const foe = enemies.find((u) => u.id === dev.picked);
  const [ability, setAbility] = useState("");
  const [target, setTarget] = useState("");
  // A new enemy picked: its first ability, unless the one chosen is one of its own too.
  const using = foe?.abilities.includes(ability) ? ability : (foe?.abilities[0] ?? "");
  const at = heroes.some((h) => h.id === target) ? target : "";
  const picking = dev.tool?.tool === "pick";
  // The same name more than once (two Dire Wolves): told apart by a number.
  const label = (id: string, name: string) => {
    const same = enemies.filter((u) => u.name === name);
    return same.length > 1 ? `${name} ${same.findIndex((u) => u.id === id) + 1}` : name;
  };

  return (
    <div className="dev-kit-hero">
      <p><strong>Combat</strong> <span className="muted">Have an enemy use an ability. Every turn before its own is passed, and a fight is started if it is in none.</span></p>
      <div className="dev-row">
        <label>
          Enemy
          <select value={foe?.id ?? ""} onChange={(e) => setZoneDev({ picked: e.target.value || null })}>
            <option value="">pick one</option>
            {enemies.map((u) => <option key={u.id} value={u.id}>{label(u.id, u.name)}</option>)}
          </select>
        </label>
        <button className={`small ${picking ? "selected" : ""}`} onClick={() => setZoneDev({ tool: picking ? null : { tool: "pick", side: "enemy" } })}>
          {picking ? "Stop picking" : "Pick one: click the map"}
        </button>
      </div>
      {foe && (
        <div className="dev-row">
          <label>
            Ability
            <select value={using} onChange={(e) => setAbility(e.target.value)}>
              {foe.abilities.map((id) => <option key={id} value={id}>{ENEMY_ABILITIES[id]?.name ?? id}</option>)}
            </select>
          </label>
          <label>
            At
            <select value={at} onChange={(e) => setTarget(e.target.value)}>
              <option value="">whoever it likes</option>
              {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <button className="small primary" disabled={!using} onClick={() => send({ op: "enemy_use", unit: foe.id, ability: using, ...(at ? { target: at } : {}) })}>Use it</button>
        </div>
      )}
    </div>
  );
}

/** One of your heroes on the map, to make any class, level, weapon and set of class abilities (as many as you like). */
function HeroKit({ hero, send }: { hero: KitHero; send: NonNullable<ReturnType<typeof useZoneDev>["open"]>["send"] }) {
  const weaponsOf = (classId: string) => Object.values(WEAPONS).filter((w) => w.classId === classId);
  const fresh = () => ({
    classId: hero.classId,
    level: hero.level,
    weapon: hero.weapon && WEAPONS[hero.weapon]?.classId === hero.classId ? hero.weapon : (weaponsOf(hero.classId)[0]?.id ?? ""),
    abilities: poolFor(hero.classId).map((e) => e.id).filter((id) => hero.abilities.includes(id)),
  });
  const [kit, setKit] = useState(fresh);
  // What the map says they are, whenever that changes (set here, or by another window).
  const key = `${hero.classId}|${hero.level}|${hero.weapon}|${hero.abilities.join(",")}`;
  useEffect(() => setKit(fresh()), [key]);

  const pool = poolFor(kit.classId);
  const setClass = (classId: string) => setKit({ ...kit, classId, weapon: weaponsOf(classId)[0]?.id ?? "", abilities: poolFor(classId).map((e) => e.id).slice(0, 3) });
  const toggle = (id: string) => setKit({ ...kit, abilities: kit.abilities.includes(id) ? kit.abilities.filter((a) => a !== id) : [...kit.abilities, id] });
  const apply = () => send({ op: "kit", unit: hero.id, ...kit });

  return (
    <div className="dev-kit-hero">
      <p>
        <strong>{hero.name}</strong>
      </p>
      <div className="dev-row">
        <label>
          Class
          <select value={kit.classId} onChange={(e) => setClass(e.target.value)}>{HERO_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label>
          Weapon
          <select value={kit.weapon} onChange={(e) => setKit({ ...kit, weapon: e.target.value })}>{weaponsOf(kit.classId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </label>
        <label>
          Level
          <input type="number" min={1} max={20} value={kit.level} onChange={(e) => setKit({ ...kit, level: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
        </label>
      </div>
      {pool.length > 0 ? (
        <div className="dev-row dev-abilities">
          {pool.map((e) => (
            <label key={e.id} title={ABILITIES[e.id]?.blurb}>
              <input type="checkbox" checked={kit.abilities.includes(e.id)} onChange={() => toggle(e.id)} /> {ABILITIES[e.id]?.name ?? e.id}
            </label>
          ))}
        </div>
      ) : (
        <p className="muted">This class has no class abilities yet.</p>
      )}
      <div className="dev-row">
        <button className="small primary" onClick={apply}>Make it so</button>
        <span className="muted">Full health, and every cooldown ready.</span>
      </div>
    </div>
  );
}
