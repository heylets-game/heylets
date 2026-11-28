// A voyage on screen: what the map view adds when its map is a ship at sea
// (packages/world/src/voyage).
//
//   the sea     VoyageLayer draws the drift field every frame: each thing
//               where the rules say it is at this moment (drift.ts), bobbing
//               on the water, sliding astern. The server sends no positions;
//               both ends work them out from the sea's seed and the time.
//   stations    a harpoon gun each side by the bow and the helm at the
//               stern, stood on the deck.
//   the hands   a tap on the water, with your hero at a gun, looses a
//               harpoon at whatever is adrift nearest the tap (or at the
//               water, and misses). The helm is two buttons in the strip.
//   the strip   hull, hold and how much of the stretch is left, across the
//               top; and how it ended, when it has.
//
// `useVoyage` is all the map view needs of it: a click to offer first, and
// something to show.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { hexDistance, type HexPos } from "@gantt-quest/core";
import { LANES, STATIONS, driftField, framePage, lanesOver, seaOf, shipFrame, stationsOn, type Drifting, type SeaThingId, type Station, type Unit, type VoyageOptions, type VoyageState, type ZoneView } from "@gantt-quest/world";
import type { ZoneSend } from "../useZone";
import { buildLowPoly } from "../render/gearModels";
import { tileTop, type WorldRenderer } from "../render/WorldRenderer";

const SQRT3 = Math.sqrt(3);
const SEA_TOP = tileTop({ q: 0, r: 0, biome: "water", h: 0 });
/** A mounted harpoon gun: how large the hand weapon's model is built for the deck, and the colour of its trim. */
const GUN_SCALE = 0.07;
const GUN_TRIM = "#c9a24a";
/** How near a tap must fall to something adrift to be taken as aimed at it, in hexes. */
const TAP_NEAR = 1.4;

/** Where a point of the ship's frame is in the world. */
const worldOf = (v: VoyageOptions, at: { x: number; y: number }) => {
  const page = framePage(v, at);
  return { x: page.x * SQRT3, z: page.y * SQRT3 };
};

const WOOD = new THREE.MeshLambertMaterial({ color: "#8a6238" });
const DARK_WOOD = new THREE.MeshLambertMaterial({ color: "#5d4024" });
const IRON = new THREE.MeshLambertMaterial({ color: "#4a4f58" });
const GLASS = new THREE.MeshLambertMaterial({ color: "#6fb38f" });
const STONE = new THREE.MeshLambertMaterial({ color: "#6f6a64" });
const ROPE = new THREE.LineBasicMaterial({ color: "#e8dcc0" });

/** What each thing adrift looks like: a few plain solids, sat in the water. One entry per kind (voyage/seathings.ts). */
const MODELS: Record<SeaThingId, () => THREE.Object3D> = {
  driftwood: () => {
    const g = new THREE.Group();
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.1, 7), WOOD);
    log.rotation.z = Math.PI / 2;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), DARK_WOOD);
    branch.position.set(0.15, 0.08, 0.2);
    branch.rotation.set(Math.PI / 2.4, 0, 0.5);
    g.add(log, branch);
    return g;
  },
  crate: () => {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), WOOD);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.66), DARK_WOOD);
    band.position.y = 0.12;
    g.add(box, band);
    g.rotation.set(0.12, 0.4, -0.1);
    return g;
  },
  barrel: () => {
    const g = new THREE.Group();
    const cask = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.6, 10), WOOD);
    cask.rotation.z = Math.PI / 2;
    for (const x of [-0.18, 0.18]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.05, 10), IRON);
      hoop.rotation.z = Math.PI / 2;
      hoop.position.x = x;
      g.add(hoop);
    }
    g.add(cask);
    return g;
  },
  bottle: () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, 8), GLASS);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 6), GLASS);
    neck.position.y = 0.22;
    g.add(body, neck);
    g.rotation.z = 1.1;
    return g;
  },
  wreckage: () => {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5 - i * 0.2, 0.07, 0.24), i % 2 ? DARK_WOOD : WOOD);
      plank.position.set((i % 2 ? 0.1 : -0.1) * i, 0.02 * i, (i - 1.5) * 0.27);
      plank.rotation.y = (i - 1.5) * 0.12;
      g.add(plank);
    }
    const spar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 6), DARK_WOOD);
    spar.position.set(0.1, 0.4, 0);
    spar.rotation.z = 0.5;
    g.add(spar);
    return g;
  },
  rock: () => {
    const g = new THREE.Group();
    for (const [x, z, s] of [[0, 0, 0.7], [0.5, 0.2, 0.45], [-0.45, -0.25, 0.5]]) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(s * 0.7, s * 1.5, 5), STONE);
      tooth.position.set(x, s * 0.45, z);
      tooth.rotation.y = x * 3 + z;
      g.add(tooth);
    }
    return g;
  },
};

/** A station as it stands on the deck. */
function stationModel(station: Station): THREE.Object3D {
  const g = new THREE.Group();
  if (station.kind === "helm") {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6), DARK_WOOD);
    post.position.y = 0.35;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 14), WOOD);
    wheel.position.set(0, 0.72, 0.05);
    g.add(post, wheel);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.76, 5), DARK_WOOD);
      spoke.position.copy(wheel.position);
      spoke.rotation.z = (i * Math.PI) / 4;
      g.add(spoke);
    }
    return g;
  }
  // The gun itself is the heroes' own harpoon gun (render/gearModels.ts), built large and laid on a swivel post
  // with its harpoon pointing out over the rail: the same thing a hero carries, as a ship mounts it.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6), IRON);
  post.position.y = 0.27;
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.3), IRON);
  yoke.position.y = 0.56;
  g.add(post, yoke);
  const built = buildLowPoly("harpoon-gun", GUN_TRIM);
  if (built) {
    const gun = built.model;
    // Its barrel runs up its own height: tipped over to lie level, muzzle outboard, a little above the rail.
    gun.scale.setScalar(GUN_SCALE);
    gun.rotation.z = (-station.side * Math.PI) / 2 + station.side * 0.12;
    gun.position.set(station.side * 0.12, 0.7, 0);
    g.add(gun);
  }
  // Pushed out to the rail.
  g.position.x = station.side * 0.42;
  return g;
}

/** The drift field and the stations, in the map view's scene. */
class VoyageLayer {
  private readonly group = new THREE.Group();
  private readonly adrift = new Map<number, THREE.Object3D>();
  private readonly lines: { line: THREE.Line; until: number }[] = [];
  private readonly stop: () => void;
  private v: VoyageOptions | null = null;
  private voyage: VoyageState | null = null;
  /** The page's clock when the voyage's time was last told, and whether it is running on (no fight, not over). */
  private told = 0;
  private running = false;
  private stood = false;

  constructor(private readonly renderer: WorldRenderer) {
    renderer.addObject(this.group);
    this.stop = renderer.addTicker((_dt, _camera, clock) => this.tick(clock));
  }

  dispose() {
    this.stop();
    this.renderer.removeObject(this.group);
  }

  /** Time at sea now, as the rules reckon it: what the server last said, and what has run by here since. */
  now(): number {
    if (!this.voyage) return 0;
    return this.voyage.t + (this.running ? performance.now() - this.told : 0);
  }

  set(v: VoyageOptions, voyage: VoyageState, running: boolean) {
    if (!this.voyage || this.voyage.t !== voyage.t || this.running !== running) this.told = performance.now();
    [this.v, this.voyage, this.running] = [v, voyage, running];
    if (this.stood) return;
    this.stood = true;
    for (const station of stationsOn(v)) {
      const model = stationModel(station);
      const at = worldOf(v, shipFrame(v, station.pos));
      model.position.x += at.x;
      model.position.z = at.z;
      model.position.y = tileTop({ q: 0, r: 0, biome: "dock", h: 0 });
      this.group.add(model);
    }
  }

  /** What is adrift now, in the ship's frame. */
  field(): Drifting[] {
    return this.voyage ? driftField(seaOf(this.voyage), this.now(), this.voyage.steers, new Set(this.voyage.taken)) : [];
  }

  /** A harpoon's line, from a gun to a point of the ship's frame: shown for a moment. */
  loose(from: { x: number; y: number }, to: { x: number; y: number }) {
    if (!this.v) return;
    const [a, b] = [worldOf(this.v, from), worldOf(this.v, to)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, 0.9, a.z), new THREE.Vector3(b.x, SEA_TOP + 0.1, b.z)]), ROPE);
    this.group.add(line);
    this.lines.push({ line, until: performance.now() + 450 });
  }

  private tick(clock: number) {
    const stamp = performance.now();
    for (let i = this.lines.length - 1; i >= 0; i--) {
      if (this.lines[i].until > stamp) continue;
      this.group.remove(this.lines[i].line);
      this.lines[i].line.geometry.dispose();
      this.lines.splice(i, 1);
    }
    if (!this.v) return;
    const seen = new Set<number>();
    for (const thing of this.field()) {
      seen.add(thing.n);
      let model = this.adrift.get(thing.n);
      if (!model) {
        model = MODELS[thing.kind]();
        model.userData.turn = (thing.n * 2.399) % (Math.PI * 2);
        this.adrift.set(thing.n, model);
        this.group.add(model);
      }
      const at = worldOf(this.v, thing);
      // Riding the swell, each on its own beat.
      const beat = clock * 1.6 + thing.n * 1.7;
      model.position.set(at.x, SEA_TOP + (thing.kind === "rock" ? 0 : 0.03 + Math.sin(beat) * 0.035), at.z);
      model.rotation.y = model.userData.turn + (thing.kind === "rock" ? 0 : Math.sin(beat * 0.5) * 0.25);
    }
    for (const [n, model] of this.adrift) {
      if (seen.has(n)) continue;
      this.group.remove(model);
      this.adrift.delete(n);
    }
  }
}

const strip: React.CSSProperties = {
  position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 6, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "center",
  padding: "8px 14px", background: "rgba(38, 24, 14, 0.9)", border: "2px solid #7a5a36", borderRadius: 6, color: "#f1e2c2", font: "13px/1.2 system-ui, sans-serif", maxWidth: "min(94vw, 720px)",
};
const meter = (share: number, color: string): React.CSSProperties => ({ display: "inline-block", width: 96, height: 9, borderRadius: 4, background: `linear-gradient(90deg, ${color} ${share * 100}%, rgba(0,0,0,0.45) ${share * 100}%)`, border: "1px solid rgba(0,0,0,0.5)", verticalAlign: "middle", marginLeft: 6 });

export interface VoyageHooks {
  /** Offer a click on a hex of the map to the voyage first: true if it was the voyage's (a tap on the water). */
  click(pos: HexPos): boolean;
  /** What the voyage shows over the map: nothing, on a map that is no voyage. */
  hud: ReactNode;
}

/**
 * A voyage's part of the map view: its sea in the scene, its taps, and its strip. `self` is the hero the player
 * is acting as; `send` sends an action to the map's room.
 */
export function useVoyage(renderer: RefObject<WorldRenderer | null>, state: ZoneView | null, self: Unit | undefined, send: (action: ZoneSend) => unknown): VoyageHooks {
  const layer = useRef<VoyageLayer | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [, beat] = useState(0);
  const v = state?.options.voyage;
  const voyage = state?.voyage;
  const running = !!voyage && !voyage.outcome && !state?.encounter;

  useEffect(() => {
    if (!v || !voyage || !renderer.current) return;
    layer.current ??= new VoyageLayer(renderer.current);
    layer.current.set(v, voyage, running);
  }, [v, voyage, running, renderer]);
  useEffect(() => () => {
    layer.current?.dispose();
    layer.current = null;
  }, []);
  // The strip's stretch meter creeps on between what the server says.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => beat((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(id);
  }, [hint]);

  if (!v || !voyage || !state) return { click: () => false, hud: null };
  const stations = stationsOn(v);
  const near = (kind: Station["kind"]) => (self ? stations.filter((s) => s.kind === kind && hexDistance(self.pos, s.pos) <= 1) : []);
  const ready = (s: Station) => (voyage.ready[s.id] ?? 0) <= (layer.current?.now() ?? voyage.t);

  const click = (pos: HexPos): boolean => {
    const tile = state.map.tiles.find((t) => t.q === pos.q && t.r === pos.r);
    if (tile?.biome !== "water" || !self) return false;
    if (voyage.outcome) return true;
    if (state.encounter) return setHint("Not with boarders on the deck."), true;
    const tap = shipFrame(v, pos);
    // The gun on the side tapped, if the hero is standing at it.
    const gun = near("harpoon").find((s) => s.side * tap.x > 0);
    if (!gun) return setHint("Stand at a harpoon gun, then tap something adrift on its side of the ship."), true;
    if (!ready(gun)) return setHint("The line is still being hauled in."), true;
    if (voyage.hold.length >= voyage.holdMax) return setHint("The hold is full."), true;
    const from = shipFrame(v, gun.pos);
    const field = layer.current?.field() ?? [];
    const target = field.map((d) => ({ d, off: Math.hypot(d.x - tap.x, d.y - tap.y) })).filter((c) => c.off <= TAP_NEAR).sort((a, b) => a.off - b.off)[0]?.d;
    const at = target ?? tap;
    layer.current?.loose(from, at);
    send({ type: "harpoon", unit: self.id, station: gun.id, aim: { x: at.x - from.x, y: at.y - from.y } });
    return true;
  };

  const helm = near("helm")[0];
  const over = lanesOver(voyage);
  const steer = (dir: -1 | 1) => send({ type: "steer", unit: self!.id, dir });
  const now = layer.current?.now() ?? voyage.t;
  const left = Math.max(0, 1 - now / voyage.ms);
  const hauls = voyage.hold.flat();
  const gold = hauls.reduce((n, s) => n + (s.t === "gold" ? s.n : 0), 0);
  const things = hauls.reduce((n, s) => n + (s.t === "res" ? s.n : 0), 0);

  const tip =
    hint ??
    (state.encounter ? "Boarders! Clear the deck."
    : near("harpoon").length > 0 ? "Tap something adrift on your gun's side to harpoon it. Rocks are no use: steer round them."
    : helm ? "At the helm: put her over to dodge rocks or close on salvage."
    : "Stand at a harpoon gun by the bow, or at the helm at the stern.");

  const hud = (
    <div style={strip} role="status">
      <strong>{state.options.name ?? "At sea"}</strong>
      <span title="How much more her hull will take. Rocks that drift into her take it off: steer round them at the helm.">
        Hull {voyage.hull}/{voyage.hullMax}
        <span style={meter(voyage.hull / voyage.hullMax, voyage.hull / voyage.hullMax < 0.35 ? "#c8553d" : "#7fb069")} />
      </span>
      <span title={`What has been hauled aboard: ${gold} gold and ${things} of materials so far. It is shared out when she is through.`}>
        Hold {voyage.hold.length}/{voyage.holdMax}
      </span>
      {!voyage.outcome && (
        <span title="How much of this stretch of sea is still to sail.">
          {left > 0 ? "To sail" : "Nearly through"}
          <span style={meter(left, "#6fa8c9")} />
        </span>
      )}
      {!voyage.outcome && helm && !state.encounter && (
        <span>
          <button className="small" disabled={!ready(helm) || over <= -LANES} title={STATIONS.helm.blurb} onClick={() => steer(-1)}>◀ Port</button>{" "}
          <button className="small" disabled={!ready(helm) || over >= LANES} title={STATIONS.helm.blurb} onClick={() => steer(1)}>Starboard ▶</button>
        </span>
      )}
      {voyage.outcome === "through" && <strong style={{ color: "#bfe3a0" }}>Through! The hold has been shared out.</strong>}
      {voyage.outcome === "sunk" && <strong style={{ color: "#f0a48f" }}>Her hull has given way. The hold is lost: leave the map and she limps home.</strong>}
      {!voyage.outcome && <span style={{ flexBasis: "100%", textAlign: "center", opacity: 0.85 }}>{tip}</span>}
    </div>
  );
  return { click, hud };
}
