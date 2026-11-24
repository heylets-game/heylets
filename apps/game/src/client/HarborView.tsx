// The crew's shared Harbor: a walkable place where everyone present sees
// each other. Each member has a hut, the waygate opens onto the crew's atlas,
// and the notice board carries the news of each release of the game (with
// a bouncing "!" over it until you have read the newest).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAudioScene } from "./audio/useAudioScene";
import { hexDistance, hexNeighbors, type HexPos } from "@gantt-quest/core";
import { GATHER_SPOTS, GATHER_SPOT_IDS, HARBOR_APOTHECARY, HARBOR_LAPIDARY, HARBOR_BOARD, HARBOR_BUILDINGS, footing, HARBOR_CAVE, HARBOR_WAYGATE, HARBOR_CHEST, HARBOR_GALLEY, HARBOR_LIGHTHOUSE, HARBOR_SMITHY, HARBOR_GATHER, HARBOR_NAME, HARBOR_PLOTS, HARBOR_PLOT_FACING, HARBOR_PUB, HARBOR_RING, HARBOR_SHOP, HARBOR_SPAWN, HARBOR_WORKS, PLOT_PRICE, RESOURCE_KINDS, SHACK_COST, binFill, binNeeds, builtProjects, BOOK_TITLE, fishFrom, harborDoor, tileAt, type FishSpot, FISH_SPOTS, HOLE_NAMES, holeFishNames, generateHarbor, projectById, projectProgress, harborPoi, hutTier, poiAt, salesman, gardenBeds, gardenCorner, gardenLooks, plotAt, gardenSpotAt, GARDEN_SPOTS, HARBOR_WELL, HARBOR_WELL_AT, bedProgress, nextReady, readyCount, growText, type GardenBed, type GatherSpot, type Resources, regular as regularOf, regularTalk, type RegularId, roofColor, DECORATOR, DECORATOR_SHUT, FINISHES_STALL, HARBOR_FINISHES, decoratorOpen, decoratorOpensAt, decoratorTalk, FISHMONGER, FISHMONGER_FACES, FISHMONGER_POS, isFishmongerAt, fishmongerAdvice, fishmongerTalk, fishmongerTip, bestHole } from "@gantt-quest/world";
import { FURNISHINGS as FURNITURE, flotsamName, flotsamWithin } from "@gantt-quest/world";
import type { Poi, Vessel, WorldMap } from "@gantt-quest/world";
import { MusterPanel, useMuster } from "./atlas/Muster";
import { api, type Me, type RegularsView } from "./api";
import { BaitPanel } from "./BaitPanel";
import { CatchPanel } from "./CatchPanel";
import { ChatInput } from "./ChatInput";
import { AccountPanel } from "./Account";
import { CrewRoster, type RosterMember } from "./CrewRoster";
import { NoticeBoard } from "./board/NoticeBoard";
import { AttentionMark } from "./AttentionMark";
import { PlaceTitle } from "./PlaceTitle";
import { hasUnseen } from "../releases";
import { OptionsMenu } from "./OptionsMenu";
import { DragPanel } from "./DragPanel";
import { HudBar } from "./ui/Hud";
import { Logbook } from "./Logbook";
import { GatherPanel } from "./GatherPanel";
import { useFishingHoles } from "./useFishingHoles";
import { useFlotsam } from "./useFlotsam";
import { BottleNote } from "./BottleNote";
import { Garden } from "./Garden";
import { WellMenu } from "./WellMenu";
import { GardenMarks, type GardenMarkInfo } from "./GardenMarks";
import { IndoorMarks, insidePoi, insideWords } from "./IndoorMarks";
import { HeroSheet, useHeroSheet } from "./HeroSheet";
import { LOOK_CHANGED } from "./ChangeLook";
import { InventoryScreen } from "./InventoryScreen";
import { ShopScreen } from "./ShopScreen";
import { TileAction } from "./TileAction";
import { Trading } from "./TradePanel";
import { WorldRenderer, hexToWorld, type RenderHero, type RenderState } from "./render/WorldRenderer";
import { useHarbor } from "./useHarbor";
import { useOwnLook } from "./ownLook";
import { useSalesman } from "./salesmanClock";
import { WorksPanel } from "./works/WorksPanel";
import { TownChest, readChestAhead } from "./chest/TownChest";
import { label } from "./labels";
import { xpEvents } from "./xpEvents";
import { RegularPanel } from "./RegularPanel";
import { FinishesPanel } from "./FinishesPanel";
import { useConversation } from "./useConversation";
import { regularHero, regularOn, regularUnit, useRegularsAbout } from "./useRegularsAbout";
import { useBanter } from "./useBanter";
import "./pub.css";

const same = (a: HexPos, b: HexPos) => a.q === b.q && a.r === b.r;
/**
 * The Harbor opens seen from a little east of south, about eighteen degrees off the rows of hexes: its streets
 * and lanes are laid along those rows, and squared to the screen they look ruled. From here the buildings on
 * the island's edge, turned in toward the square, show their fronts.
 */
const HARBOR_VIEW_YAW = 0.32;

/** "10 wood and 6 stone". */
const costText = (r: Resources) => {
  const parts = RESOURCE_KINDS.filter((k) => (r[k] ?? 0) > 0).map((k) => `${r[k]} ${label("resource", k).toLowerCase()}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "nothing");
};

/** The hex the notice board itself stands on (it is read from the hex beside it): the "!" floats over this one. */
const BOARD_STANDS = footing(HARBOR_BOARD, "single", HARBOR_BUILDINGS.find((b) => b.id === "board")?.facing)[0];

/**
 * The things used from a hex of the street beside them (the town chest, the notice board, the waygate:
 * a `single` footing). That hex is ground people walk over, so a click on it is only a walk. A building's
 * doorstep is its own, and a click on it means the building.
 */
const BESIDE = new Set(HARBOR_BUILDINGS.filter((b) => b.shape === "single").map((b) => b.id));

/** The doorstep of whatever stands on a hex: a building's, or the well's (a piece of the town's dressing, drawn from beside it). */
const doorOf = (at: HexPos): HexPos | null => harborDoor(at) ?? (same(at, HARBOR_WELL_AT) ? HARBOR_WELL : null);

/**
 * The place a pointer is on: the one whose model it is on (`model`, its id, as the renderer picked it), or whose
 * ground that hex is, or whose doorstep it is. Hovering and clicking both ask this, so what lights up under the
 * pointer is what a click walks to and goes into.
 */
function placeUnder(pois: Poi[], at: HexPos, model?: string | null): Poi | undefined {
  // (A hut's garden is a place only once the hut stands: before, its patch of greens is scenery.)
  if (model) return pois.find((p) => p.id === model && !(p.kind === "garden" && !p.beds));
  const door = doorOf(at);
  if (door) return pois.find((p) => same(p.pos, door));
  const on = pois.find((p) => same(p.pos, at));
  return on && !BESIDE.has(on.id) ? on : undefined;
}

/**
 * Every place in the Harbor is a structure to be used (it lights up under the pointer, and a click on it walks the
 * hero to its door and, see `goIn`, in) but these: the rocks and the wreck, which are scenery; and a plot for sale or being built on, which lights up only for whoever has something to do there (see
 * `lights`, in the view). A new kind of place lights up without being added anywhere.
 */
const NO_STRUCTURE = new Set<Poi["kind"]>(["rocks", "wreck", "lot", "site"]);

/**
 * The place a hero stands at and what there is to do there: `run` is its main button, in the bar along the
 * bottom. Walked to by a click on the place itself, it is gone into on arriving with nothing more to press:
 * `enter` if it has one, else `run`.
 */
interface Here {
  title: ReactNode;
  label: string;
  run(): void;
  /** Offered in the bar only, and never done unasked (open ground to sleep on). */
  quiet?: boolean;
  /** Shut for now: it says so and offers nothing. */
  closed?: boolean;
  also?: { label: string; run(): void };
  /**
   * Done only by pressing its button, which also floats over the hero's head: for what spends or commits
   * something the player may not have meant (gold for a plot, materials into a bin), and for what is no way in.
   */
  press?: boolean;
  /** What a click on the place does on arriving, where that is not `run`. */
  enter?(): void;
}
/** What walking up to a place by clicking it does on arriving, if anything: its way in. The one rule for every place. */
const goIn = (here: Here | null): (() => void) | null => (!here || here.closed || here.quiet ? null : here.enter ?? (here.press ? null : here.run));

/**
 * `resting`: the player is somewhere else (inside one of the Harbor's buildings, out on a map, at the atlas), and
 * the Harbor is kept behind it, built but put away: not drawn, not connected, none of its panels up. Coming back
 * to it is then at once.
 */
/**
 * How many times Bram has been asked for advice in this browser: each asking gets the next piece, from the first,
 * so he says every one before he says any again (fishmongerAdvice). Without storage, it counts for this page.
 */
let askedHere = 0;
function nextAdvice(): number {
  try {
    const was = Number(localStorage.getItem("gq.bram.advice") ?? "-1");
    const n = Number.isFinite(was) ? was + 1 : 0;
    localStorage.setItem("gq.bram.advice", String(n));
    return n;
  } catch {
    return askedHere++;
  }
}

/**
 * The boat a hero has with them: the one they own, all the time, not only once they stand on water. The renderer draws
 * it under them only while they are on a water hex, so one rowing back to shore stays in it until they reach land
 * rather than walking the last of the water. Someone on water with no boat known is in a barrel.
 */
function boatOf(map: WorldMap, p: { pos: HexPos; vessel?: Vessel | null }): Vessel | undefined {
  return p.vessel ?? (tileAt(map, p.pos)?.biome === "water" ? "barrel" : undefined);
}

export function HarborView({ me, refresh, resting = false, inside = null }: { me: Me; refresh(): Promise<unknown>; resting?: boolean; inside?: string | null }) {
  useAudioScene("harbor", !resting);
  /** Whether the Harbor was made put away (the game was opened somewhere else: on a map, in a building). */
  const born = useRef(resting);
  const mount = useRef<HTMLDivElement>(null);
  const renderer = useRef<WorldRenderer | null>(null);
  const [hover, setHover] = useState<HexPos | null>(null);
  const [sheet, setSheet] = useState(false);
  const [book, setBook] = useState(false);
  const [shop, setShop] = useState(false);
  const [notices, setNotices] = useState(false);
  const [gather, setGather] = useState<GatherSpot | null>(null);
  /** Bram the fishmonger's panels, opened from a word with him: buying the catch, and the bait counter. */
  const [fishmonger, setFishmonger] = useState(false);
  const [baitOpen, setBaitOpen] = useState(false);
  /** Bram (or his shack) was clicked: a word with him once you are beside him. */
  const [wantMonger, setWantMonger] = useState(false);
  const [works, setWorks] = useState(false);
  /** The town chest, on its dais on the west shore: the crew's shared store. */
  const [chest, setChest] = useState(false);
  /**
   * A place was clicked (its model, its ground or its doorstep): the hero is walking to its door, and goes in on
   * getting there. The door's hex. Any other click, on the ground or on another place, drops it.
   */
  const [want, setWant] = useState<HexPos | null>(null);
  /** One of the pub's regulars, out and about, just clicked: a word with them once you are beside them. */
  const [wantRegular, setWantRegular] = useState<RegularId | null>(null);
  /** The regular you are talking to, and whether their job's panel is open. */
  const [chatWith, setChatWith] = useState<RegularId | null>(null);
  const [jobOpen, setJobOpen] = useState(false);
  /** Nell's catalogue, opened from a word with her at her stall. */
  const [finishesOpen, setFinishesOpen] = useState(false);
  /** Where this player stands with each regular, from the server: read as you walk up to one. */
  const [regs, setRegs] = useState<RegularsView | null>(null);
  const loadRegs = () => void api.regulars().then(setRegs, () => undefined);
  /** The place whose model the pointer is on, by its id: `hover` alone cannot tell a roof from the ground at its door. */
  const [hoverPlace, setHoverPlace] = useState<string | null>(null);
  const [account, setAccount] = useState(false);
  /** The herb garden open in its panel, by its owner's id. */
  const [gardenOf, setGardenOf] = useState<string | null>(null);
  /** The clock the gardens grow by, moved on every few seconds: what each bed looks like is worked out from it. */
  const [clock, setClock] = useState(() => Date.now());
  /** The town well's card is open, hung over the well. */
  const [wellOpen, setWellOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const [tradeWith, setTradeWith] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  const harbor = useHarbor(
    (id, path) => renderer.current?.playEvents([{ t: "moved", heroId: id, path }]),
    (m) => renderer.current?.playEvents(xpEvents(m)),
    (id, text) => renderer.current?.say(id, text),
    !resting,
    inside,
  );
  // The crew's muster, told down the Harbor's socket: whoever says they are ready is taken to the map when it starts.
  const muster = useMuster(harbor.you ?? me.player.id, { pushed: harbor.muster, onStart: () => void refresh() });
  // A traveling salesman in the pub is worth a mention out here.
  const salesmanNow = useSalesman(me.crew?.id);
  const send = useRef(harbor.send);
  send.current = harbor.send;
  const base = useMemo(generateHarbor, []);
  // The day's regulars, out in the town by day (packages/world/src/wander.ts). Whoever you are walking up to or
  // talking to waits for you.
  const about = useRegularsAbout(renderer, me.crew?.id, "harbor", wantRegular ?? chatWith, !resting);
  // Where the fish are on the water right now: the crew's fishing holes, drawn on the water and named in the prompt.
  const holes = useFishingHoles(renderer, me.crew?.id, !resting);
  // What the sea has brought in: flotsam on the beach and the water, less what the crew has taken.
  const flotsam = useFlotsam(renderer, me.crew?.id, !resting, harbor.flotsam.gone, harbor.flotsam.sync);
  const [bottle, setBottle] = useState<{ note: string; line: string } | null>(null);
  const aboutRef = useRef(about);
  aboutRef.current = about;
  /** Your gathering outings left today, drawn as lightning bolts on your plate. Read on the way in and after anything that spends or restores them. */
  const [stamina, setStamina] = useState<{ left: number; max: number } | null>(null);
  const { board, players, indoors, you } = harbor;
  // Your own hero is drawn in what the bag shows while a change of gear is on its way; otherwise as the room tells.
  const ownOutfit = useOwnLook(players.find((p) => p.id === you)?.outfit);
  /** Go to where a crewmate is: the zone they are on (beside them), if the server says they can be joined. */
  const teleportTo = (id: string) => {
    api.teleport(id).then(({ zone, name }) => {
      if (!zone) return setNote(`${name} is not out on a map.`);
      try {
        sessionStorage.setItem("gq.zone.near", id);
      } catch {
        // Storage is off: they arrive at the map's start.
      }
      location.hash = `zone/${zone}`;
    }, (e: Error) => setNote(e.message));
  };
  // The whole crew, with whoever is walking the Harbor right now marked here (and drawn in what they wear),
  // and whoever is out on a map marked as that.
  // Someone inside one of the town's buildings is here too, tagged with where.
  const roster: RosterMember[] = useMemo(() => board.members.map((m) => {
    const p = players.find((x) => x.id === m.id) ?? indoors.find((x) => x.id === m.id);
    const tags = m.zone ? [m.zone.fighting ? "in a fight" : "on a map"] : p?.inside ? [insideWords(p, board.members)] : undefined;
    return { id: m.id, name: m.name, classId: m.classId, level: p?.level ?? m.level, here: !!p && !m.zone, outfit: p?.outfit, tags };
  }), [board.members, players, indoors]);
  const hereCount = roster.filter((m) => m.here).length;
  const built = builtProjects(board.works);
  const lit = built.includes("lighthouse");
  const apothecaryBuilt = built.includes("apothecary");
  const smithyBuilt = built.includes("smithy");
  const galleyBuilt = built.includes("galley");
  // How far the crew has got with the lighthouse, which sets which stage of building is drawn on its spit.
  const projectFill = (id: string) => {
    if (built.includes(id)) return 1;
    const paid = board.works?.projects.find((p) => p.id === id)?.paid;
    return paid ? Math.round(projectProgress(projectById(id)!, paid) * 100) / 100 : 0;
  };
  const lighthouseFill = projectFill("lighthouse");
  /** Whether Nell is at her stall: by day on the Harbor's clock. At nightfall she covers it up and goes home. Looked at every second, so she goes as the dark comes. */
  const [nellIn, setNellIn] = useState(() => decoratorOpen(Date.now()));
  useEffect(() => {
    const t = setInterval(() => setNellIn(decoratorOpen(Date.now())), 1000);
    return () => clearInterval(t);
  }, []);
  /** How long until Nell is back at her stall, in words: "in about 3 minutes". */
  const nellBack = () => {
    const min = Math.max(1, Math.round((decoratorOpensAt(Date.now()) - Date.now()) / 60_000));
    return `in about ${min} minute${min === 1 ? "" : "s"}`;
  };

  // The Harbor as the renderer sees it: the fixed map plus a hut per member.
  const scene = useMemo<RenderState | null>(() => {
    if (!you) return null;
    const pois = [
      // The lighthouse's spit, and the apothecary's, smithy's and galley's spots, are building sites until the crew has paid for them.
      ...base.pois.map((p) => (p.id === "lighthouse" ? { ...p, cleared: lit, fill: lighthouseFill } : p.id === "apothecary" ? { ...p, cleared: apothecaryBuilt, fill: projectFill("apothecary") } : p.id === "smithy" ? { ...p, cleared: smithyBuilt, fill: projectFill("smithy") } : p.id === "galley" ? { ...p, cleared: galleyBuilt, fill: projectFill("galley") } : p.id === "finishes" && !nellIn ? { ...p, shut: true } : p)),
      // A plot someone has bought has their hut on it, or a resource bin while the shack is still to go up; the rest are staked out and for sale.
      ...HARBOR_PLOTS.map((pos, i) => {
        const owner = board.members.find((m) => m.plot === i);
        const facing = HARBOR_PLOT_FACING[i];
        if (!owner) return harborPoi(`lot:${i}`, "lot", pos, facing);
        if (owner.bin) return { ...harborPoi(`site:${owner.id}`, "site", pos, facing), fill: binFill(owner.bin) };
        return { ...harborPoi(`plot:${owner.id}`, "plot", pos, facing), tier: owner.hutTier ?? 1, ...(roofColor(owner.roof) ? { roof: roofColor(owner.roof) } : {}) };
      }),
      // By every hut's door, in a corner of its doorstep, its herb garden: drawn as each bed has grown while the hut
      // stands, and as a plain patch of greens before. (After the plots, so the doorstep's own place is the hut.)
      ...HARBOR_PLOTS.map((pos, i) => {
        const owner = board.members.find((m) => m.plot === i);
        const tended = owner?.garden && !owner.bin;
        const poi = harborPoi(tended ? `garden:${owner.id}` : `garden:plot${i}`, "garden", pos, gardenCorner(i));
        return tended ? { ...poi, beds: gardenLooks(owner.garden!, gardenBeds(owner.hutTier ?? 1), clock) } : poi;
      }),
    ];
    return {
      code: "harbor",
      you,
      map: { ...base, pois },
      heroes: [
        ...players.map((p): RenderHero => ({ id: p.id, classId: p.classId, pos: p.pos, label: p.name, outfit: p.id === you ? ownOutfit : p.outfit, asleep: !!p.bedroll && same(p.bedroll, p.pos), rod: p.fishing ? (p.gilded ? "gilded" : true) : false, boat: boatOf(base, p), level: p.level, xp: p.xp })),
        ...about.map(regularHero),
        // Bram the fishmonger, at his shack by the pier, day and night.
        { id: FISHMONGER.id, classId: FISHMONGER.look, pos: FISHMONGER_POS, label: FISHMONGER.name },
        // Nell, at her counter among her samples, beside the market stall: by day. At night she has gone home.
        ...(nellIn ? [{ id: DECORATOR.id, classId: DECORATOR.look, pos: FINISHES_STALL, label: DECORATOR.name }] : []),
      ],
      freeRoam: true,
      homeYaw: HARBOR_VIEW_YAW,
      // Bedrolls laid out by whoever is resting.
      props: players.filter((p) => p.bedroll).map((p, i) => ({ id: 9000 + i, model: "bedroll", pos: p.bedroll!, facing: 0 })),
      stamina: stamina ?? undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, board, players, you, stamina, ownOutfit, clock, about, nellIn]);
  const latest = useRef(scene);
  latest.current = scene;
  const heroSheet = useHeroSheet();

  useEffect(() => {
    // A click anywhere on a place (its model, the ground it stands on, a building's doorstep) is a walk to its
    // door and the going in: nothing more to press on arriving (see `want`). A click anywhere else is only a walk.
    const r = new WorldRenderer(mount.current!, {
      onHexClick: (to, place) => {
        // Bram, at his shack: walk up beside him, and a word with him there.
        if (isFishmongerAt(to)) return walkUpMonger.current();
        setWantMonger(false);
        // One of the regulars, out and about: walk up beside them, and a word with them there.
        const who = regularOn(aboutRef.current, to);
        if (who) return walkUp.current(who.id, who.pos);
        setWantRegular(null);
        const aimed = latest.current ? placeUnder(latest.current.map.pois, to, place) : undefined;
        // A garden is drawn in a corner of its hut's doorstep, but tended from a spot of its own beside it.
        const at = aimed?.kind === "garden" ? GARDEN_SPOTS[plotAt(aimed.pos)] : aimed?.pos;
        setWant(at ? { ...at } : null);
        send.current({ type: "move", to: at ?? doorOf(to) ?? to });
      },
      onHover: setHover,
      onHoverPlace: setHoverPlace,
    }, { resting: born.current });
    renderer.current = r;
    if (latest.current) r.setState(latest.current);
    return () => {
      r.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    if (scene) renderer.current?.setState(scene);
  }, [scene]);
  // Put away while a building has the screen. (A layout effect: before the building's own view is made, in the same pass.)
  useLayoutEffect(() => {
    if (!resting) return;
    renderer.current?.setResting(true);
    // Whatever was open or under way out here is over.
    setWant(null);
    setHover(null);
    setHoverPlace(null);
    setGather(null);
    for (const close of [setSheet, setBook, setShop, setNotices, setFishmonger, setBaitOpen, setWantMonger, setWorks, setChest, setAccount]) close(false);
    setTradeWith(null);
    setGardenOf(null);
    setWellOpen(false);
    setWantRegular(null);
    talk.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resting]);
  // And brought back on stepping out of it, fading in over the building's last picture (render/handover.ts).
  useEffect(() => {
    if (!resting) renderer.current?.setResting(false);
  }, [resting]);
  // With the bag open your hero turns to face you, so you can see what they are wearing.
  useEffect(() => {
    renderer.current?.setFacingFront(sheet);
  }, [sheet]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "end" });
  }, [harbor.chat.length]);

  // Dev-only handle for driving the Harbor from the console or a test script.
  if (import.meta.env.DEV) (window as unknown as { __harbor: unknown }).__harbor = { harbor, view: renderer.current };
  const self = players.find((p) => p.id === you);

  /** A word with a regular out and about, up close (useConversation). Their job's panel opens from it. */
  const talk = useConversation({
    world: renderer,
    you,
    at: self?.pos ?? null,
    onOpen: (what) => {
      if (what === "errand") setJobOpen(true);
      else if (what === "fish") setFishmonger(true);
      else if (what === "bait") setBaitOpen(true);
      else if (what === "finishes") setFinishesOpen(true);
    },
    panelOpen: jobOpen || fishmonger || baitOpen || finishesOpen,
    closePanels: () => {
      setJobOpen(false);
      setFishmonger(false);
      setBaitOpen(false);
      setFinishesOpen(false);
    },
  });
  // The regulars passing the time of day with each other as they go about the town (not whoever you are with).
  useBanter(renderer, me.crew?.id, "harbor", !resting, [talk.active?.unit, wantRegular ? regularUnit(wantRegular) : null, chatWith ? regularUnit(chatWith) : null]);
  // The conversation over: they are on their way again.
  const talking = !!talk.active;
  useEffect(() => {
    if (talking) return;
    setChatWith(null);
    setJobOpen(false);
    setFishmonger(false);
    setBaitOpen(false);
    setFinishesOpen(false);
  }, [talking]);
  // Bram looks out at his shack's door and the water past it, but for while he is talking to someone.
  const bramDrawn = !!scene;
  useEffect(() => {
    if (!bramDrawn || talking) return;
    const t = setTimeout(() => renderer.current?.turnUnit(FISHMONGER.id, hexToWorld(FISHMONGER_FACES)), 0);
    return () => clearTimeout(t);
  }, [bramDrawn, talking]);
  /** Walk up beside a regular (they wait), or, beside them already, talk. */
  const walkUp = useRef((_id: RegularId, _at: HexPos) => {});
  walkUp.current = (id, at) => {
    if (!self || talk.active) return;
    setWant(null);
    setWantMonger(false);
    loadRegs();
    if (hexDistance(self.pos, at) <= 1 && !same(self.pos, at)) return chat(id);
    // The open ground beside them nearest you.
    const beside = hexNeighbors(at, base.grid).filter((n) => {
      const t = tileAt(base, n);
      return !!t && t.biome !== "water" && t.biome !== "rampart" && !t.built && !t.blocker;
    }).sort((a, b) => hexDistance(self.pos, a) - hexDistance(self.pos, b));
    if (!beside[0]) return;
    setWantRegular(id);
    send.current({ type: "move", to: beside[0] });
  };
  const chat = (id: RegularId) => {
    const who = regularOf(id);
    if (!who) return;
    setWantRegular(null);
    setChatWith(id);
    talk.begin(regularTalk(who, regularUnit(id)));
  };
  /** A word with Bram: he says where they are biting off the shore, if anywhere is worth it. */
  const talkToMonger = () => {
    setWantMonger(false);
    const crew = me.crew?.id;
    talk.begin(fishmongerTalk(fishmongerTip(crew ? bestHole(crew, Date.now(), true) : null), () => fishmongerAdvice(nextAdvice())));
  };
  const talkToMongerRef = useRef(talkToMonger);
  talkToMongerRef.current = talkToMonger;
  /** Walk up beside Bram, or, beside him already, talk. */
  const walkUpMonger = useRef(() => {});
  walkUpMonger.current = () => {
    if (!self || talk.active) return;
    setWant(null);
    setWantRegular(null);
    if (hexDistance(self.pos, FISHMONGER_POS) === 1) return talkToMonger();
    // The open ground beside him nearest you.
    const beside = hexNeighbors(FISHMONGER_POS, base.grid).filter((n) => {
      const t = tileAt(base, n);
      return !!t && t.biome !== "water" && t.biome !== "rampart" && !t.built && !t.blocker;
    }).sort((a, b) => hexDistance(self.pos, a) - hexDistance(self.pos, b));
    if (!beside[0]) return;
    setWantMonger(true);
    send.current({ type: "move", to: beside[0] });
  };
  const besideMonger = !!self && hexDistance(self.pos, FISHMONGER_POS) === 1;
  useEffect(() => {
    if (besideMonger && wantMonger) talkToMonger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [besideMonger, wantMonger]);
  // Beside the regular you walked up to: the conversation starts (its camera waits for you to stop).
  const wanted = wantRegular ? about.find((r) => r.id === wantRegular) : undefined;
  const besideWanted = !!self && !!wanted && hexDistance(self.pos, wanted.pos) <= 1;
  useEffect(() => {
    if (besideWanted && wantRegular) chat(wantRegular);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [besideWanted, wantRegular]);
  // Gone indoors (dusk) before you reached them: nobody to talk to.
  useEffect(() => {
    if (wantRegular && !wanted) setWantRegular(null);
  }, [wantRegular, wanted]);

  const plotIndex = self ? HARBOR_PLOTS.findIndex((p) => same(p, self.pos)) : -1;
  const hutOwner = plotIndex >= 0 ? board.members.find((m) => m.plot === plotIndex) : undefined;
  const myPlot = board.members.find((m) => m.id === you)?.plot ?? null;
  const gold = me.character?.gold ?? 0;
  // Pointing at the ground a building stands on is pointing at the building.
  // (A hut's garden shares its doorstep: pointing at the garden itself is pointing at the garden.)
  const hoverGarden = scene && hoverPlace?.startsWith("garden:") ? scene.map.pois.find((p) => p.id === hoverPlace && p.beds) : undefined;
  const hoverPoi = hoverGarden ?? (scene && hover ? poiAt(scene.map, doorOf(hover) ?? hover) : undefined);
  // The structure the pointer is on that a click would walk to and go into: it lights up with a glowing outline,
  // and the pointer becomes a hand. (A touch screen has no pointer to hover with: there a tap is the click.)
  const aimed = scene && hover ? placeUnder(scene.map.pois, hover, hoverPlace) : undefined;
  const lights = !!aimed && ((!NO_STRUCTURE.has(aimed.kind) && !(aimed.kind === "garden" && !aimed.beds)) || (aimed.kind === "lot" && myPlot === null) || aimed.id === `site:${you}`);
  /** The member whose garden a place is, and what grows in it. */
  const gardenOwner = (poi: Poi | undefined) => (poi?.kind === "garden" && poi.beds ? board.members.find((m) => `garden:${m.id}` === poi.id) : undefined);
  /** How a member's garden is coming on, in a few words: what is ready, or when the next bed will be. */
  const gardenStatus = (owner: (typeof board.members)[number]) => {
    const beds = owner.garden ?? [];
    const ready = readyCount(beds, clock);
    const next = nextReady(beds, clock);
    const bare = gardenBeds(owner.hutTier ?? 1) - beds.length;
    if (ready > 0) return `${ready} bed${ready === 1 ? "" : "s"} ready to pick`;
    if (next) return `the next bed is ready in ${growText(next, clock)}${bare > 0 ? `, ${bare} bare` : ""}`;
    return owner.id === you ? "plant its beds with herb seeds or herbs" : "nothing planted yet";
  };
  const gardenTip = (owner: (typeof board.members)[number]) => {
    const thirsty = (owner.garden ?? []).some((b) => b.readyAt > clock && !b.wateredBy);
    if (owner.id === you) return `Your herb garden: ${gardenStatus(owner)}`;
    return `${owner.name}'s herb garden: ${thirsty ? "water a bed and they pick an extra herb" : gardenStatus(owner)}`;
  };

  const visitHere = salesmanNow.here;
  const visitor = visitHere ? salesman(visitHere.salesmanId) : undefined;
  /** A release with notes this player has not read: the board wears a "!". An older server sends no seenRelease, and then there is none. */
  const unseen = me.seenRelease !== undefined && hasUnseen(me.seenRelease);
  const hoverRegular = hover ? regularOn(about, hover) : undefined;
  const hoverWho = hoverRegular ? regularOf(hoverRegular.id) : undefined;
  const hoverBram = !!hover && isFishmongerAt(hover);
  const placeTip = hoverBram ? `${FISHMONGER.name}, ${FISHMONGER.trade}. He buys your catch and sells bait. Click to walk up and talk.`
    : hoverWho ? `${hoverWho.name}, ${hoverWho.trade}. Click to walk up and talk.`
    : !hoverPoi ? null
    : hoverPoi.kind === "cave" ? "The Haunted Caverns: go down and fight what lurks in the dark"
    : hoverPoi.kind === "board" ? (unseen ? "Notice board: news of what has changed. Something new is pinned up!" : "Notice board: news of what has changed")
    : hoverPoi.kind === "shop" ? "Market stall: gear, and furniture for your hut"
    : hoverPoi.kind === "finishes" ? (nellIn ? `${DECORATOR.name}, ${DECORATOR.trade}: wallpaper, floors and roof colours for your hut. Click to walk up and talk.` : `${DECORATOR.name}'s stall, covered up for the night. She's back at first light, ${nellBack()}.`)
    : hoverPoi.kind === "ring" ? "Sparring ring: being rebuilt"
    : hoverPoi.kind === "fishing" ? `The fish shack: ${FISHMONGER.short} the fishmonger buys your catch and sells bait. Cast a line from its jetty, or anywhere along the shore`
    : hoverPoi.kind === "felling" || hoverPoi.kind === "quarry" ? `${GATHER_SPOTS[hoverPoi.kind].name}: gather hut materials`
    : hoverPoi.kind === "rocks" ? "Rocks. Ships that miss the channel find them."
    : hoverPoi.kind === "wreck" ? "A wreck on the rocks. Nobody remembers her name."
    : hoverPoi.kind === "pub" ? (visitor ? `The pub: a traveling salesman is in. ${visitor.name}, ${visitor.trade}` : "The pub: food, drink, Old Tam and the dice table")
    : hoverPoi.kind === "works" ? "The works: crew projects"
    : hoverPoi.kind === "lighthouse" ? (lit ? "The lighthouse: it lights the way home" : lighthouseFill > 0 ? "The lighthouse going up, out on the point" : "A bare point over the wreck, where the lighthouse will stand")
    : hoverPoi.kind === "waygate" ? (board.maps?.[0] ? `The waygate, open to ${board.maps[0].place}: step through` : "The waygate, shut: it opens onto the crew's atlas")
    : hoverPoi.kind === "apothecary" ? (apothecaryBuilt ? "The apothecary: potions and flasks, bought or brewed, and a keeper to haggle with" : "The apothecary's building site: a crew project at the works")
    : hoverPoi.kind === "lapidary" ? "The Lapidary: lodestones cut and worked for the atlas, and gems bought"
    : hoverPoi.kind === "smithy" ? (smithyBuilt ? "The smithy: arms and armour off the rack, your own sharpened or reinforced, and a smith to haggle with" : "The smithy's building site: a crew project at the works")
    : hoverPoi.kind === "galley" ? (galleyBuilt ? "The galley: the cook is in, with nothing to sell" : "The galley's building site: a crew project at the works")
    : hoverPoi.kind === "well" ? "The town well: fill a watering can or a water skin, or toss in a coin for luck"
    : hoverPoi.kind === "lot" ? (myPlot === null ? `A plot for sale: ${PLOT_PRICE} gold` : "An empty plot")
    : hoverPoi.kind === "site" ? (hoverPoi.id === `site:${you}` ? "Your plot: fill the bin and the shack goes up" : `${board.members.find((m) => `site:${m.id}` === hoverPoi.id)?.name ?? "Someone"}'s plot: building a shack`)
    : hoverPoi.kind === "plot" ? `${board.members.find((m) => `plot:${m.id}` === hoverPoi.id)?.name ?? "Someone"}'s ${hutTier(hoverPoi.tier ?? 1).name.toLowerCase()}`
    : gardenOwner(hoverPoi) ? gardenTip(gardenOwner(hoverPoi)!)
    : null;
  // Whoever is inside the building pointed at (their portraits bob over its roof) is named after what it is.
  const inHover = hoverPoi && !hoverBram && !hoverWho ? indoors.filter((p) => p.inside && insidePoi(p.inside) === hoverPoi.id).map((p) => p.name) : [];
  const tip = placeTip && inHover.length > 0 ? `${placeTip}. Inside: ${inHover.join(", ")}` : placeTip;

  /** The place's name alone, hung over it on a plate while it is pointed at (the tip says what it is for). */
  const ownerOf = (prefix: string) => board.members.find((m) => `${prefix}:${m.id}` === hoverPoi?.id);
  const title = !hoverPoi ? null
    : hoverPoi.kind === "cave" ? "The Haunted Caverns"
    : hoverPoi.kind === "townchest" ? "The Town Chest"
    : hoverPoi.kind === "lapidary" ? "The Lapidary"
    : hoverPoi.kind === "board" ? "Notice Board"
    : hoverPoi.kind === "shop" ? "Market Stall"
    : hoverPoi.kind === "finishes" ? "Home Furnishings"
    : hoverPoi.kind === "ring" ? "Sparring Ring"
    : hoverPoi.kind === "fishing" ? "The Fish Shack"
    : hoverPoi.kind === "felling" ? "The Tree Line"
    : hoverPoi.kind === "quarry" ? "The Quarry"
    : hoverPoi.kind === "wreck" ? "The Wreck"
    : hoverPoi.kind === "pub" ? "The Pub"
    : hoverPoi.kind === "works" ? "The Works"
    : hoverPoi.kind === "lighthouse" ? (lit || lighthouseFill > 0 ? "The Lighthouse" : "Lighthouse Point")
    : hoverPoi.kind === "waygate" ? "The Waygate"
    : hoverPoi.kind === "apothecary" ? "The Apothecary"
    : hoverPoi.kind === "smithy" ? "The Smithy"
    : hoverPoi.kind === "galley" ? "The Galley"
    : hoverPoi.kind === "well" ? "The Town Well"
    : hoverPoi.kind === "lot" ? "Plot for Sale"
    : hoverPoi.kind === "site" ? (hoverPoi.id === `site:${you}` ? "Your Plot" : `${ownerOf("site")?.name ?? "Someone"}'s Plot`)
    : hoverPoi.kind === "plot" ? (hoverPoi.id === `plot:${you}` ? `Your ${hutTier(hoverPoi.tier ?? 1).name}` : `${ownerOf("plot")?.name ?? "Someone"}'s ${hutTier(hoverPoi.tier ?? 1).name}`)
    : gardenOwner(hoverPoi) ? (hoverPoi.id === `garden:${you}` ? "Your Herb Garden" : `${gardenOwner(hoverPoi)!.name}'s Herb Garden`)
    : null;
  const invite = harbor.crew ? `${location.origin}${location.pathname}#crew/${harbor.crew.id}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this invite link:", invite);
    }
  };
  // After a change of gear, have the Harbor show everyone the new look.
  const refreshAll = async () => {
    await refresh();
    harbor.send({ type: "refresh" });
  };
  // And after a new look, saved from their sheet (ChangeLook).
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;
  useEffect(() => {
    const onLook = () => void refreshRef.current();
    window.addEventListener(LOOK_CHANGED, onLook);
    return () => window.removeEventListener(LOOK_CHANGED, onLook);
  }, []);
  const atShop = !!self && same(self.pos, HARBOR_SHOP);
  const atFinishes = !!self && same(self.pos, HARBOR_FINISHES);
  // The spot a hut's herb garden is tended from, and whose garden it is (only once their shack stands).
  const gardenSpot = self ? gardenSpotAt(self.pos) : -1;
  const gardenHere = gardenSpot >= 0 ? board.members.find((m) => m.plot === gardenSpot && m.garden && !m.bin) : undefined;
  const atBoard = !!self && same(self.pos, HARBOR_BOARD);
  const atLapidary = !!self && same(self.pos, HARBOR_LAPIDARY);
  const atWell = !!self && same(self.pos, HARBOR_WELL);
  // Walking away from the well puts its card away.
  useEffect(() => {
    if (!atWell) setWellOpen(false);
  }, [atWell]);
  const atChest = !!self && same(self.pos, HARBOR_CHEST);
  const atWaygate = !!self && same(self.pos, HARBOR_WAYGATE);
  // Where the waygate would take you without the atlas: the map a crewmate is out on, or the one you last walked off.
  const outThere = board.members.find((m) => m.id !== you && m.zone);
  // The map the crew has open out through the gate (the latest, if there are several): while there is one the gate
  // stands open, and stepping through it goes there.
  const openMap = board.maps?.[0];
  const gateOpen = !!openMap || !!harbor.muster?.code;
  // Shut, the gate is a knot of stone and brass asleep on its plinth; a map being opened bursts it out into the air.
  useEffect(() => {
    renderer.current?.setWaygateOpen(gateOpen);
  }, [gateOpen]);
  const lastMap = (() => {
    try {
      return sessionStorage.getItem("gq.atlas.zone");
    } catch {
      return null;
    }
  })();
  // A place was clicked: the hero goes in once they have walked up to its door and stopped (at once, if they stand
  // there already). What going in is comes from the place under their feet (`here`, below), the same that the bar's
  // button does, so the two cannot differ.
  const atWant = !!self && !!want && same(self.pos, want);
  const hereNow = useRef<Here | null>(null);
  useEffect(() => {
    if (!want || !atWant) return;
    const arrived = () => {
      if (you && renderer.current?.isWalking(you)) return;
      clearInterval(tick);
      setWant(null);
      goIn(hereNow.current)?.();
    };
    // Never looked at in the moment of the click itself: a walk is shown at once (useHarbor's showWalk), the hero's
    // place first and the walking of it handed to the renderer a moment after, and in between they would seem to
    // stand at the door already.
    const first = setTimeout(arrived, 0);
    const tick = setInterval(arrived, 60);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [want, atWant, you]);
  // What is in the chest is read ahead: on coming into the Harbor, and again on setting off toward it. So it opens at once.
  const wantChest = !!want && same(want, HARBOR_CHEST);
  useEffect(() => {
    if (wantChest || !chest) readChestAhead();
  }, [wantChest, chest]);
  // Its lid swings back while it is open, and falls shut after.
  useEffect(() => {
    renderer.current?.setChestOpen(chest);
  }, [chest]);
  const atRing = !!self && same(self.pos, HARBOR_RING);
  // Fishing is from anywhere along the shore, a pier head included. Afloat (a boat under them on a water hex): the
  // water's own spot, or the open sea from the edge in a rowboat. On the doorstep of a place (the lighthouse,
  // say), the place comes first.
  const onWater = !!self && tileAt(base, self.pos)?.biome === "water";
  const castFrom: FishSpot | null = self ? fishFrom(base, self.pos, onWater ? self.vessel ?? "barrel" : null) : null;
  const atShack = !!self && same(self.pos, HARBOR_GATHER.fishing);
  const pierHere: FishSpot | null = castFrom === "shore" && !atShack && self && poiAt(base, self.pos) ? null : castFrom;
  // The hole they are fishing at, if any: on it or beside it, the best if there are two.
  const holeHere = self && pierHere ? holes.filter((h) => hexDistance(h.pos, self.pos) <= 1).sort((a, b) => b.worth - a.worth)[0] : undefined;
  const gatherHere = self ? (GATHER_SPOT_IDS.find((id) => same(self.pos, HARBOR_GATHER[id])) ?? (pierHere ? "fishing" : undefined)) : undefined;
  const atPub = !!self && same(self.pos, HARBOR_PUB);
  const atCave = !!self && same(self.pos, HARBOR_CAVE);
  const atWorks = !!self && same(self.pos, HARBOR_WORKS);
  const atApothecary = !!self && same(self.pos, HARBOR_APOTHECARY);
  const atSmithy = !!self && same(self.pos, HARBOR_SMITHY);
  const atGalley = !!self && same(self.pos, HARBOR_GALLEY);
  const atLighthouse = !!self && same(self.pos, HARBOR_LIGHTHOUSE);
  // Resting: the server keeps the clock; this is only what it last told us, counted down for show.
  const [restReadyAt, setRestReadyAt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    api.gather().then((g) => {
      setRestReadyAt(g.restReadyAt);
      setStamina({ left: g.stamina.left, max: g.stamina.max });
    }, () => undefined);
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const restIn = Math.max(0, Math.ceil((restReadyAt - Date.now()) / 60_000));
  const say_ = (text: string) => {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 5000);
  };
  // Night falls while you are talking with Nell or looking through her patterns: she packs up all the same.
  const withNell = finishesOpen || talk.active?.unit === DECORATOR.id;
  useEffect(() => {
    if (nellIn || !withNell) return;
    setFinishesOpen(false);
    if (talk.active?.unit === DECORATOR.id) talk.close();
    say_(DECORATOR_SHUT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nellIn, withNell]);
  const restHere = async () => {
    try {
      const res = await api.rest("bedroll");
      setRestReadyAt(res.restReadyAt);
      setStamina({ left: res.stamina.left, max: res.stamina.max });
      harbor.send({ type: "bedroll" });
      say_(`You sleep a while. ${res.regained} gathering outing${res.regained === 1 ? "" : "s"} back: ${res.stamina.left} of ${res.stamina.max} left today.`);
    } catch (e) {
      say_((e as Error).message);
      api.gather().then((g) => setRestReadyAt(g.restReadyAt), () => undefined);
    }
  };
  const buyPlot = async (plot: number) => {
    try {
      await api.buyPlot(plot);
      await refresh();
      say_(`The plot is yours. Fill the resource bin on it with ${costText(SHACK_COST)} and the shack goes up.`);
    } catch (e) {
      say_((e as Error).message);
    }
  };
  // The bin on your own plot, while the shack is still to go up, and what you hold that could go in it.
  const myBin = hutOwner?.id === you ? hutOwner.bin : undefined;
  const [held, setHeld] = useState<Resources | null>(null);
  useEffect(() => {
    if (!myBin) return;
    let live = true;
    api.hut().then((h) => live && setHeld(h.resources), () => undefined);
    return () => {
      live = false;
    };
  }, [!!myBin]);
  const fillBin = async () => {
    try {
      const res = await api.fillBin();
      setHeld((h) => {
        const next = { ...(h ?? {}) };
        for (const k of RESOURCE_KINDS) if (res.put[k]) next[k] = Math.max(0, (next[k] ?? 0) - res.put[k]!);
        return next;
      });
      await refresh();
      say_(res.bin === null ? `In go ${costText(res.put)}. The bin is full and the shack goes up!` : `In go ${costText(res.put)}. The bin still wants ${costText(binNeeds(res.bin))}.`);
    } catch (e) {
      say_((e as Error).message);
    }
  };
  // Remembered so that leaving a hut or the pub puts you back at its door; without it you come back at the usual spot.
  const goInside = (at: string, hash: string) => {
    try {
      sessionStorage.setItem("gq.harborAt", at);
    } catch {
      // Storage is off: the usual spot it is.
    }
    location.hash = hash;
  };
  /** Down into the caves: the crew's cave if one is still being fought through, else a fresh one. Leaving it comes back to the mouth. */
  const goDown = () => {
    api.caves().then(({ code }) => goInside(`${HARBOR_CAVE.q},${HARBOR_CAVE.r}`, `zone/${code}`), (e: Error) => setNote(e.message));
  };
  // Flotsam bobbing beside the hero (or under their boat): fished out from the beach or from a boat.
  const flotsamHere = self ? flotsamWithin(flotsam.pieces, self.pos) : null;
  const takeFlotsam = async (id: string) => {
    try {
      const r = await api.takeFlotsam(id);
      flotsam.took(id);
      void refresh();
      const got = [costText(r.find.resources), r.find.gold ? `${r.find.gold} gold` : "", r.find.furnishing ? `a ${FURNITURE[r.find.furnishing].name.toLowerCase()} (in your hut's storage)` : ""].filter((t) => t && t !== "nothing");
      if (r.find.note) setBottle({ note: r.find.note, line: r.find.line });
      else say_(`${r.find.line}${got.length ? ` You get ${got.join(", ")}.` : ""}`);
    } catch (e) {
      const why = (e as Error).message;
      // Gone already (a crewmate was quicker, or the tide turned): off the water with it.
      if (/first|tide/i.test(why)) flotsam.took(id);
      say_(why);
    }
  };
  // The sparring ring is shut while it is rebuilt on the new combat (fights on the tiles themselves):
  // it says so and offers nothing to do.
  const shut = (title: ReactNode) => ({ title, label: "", run: () => {}, closed: true });
  // The place under your feet and the one thing to do there, shown in the bar below. A hero who walked here by
  // clicking the place has it done for them on arriving (`goIn`); where it must be pressed (`press`), its button
  // floats over them as well.
  const here: Here | null =
    atBoard ? { title: unseen ? "The notice board · something new is pinned up" : "The notice board", label: "Read the notice board", run: () => setNotices(true) }
    : atWaygate ? {
        title: <>The waygate <span className="muted">· {outThere ? `${outThere.name} is out through it${outThere.zone?.fighting ? ", in a fight" : ""}` : openMap ? `open to ${openMap.place}` : "shut. It opens onto the crew's atlas"}</span></>,
        label: outThere ? `Step through to ${outThere.name}` : openMap ? `Step through to ${openMap.place}` : "Open the atlas",
        run: () => (location.hash = outThere?.zone ? `zone/${outThere.zone.code}` : openMap ? `zone/${openMap.code}` : "atlas"),
        // A click on the gate itself goes where it stands open to: the map the crew has open; shut, the atlas, where
        // the crew has been and where it could go next. (Stepping straight through to a crewmate, who may be in a
        // fight, is asked for with the button.)
        enter: () => (location.hash = openMap ? `zone/${openMap.code}` : "atlas"),
        also: outThere || openMap ? { label: "Open the atlas", run: () => (location.hash = "atlas") } : lastMap ? { label: "Step back through", run: () => (location.hash = `zone/${lastMap}`) } : undefined,
      }
    : atWell ? {
        title: <>The town well <span className="muted">· fill a watering can or a water skin, or toss in a coin for luck</span></>,
        label: "Draw up to the well",
        run: () => setWellOpen(true),
      }
    : atChest ? { title: <>The town chest <span className="muted">· the crew's shared store, in tabs: gear, materials, lodestones</span></>, label: "Open the town chest", run: () => setChest(true) }
    // The Lapidary was never a building site: it is open from a crew's first day, for nobody goes out without a lodestone.
    : atLapidary ? { title: <>The Lapidary <span className="muted">· lodestones for the atlas are cut and worked here, and gems bought</span></>, label: "Go in", run: () => goInside(`${HARBOR_LAPIDARY.q},${HARBOR_LAPIDARY.r}`, "lapidary") }
    : atCave ? { title: <>The Haunted Caverns <span className="muted">· something lurks in the dark</span></>, label: "Go down", run: goDown }
    : atShop ? { title: "The market stall", label: "Browse the wares", run: () => setShop(true) }
    : atFinishes ? (nellIn
        ? { title: <>{DECORATOR.name} <span className="muted">· wallpaper, floors and roof colours for your hut</span></>, label: `Talk to ${DECORATOR.short}`, run: () => talk.begin(decoratorTalk()) }
        : shut(<>{DECORATOR.short}'s stall <span className="muted">· covered up for the night. She's back at first light, {nellBack()}</span></>))
    // Beside a hut's herb garden (once its shack stands): the camera goes down over the beds.
    : gardenHere ? {
        title: <>{gardenHere.id === you ? "Your herb garden" : `${gardenHere.name}'s herb garden`} <span className="muted">· {gardenStatus(gardenHere)}</span></>,
        label: gardenHere.id === you ? "Tend the garden" : gardenHere.garden!.some((b) => b.readyAt > clock && !b.wateredBy) ? "Water the garden" : "Look over the garden",
        run: () => setGardenOf(gardenHere.id),
      }
    : atRing ? shut(<>The sparring ring <span className="muted">· being rebuilt for a new way of fighting. Coming soon.</span></>)
    // Flotsam bobbing beside them: fished out.
    : flotsamHere ? { title: <>{flotsamName(flotsamHere)} <span className="muted">· bobbing {flotsamHere.shallows ? "in the shallows" : "on the water"}</span></>, label: "Fish it out", run: () => void takeFlotsam(flotsamHere.id), press: true }
    : gatherHere ? {
        title: gatherHere === "fishing" && holeHere ? <>{HOLE_NAMES[holeHere.kind]} {holeHere.where} <span className="muted">· {holeFishNames(holeHere)} biting</span></>
          : gatherHere === "fishing" && pierHere ? FISH_SPOTS[pierHere].name : GATHER_SPOTS[gatherHere].name,
        label: gatherHere === "fishing" ? (pierHere === "sea" ? "Row out and cast" : "Cast a line") : gatherHere === "felling" ? "Take up the axe" : "Work the seam",
        run: () => setGather(gatherHere),
        // A click on the fish shack is a word with Bram, whose shack it is: he stands at its east end. A click on the
        // tree line or the quarry opens its card, where setting out (and the energy it costs) has a button of its own.
        // A pier head or a boat is no structure to click: there the button floats over the hero, as it always has.
        enter: atShack ? () => talkToMongerRef.current() : undefined,
        press: gatherHere === "fishing" && !atShack,
        // At the shack's door, Bram is a step away.
        also: atShack ? { label: `Talk to ${FISHMONGER.short}`, run: () => talkToMongerRef.current() } : undefined,
      }
    : atPub ? { title: visitor ? <>The pub <span className="pub-visitor">· {visitor.name}, {visitor.trade}, is in</span></> : "The pub", label: "Go in", run: () => goInside("pub", "pub") }
    : atWorks ? { title: "The works", label: "See the crew's projects", run: () => setWorks(true) }
    // The lighthouse lights the way home. (The atlas is opened at the waygate, in the square.)
    : atLighthouse ? (lit
        ? { title: <>The lighthouse <span className="muted">· it lights the way home. The atlas is opened at the waygate, in the square.</span></>, label: "Show me the waygate", run: () => renderer.current?.lookAt(HARBOR_WAYGATE), press: true }
        : { title: <>The lighthouse's point <span className="muted">· the tower is paid for at the works</span></>, label: "See the crew's projects", run: () => setWorks(true) })
    // A workshop still to be built points to the works, where the crew pays for it.
    : atApothecary ? (apothecaryBuilt
        ? { title: "The apothecary", label: "Go in", run: () => goInside(`${HARBOR_APOTHECARY.q},${HARBOR_APOTHECARY.r}`, "apothecary") }
        : { title: <>The apothecary's building site <span className="muted">· paid for at the works</span></>, label: "See the crew's projects", run: () => setWorks(true) })
    : atSmithy ? (smithyBuilt
        ? { title: "The smithy", label: "Go in", run: () => goInside(`${HARBOR_SMITHY.q},${HARBOR_SMITHY.r}`, "smithy") }
        : { title: <>The smithy's building site <span className="muted">· paid for at the works</span></>, label: "See the crew's projects", run: () => setWorks(true) })
    : atGalley ? (galleyBuilt
        ? { title: "The galley", label: "Go in", run: () => goInside(`${HARBOR_GALLEY.q},${HARBOR_GALLEY.r}`, "galley") }
        : { title: <>The galley's building site <span className="muted">· paid for at the works</span></>, label: "See the crew's projects", run: () => setWorks(true) })
    : myBin ? {
        title: (
          <>Your plot <span className="muted">· the shack's resource bin: {RESOURCE_KINDS.filter((k) => SHACK_COST[k]).map((k) => `${myBin[k] ?? 0}/${SHACK_COST[k]} ${label("resource", k).toLowerCase()}`).join(", ")}{held ? ` · you hold ${RESOURCE_KINDS.filter((k) => SHACK_COST[k]).map((k) => `${held[k] ?? 0} ${label("resource", k).toLowerCase()}`).join(", ")}` : ""}</span></>
        ),
        label: "Put materials in the bin",
        run: () => void fillBin(),
        // It takes the materials out of your bag.
        press: true,
      }
    // Someone else's plot with only a bin on it: nothing to do there yet.
    : hutOwner?.bin ? null
    : hutOwner ? {
        title: <>{hutOwner.id === you ? "Your hut" : `${hutOwner.name}'s hut`} <span className="muted">· {hutTier(hutOwner.hutTier ?? 1).name}</span></>,
        label: hutOwner.id === you ? "Enter your hut" : `Enter ${hutOwner.name}'s hut`,
        run: () => goInside(String(plotIndex), `hut/${hutOwner.id}`),
      }
    : plotIndex >= 0 && myPlot === null ? {
        title: <>An empty plot <span className="muted">· {gold >= PLOT_PRICE ? "yours to build on" : `you have ${gold} of ${PLOT_PRICE} gold`}</span></>,
        label: `Buy this plot · ${PLOT_PRICE} gold`,
        run: () => void buyPlot(plotIndex),
        // It costs gold.
        press: true,
      }
    : plotIndex >= 0 ? null
    // Out on the water there is nothing to do but row, or fish.
    : onWater ? null
    // Anywhere else is ground you can sleep on.
    : self ? {
        title: restIn > 0 ? <>Your bedroll <span className="muted">· you can rest again in {restIn} min</span></> : "Open ground",
        label: restIn > 0 ? `Rest in ${restIn} min` : "Lay out your bedroll and rest",
        run: () => void restHere(),
        // Offered in the bar only: a button over your head on every bit of open ground would be noise.
        quiet: true,
      }
    : null;
  hereNow.current = here;
  // Anything laid over the Harbor takes the floating button away.
  const panelOpen = sheet || book || shop || notices || !!gather || fishmonger || baitOpen || works || account || !!tradeWith || !!gardenOf || talking || finishesOpen || !!bottle;
  // Over your own garden, how its next bed is coming on; over a crewmate's near you, a drop while it wants water.
  const gardenMarks: GardenMarkInfo[] = [];
  for (const m of board.members) {
    if (!m.garden || m.bin || m.plot == null) continue;
    const growing = m.garden.filter((b: GardenBed) => b.readyAt > clock);
    const ready = m.garden.length - growing.length;
    const soonest = growing.sort((a, b) => a.readyAt - b.readyAt)[0];
    if (m.id === you) {
      if (m.garden.length > 0) gardenMarks.push({ poiId: `garden:${m.id}`, kind: "mine", ready, next: soonest ? { at: soonest.readyAt, p: bedProgress(soonest, clock) } : undefined });
    } else if (self && growing.some((b) => !b.wateredBy) && hexDistance(self.pos, HARBOR_PLOTS[m.plot]) <= 5) {
      gardenMarks.push({ poiId: `garden:${m.id}`, kind: "thirsty", ready });
    }
  }
  // Nothing lights up behind a window, or while a gathering outing has the view.
  const glowId = lights && !panelOpen ? aimed.id : null;
  useEffect(() => {
    renderer.current?.setGlow(glowId);
  }, [glowId]);
  const error = harbor.error;

  // Put away: only the stage is kept, with the view built on it. No panel, bar or key of the Harbor's is up.
  // (The stage is keyed, here and below, so it is the same element either way and keeps its canvas.)
  if (resting) return <div className="run harbor-view" style={{ display: "none" }}><div key="stage" className="stage" ref={mount} /></div>;
  return (
    <div className="run harbor-view">
      {/* Someone of the crew is setting out for a place on the atlas, and asks who is coming. */}
      {muster.muster && <MusterPanel muster={muster.muster} me={harbor.you ?? me.player.id} onSay={muster.say} busy={muster.busy} error={muster.error} />}
      <div key="stage" className="stage" ref={mount} />
      {/* Down the left-hand side: the docks at the top, the crew's cards in the middle (the talk sits under them). */}
      <div className="hud-left">
        <DragPanel id="harbor.docks" title="Docks" foldOnPhone className="story panel docks">
          <p className="muted">The crew's atlas is opened at the waygate, in the middle of the square: everywhere you have found, and the routes that run on from there. When one of you sets out, everyone in town is asked whether they are coming. Setting out takes a lodestone: they are cut and worked at the Lapidary, the narrow shop with a gem for a sign, where Tilda also buys gems. What the crew shares is kept in the town chest, on its dais down on the west shore.</p>
          <p>
            <button className="small" onClick={() => renderer.current?.lookAt(HARBOR_WAYGATE)}>Show me the waygate</button> <button className="small" onClick={() => renderer.current?.lookAt(HARBOR_LAPIDARY)}>Show me the Lapidary</button> <button className="small" onClick={() => renderer.current?.lookAt(HARBOR_CHEST)}>Show me the town chest</button>
          </p>
        </DragPanel>

        <div className="crew roster-panel crew-cards">
          <CrewRoster
            you={you}
            heading={<>{hereCount} of {roster.length} here</>}
            members={roster}
            onOpen={heroSheet.toggle}
            openId={heroSheet.open}
            menu={(m) => {
              if (m.id === you) return [];
              const away = board.members.find((x) => x.id === m.id)?.zone;
              return [
                { label: "Trade", run: () => setTradeWith(m.id) },
                { label: "Teleport to them", blocked: away?.fighting ? "In a fight" : away ? undefined : m.here ? "Already here with you" : "Not out on a map", run: () => teleportTo(m.id) },
              ];
            }}
          />
        </div>
      </div>

      <DragPanel id="harbor.chat" title="Crew chat" foldOnPhone expandable className="chat panel harbor-chat">
        <div className="chat-lines">
          {harbor.chat.length === 0 && <div className="muted">Crew chat. Only people in the Harbor right now see it.</div>}
          {harbor.chat.map((l, i) => <div key={i} className="line hero"><strong>{l.name}: </strong>{l.text}</div>)}
          <div ref={chatEnd} />
        </div>
        <ChatInput placeholder="Say something to the crew…" onSay={(text) => harbor.send({ type: "say", text })} onEmote={(emote) => harbor.send({ type: "emote", emote })} />
      </DragPanel>

      {/* Put away while a gathering outing (fishing, felling, the quarry) has the view: nothing on it is any use
          there, and the game's own controls drop to the bottom of the screen (--hud-h goes with it). */}
      {talk.node}
      {jobOpen && chatWith && regs && (() => {
        const view = regs.regulars.find((v) => v.regular === chatWith);
        return view ? <RegularPanel key={chatWith} view={view} handedIn={regs.handedIn} cap={regs.cap} reload={async () => loadRegs()} refresh={refreshAll} onClose={() => setJobOpen(false)} /> : null;
      })()}
      {finishesOpen && <FinishesPanel refresh={refreshAll} onClose={() => setFinishesOpen(false)} />}

      {/* (Put away while talking to a regular too: the conversation has the screen.) */}
      {!(gather && me.character) && !talking && <HudBar
        me={me}
        place={here && !here.quiet ? here.title : undefined}
        rest={onWater ? undefined : {
          run: () => void restHere(),
          disabled: restIn > 0,
          hint: restIn > 0 ? `Rest: you can lay out your bedroll again in ${restIn} min` : "Rest: lay out your bedroll here and sleep a while. Gathering outings come back.",
        }}
        meter={stamina ? { name: "Energy", note: "gathering outings left today", now: stamina.left, max: stamina.max, kind: "stamina" } : undefined}
        chips={harbor.status === "paused" ? <span className="hud-chip">away</span> : harbor.status !== "open" ? <span className="hud-chip bad">connecting…</span> : undefined}
        // While the trade table is open it has the bag beside it already.
        onBag={() => !tradeWith && (chest ? setChest(false) : setSheet((open) => !open))}
        onBook={() => setBook(true)}
        menu={
          <OptionsMenu
            title={HARBOR_NAME}
            subtitle={<>{harbor.crew?.name ?? me.crew?.name}{harbor.crew && <> · invite code <span className="selectable code">{harbor.crew.id}</span></>}</>}
            actions={[
              { label: copied ? "Invite link copied" : "Copy the crew's invite link", run: () => void copy(), stay: true },
              { label: me.player.email ? "Account" : "Save your progress", hint: me.player.email ?? "Guest account: not saved yet", tone: me.player.email ? undefined : "nudge", run: () => setAccount(true) },
              ...(me.isAdmin ? [{ label: "Admin", run: () => { location.hash = "#admin"; } }] : []),
            ]}
            reset={harbor.status !== "open" ? undefined : {
              to: "the plaza, where everyone arrives",
              run: () => {
                harbor.send({ type: "unstick" });
                renderer.current?.lookAt(HARBOR_SPAWN);
              },
            }}
            resetBlocked="Waiting for the Harbor to connect."
          />
        }
      >
        {here && !here.quiet && !here.closed && <button className="primary" onClick={here.run}>{here.label}</button>}
        {here?.also && <button onClick={here.also.run}>{here.also.label}</button>}
      </HudBar>}

      {/* A place gone into by clicking it has no button over the hero: only what must be pressed (`press`) keeps one. */}
      {here?.press && !here.closed && self && !panelOpen && <TileAction renderer={renderer} pos={self.pos} unitId={self.id} label={here.label} run={here.run} />}
      {!panelOpen && <GardenMarks renderer={renderer} marks={gardenMarks} now={clock} />}
      {!panelOpen && <IndoorMarks renderer={renderer} indoors={indoors} members={board.members} />}
      {tip && <div className="tip">{tip}</div>}
      {title && hoverPoi && !panelOpen && <PlaceTitle renderer={renderer} poiId={hoverPoi.id} title={title} />}
      {error && <div className="toast">{error}</div>}
      {note && !error && <div className="toast note">{note}</div>}
      {sheet && !tradeWith && !chest && me.character && <InventoryScreen me={me} refresh={refreshAll} onClose={() => setSheet(false)} onLogbook={() => { setSheet(false); setBook(true); }} />}
      {book && me.character && <Logbook me={me} refresh={refreshAll} onClose={() => setBook(false)} />}
      {account && <AccountPanel me={me} refresh={refresh} onClose={() => setAccount(false)} />}
      {notices && <NoticeBoard seen={me.seenRelease} onSeen={() => void refresh()} onClose={() => setNotices(false)} />}
      {unseen && !panelOpen && !atBoard && <AttentionMark renderer={renderer} pos={BOARD_STANDS} lift={2.35} label="Something new on the notice board" />}
      {works && <WorksPanel works={board.works} refresh={refresh} onClose={() => setWorks(false)} />}
      {chest && me.character && <TownChest me={me} refresh={refresh} onClose={() => setChest(false)} />}
      {gather && me.character && <GatherPanel spot={gather} onRod={(on) => harbor.send({ type: "fishing", on })} pier={pierHere ?? undefined} at={self?.pos} hole={holeHere} vessel={self?.vessel ?? null} gilded={me.character?.title === BOOK_TITLE} renderer={renderer} onClose={() => setGather(null)} onStamina={setStamina} onPaid={() => void refresh()} />}
      {fishmonger && me.character && <CatchPanel buyer="market" onGold={() => void refresh()} onClose={() => setFishmonger(false)} />}
      {bottle && <BottleNote note={bottle.note} line={bottle.line} onClose={() => setBottle(null)} />}
      {baitOpen && me.character && <BaitPanel gold={gold} onGold={() => void refresh()} onBoat={() => void refreshAll()} onClose={() => setBaitOpen(false)} />}
      {wellOpen && atWell && me.character && (
        <WellMenu renderer={renderer} onClose={() => setWellOpen(false)} onChanged={() => void refresh()} />
      )}
      {gardenOf && me.character && you && renderer.current && (() => {
        const owner = board.members.find((m) => m.id === gardenOf);
        if (owner?.plot == null) return null;
        return (
          <Garden
            world={renderer.current}
            owner={gardenOf}
            ownerName={owner.name}
            you={you}
            door={HARBOR_PLOTS[owner.plot]}
            beds={gardenBeds(owner.hutTier ?? 1)}
            live={owner.garden}
            onClose={() => setGardenOf(null)}
            onPicked={() => void refresh()}
          />
        );
      })()}
      {shop && me.character && <ShopScreen me={me} refresh={refreshAll} onClose={() => setShop(false)} />}
      {me.character && <Trading me={me} partners={board.members.filter((m) => m.id !== you)} withId={tradeWith} onWith={setTradeWith} refresh={refresh} nudge={harbor.trades} />}
      {heroSheet.open && you && <HeroSheet id={heroSheet.open} you={you} onClose={heroSheet.close} logbook={me.character ? { hero: me.character, open: () => { heroSheet.close(); setBook(true); } } : undefined} />}
    </div>
  );
}
