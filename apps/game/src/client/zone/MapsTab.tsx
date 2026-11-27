// The dev toolbox's Maps tab: make a zone to try fights in and walk into
// it, and, while one is on screen, set up whatever is being tested: put an
// enemy group down, paint the ground, add a stand-in crewmate, heal up,
// end the fight, take every enemy off the map, stop the enemy taking turns, end every hero's turn after a second,
// keep heroes from going down, take the time limit off turns, keep the camera
// still (this viewer's alone), play a fight
// by hand (the combat sandbox: any hero or enemy in it, at any time),
// and make any hero of yours on it (you, or a stand-in) any class, level and
// weapon with any of the class's abilities. That last holds on that map,
// through a reload, and leaves your own character as it is.
//
// Making a map is a dev route (worker.ts, /api/dev/zone); everything done
// to an open one is a dev action over its socket (zoneDev.ts), which the
// server refuses outside a development deployment.

import { useEffect, useState } from "react";
import { ABILITIES, ENEMY_DEV_MAX_LEVEL, KIT_MAX_LEVEL, MAX_PARTY, CLIMES, DEFAULT_ZONE_OPTIONS, ENEMIES, HERO_CLASSES, SITES, SITE_IDS, SURFACE_INFO, WEAPONS, poolFor, type SurfaceKind, type ZoneBiome, type ZoneSize } from "@gantt-quest/world";
import { api, PROFILE } from "../api";
import { DevSection } from "../DevSection";
import { setCameraStill, setZoneDev, useZoneDev, type KitHero, type ZoneDevTool } from "./zoneDev";

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
  // `level` empty: the map's.
  const [spawn, setSpawn] = useState({ kind: "wolf", count: 1, level: "" });
  const [heroLevel, setHeroLevel] = useState("5");
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
  // The tools as the settings beside them say now. An armed one follows the settings: change the enemy, how many,
  // the level or the ground while placing or painting, and the next click uses the new choice.
  const spawnTool = (): ZoneDevTool => ({ tool: "spawn", kinds: Array.from({ length: spawn.count }, () => spawn.kind), ...(Number(spawn.level) >= 1 ? { level: Math.min(ENEMY_DEV_MAX_LEVEL, Math.floor(Number(spawn.level))) } : {}) });
  const paintTool = (): ZoneDevTool => ({ tool: "paint", surface: paint.surface === "clear" ? null : paint.surface, wide: paint.wide });
  useEffect(() => {
    if (tool?.tool === "spawn") setZoneDev({ tool: spawnTool() });
  }, [spawn]);
  useEffect(() => {
    if (tool?.tool === "paint") setZoneDev({ tool: paintTool() });
  }, [paint]);
  const link = dev.open ? `${location.origin}${location.pathname}?p=${PROFILE === "2" ? "3" : "2"}#zone/${dev.open.code}` : "";

  return (
    <fieldset className="dev-seed dev-maps" disabled={busy}>
      <DevSection id="maps.make" title="Make a map" open>
      <p className="muted">Walk into it. The start is open ground; the enemy stand beyond it, and a fight starts when you run up to one (or hit one from afar).</p>
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
        {number("stone", 0, 3, "Charter says")}
      </div>
      <div className="dev-row">
        <label>
          Seed
          <input value={options.seed} placeholder="a new one each time" onChange={(e) => set({ seed: e.target.value })} />
        </label>
        <button className="small primary" onClick={generate}>Make it and walk in</button>
      </div>
      </DevSection>

      {dev.open && send && (
        <>
          <p><strong>Map <span className="selectable code">{dev.open.code}</span></strong> <span className="muted">is on screen.</span></p>
          <DevSection id="maps.sandbox" title="Combat sandbox" open>
            <p className="muted">A fight goes by your hand: no enemy takes its turn, no turn ends of itself, nothing is timed, and there is no battle music. Turns come round when you move them on.</p>
            <button className={`dev-big ${dev.flags.sandbox ? "selected" : ""}`} aria-pressed={dev.flags.sandbox} onClick={() => send({ op: "sandbox", on: !dev.flags.sandbox })}>
              {dev.flags.sandbox ? "Sandbox active" : "Enable Sandbox"}
            </button>
            <div className="dev-row">
              {dev.flags.sandbox && (
                <>
                  <button className="small" onClick={() => send({ op: "next_turn" })}>Next turn</button>
                  <button className="small" onClick={() => send({ op: "next_turn", round: true })}>Next round</button>
                  <button className={`small ${dev.tool?.tool === "place" ? "selected" : ""}`} onClick={() => setZoneDev({ tool: dev.tool?.tool === "place" ? null : { tool: "place" } })}>
                    {dev.tool?.tool === "place" ? "Done teleporting" : "Teleport currently selected unit"}
                  </button>
                </>
              )}
            </div>
            {dev.flags.sandbox && <p className="muted">Everyone in the fight is yours to play, on anyone's turn, as often as you like: AP and cooldowns are put back after everything you do. Click an enemy in it, or anyone in the turn order, to play them.</p>}
          </DevSection>
          <DevSection id="maps.fight" title="Fight controls" open>
          <div className="dev-row">
            <button className="small" onClick={() => send({ op: "heal" })}>Heal and restock everyone</button>
            <button className="small" onClick={() => send({ op: "start_fight" })}>Start a fight here</button>
            <button className="small" onClick={() => send({ op: "end_fight" })}>End the fight</button>
            <button className="small" onClick={() => send({ op: "clear_surfaces" })}>Clear the ground</button>
            <button className="small" onClick={() => send({ op: "clear_enemies" })}>Clear all enemies</button>
          </div>
          <div className="dev-row">
            <label><input type="checkbox" checked={dev.flags.aiOff} onChange={(e) => send({ op: "ai", off: e.target.checked })} /> Enemy takes no turns</label>
            <label title="Every hero turn ends by itself after 1s."><input type="checkbox" checked={dev.flags.heroesIdle} onChange={(e) => send({ op: "heroes_idle", on: e.target.checked })} /> Heroes skip turns</label>
            <label><input type="checkbox" checked={dev.flags.undying} onChange={(e) => send({ op: "undying", on: e.target.checked })} /> Heroes cannot die</label>
            <label><input type="checkbox" checked={dev.flags.timerOff} onChange={(e) => send({ op: "timer", off: e.target.checked })} /> No turn timer</label>
            <label title="Nobody is followed and no shot is framed: the camera goes only where you pan it. Yours alone, remembered on this device."><input type="checkbox" checked={dev.cameraStill} onChange={(e) => setCameraStill(e.target.checked)} /> No camera follow</label>
          </div>
          </DevSection>
          <DevSection id="maps.place" title="Enemies & ground" open>
          <div className="dev-row">
            <label>
              Enemy
              <select value={spawn.kind} onChange={(e) => setSpawn({ ...spawn, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{ENEMIES[k].name}</option>)}</select>
            </label>
            <label>
              How many
              <input type="number" min={1} max={6} value={spawn.count} onChange={(e) => setSpawn({ ...spawn, count: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })} />
            </label>
            <label>
              Level
              <input type="number" min={1} max={ENEMY_DEV_MAX_LEVEL} value={spawn.level} placeholder="the map's" onChange={(e) => setSpawn({ ...spawn, level: e.target.value })} />
            </label>
            <button className={`small ${tool?.tool === "spawn" ? "selected" : ""}`} onClick={() => setZoneDev({ tool: tool?.tool === "spawn" ? null : spawnTool() })}>
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
            <button className={`small ${tool?.tool === "paint" ? "selected" : ""}`} onClick={() => setZoneDev({ tool: tool?.tool === "paint" ? null : paintTool() })}>
              {tool?.tool === "paint" ? "Done painting" : "Paint: click the map"}
            </button>
          </div>
          </DevSection>
          <DevSection id="maps.crew" title="Crew" note="stand-ins, and your heroes' kits">
          <div className="dev-row">
            <label>
              Stand-in crewmate
              <select value={standIn} onChange={(e) => setStandIn(e.target.value)}>{HERO_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <button className="small" onClick={() => send({ op: "standin", classId: standIn })}>Add one beside you</button>
          </div>
          <div className="dev-row">
            <label>
              Every hero on the map at level
              <input type="number" min={1} max={KIT_MAX_LEVEL} value={heroLevel} onChange={(e) => setHeroLevel(e.target.value)} />
            </label>
            <button className="small" onClick={() => send({ op: "hero_levels", level: Math.max(1, Math.min(KIT_MAX_LEVEL, Math.floor(Number(heroLevel)) || 1)) })}>Set them all</button>
          </div>
          {dev.heroes.map((h) => <HeroKit key={h.id} hero={h} send={send} />)}
          <p className="muted">A second player: open <a href={link} target="_blank" rel="noreferrer">this link</a> in another window. Stand-ins are yours to play on their turns.</p>
          </DevSection>
        </>
      )}
      <p className={`dev-said ${said?.bad ? "bad" : "muted"}`} role="status">{said?.text}</p>
    </fieldset>
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
