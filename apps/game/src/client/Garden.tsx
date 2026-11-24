// The garden by a hut's door, where herbs and mushrooms grow, tended in the Harbor itself: the camera flies down over the beds
// (render/GardenStage.ts) and this is what is laid over them. A tag floats over each bed saying how far it has
// grown, with a bar that fills and the time still to go; press a bed (or its tag) and its tag opens on what can be
// done to it: sow it, plant a herb or a mushroom in it, water it, feed it bonemeal. A dock along the bottom holds what you have
// to garden with, the quern to grind bone on, picking every ready bed, and the way back out.
//
// Its owner plants and picks; anyone in the crew may water and feed. What grows comes live from the Harbor's board
// (`live`), so a crewmate's watering shows at once; what you hold is read from the server when it opens and after
// each thing done.

import { useEffect, useRef, useState } from "react";
import type { HexPos } from "@gantt-quest/core";
import { BONEMEAL_PER_BONE, CAN_CAPACITY, CROP_GROW_MS, SEED_PRICE, bedProgress, bedStage, growText, harvestText, type BedStage, type Crop, type GardenBed } from "@gantt-quest/world";
import { api } from "./api";
import { GardenStage, type GardenEffect } from "./render/GardenStage";
import type { WorldRenderer } from "./render/WorldRenderer";
import { Icon } from "./items";
import { ThingIcon, resourceIcon } from "./thingIcons";
import { uiZoom } from "./uiScale";
import type { GardenView } from "../server/garden";
import "./garden.css";

const STAGE_WORD: Record<Crop, Record<BedStage, string>> = {
  herbs: {
    empty: "Bare earth",
    sown: "Just sown",
    sprout: "Sprouting",
    young: "Growing",
    leafy: "Nearly there",
    ready: "Ready to pick",
  },
  mushrooms: {
    empty: "Bare earth",
    sown: "Planted",
    sprout: "Tiny caps",
    young: "Growing",
    leafy: "Nearly there",
    ready: "Ready to pick",
  },
};
/** One of what a crop gives, for "+1 herb". */
const ONE: Record<Crop, string> = { herbs: "herb", mushrooms: "mushroom" };
const hours = (crop: Crop) => CROP_GROW_MS[crop] / 3_600_000;

export function Garden({ world, owner, ownerName, you, door, beds: size, live, onClose, onPicked }: {
  world: WorldRenderer;
  owner: string;
  /** The owner's hero's name, for when it is not yours. */
  ownerName: string;
  you: string;
  /** The doorstep of the hut whose garden it is: the stage is set on it. */
  door: HexPos;
  /** How many beds the garden has (by the hut's size), as the board says: the stage lays its beds out by it. */
  beds: number;
  /** What is growing, as the Harbor's board last told it. */
  live?: GardenBed[];
  onClose(): void;
  /** Herbs or mushrooms were picked: the bag and the hero's XP have changed. */
  onPicked(): void;
}) {
  const mine = owner === you;
  const [view, setView] = useState<GardenView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  /** How far the server's clock is ahead of this one. */
  const [skew, setSkew] = useState(0);
  const [, tick] = useState(0);
  const stage = useRef<GardenStage | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const tags = useRef<(HTMLDivElement | null)[]>([]);

  const load = () =>
    api.garden(owner).then((v) => {
      setView(v);
      setSkew(v.now - Date.now());
    }, (e: Error) => setError(e.message));

  // The stage goes up on the hut's doorstep and the camera flies down over the beds; it flies back out on leaving.
  useEffect(() => {
    const s = world.startMinigame((group) => new GardenStage(world, group, `garden:${owner}`, size, { onBed: (bed) => setPicked(bed) }), door);
    stage.current = s;
    document.body.classList.add("gardening");
    void load();
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      document.body.classList.remove("gardening");
      world.setCover(null);
      stage.current = null;
      s.leave();
    };
    // One stage for as long as the garden is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, owner]);

  // The dock along the bottom covers part of the view: the camera frames the beds in what it leaves clear.
  useEffect(() => {
    world.setCover(dock.current);
  }, [world, !!view]);

  useEffect(() => {
    stage.current?.select(picked);
  }, [picked]);
  // The hut grew while the garden was open (or the board had not said yet): lay the beds out again.
  const beds = view?.beds ?? size;
  useEffect(() => {
    stage.current?.setBeds(beds);
  }, [beds]);

  // Each bed's tag follows its bed across the screen, frame by frame.
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const z = uiZoom();
      tags.current.forEach((el, i) => {
        if (!el) return;
        const at = stage.current?.bedScreen(i) ?? null;
        el.style.visibility = at ? "visible" : "hidden";
        if (at) el.style.transform = `translate(${Math.round(at.x / z)}px, ${Math.round(at.y / z)}px)`;
      });
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape steps back out, or first puts a bed's actions away.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (picked !== null) setPicked(null);
      else onClose();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [picked, onClose]);

  const growing = live ?? view?.growing ?? [];
  const now = Date.now() + skew;
  const ready = growing.filter((b) => b.readyAt <= now);
  const held = view?.held;
  const water = view ? view.can : undefined;
  /** Why the watering can cannot water now, or null if it can. */
  const dry = water === null ? "You have no watering can: the market stall sells them" : water === 0 ? "Your watering can is empty: fill it at the well on the green" : null;

  const act = async (fn: () => Promise<unknown>, effect?: [GardenEffect, number], done?: string) => {
    setBusy(true);
    setError(null);
    setSaid(null);
    try {
      await fn();
      if (effect) stage.current?.play(...effect);
      if (done) setSaid(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = () =>
    act(async () => {
      const res = await api.gardenPick();
      for (const b of ready) stage.current?.play("pick", b.bed, b.crop);
      setPicked(null);
      setSaid(`You pick ${harvestText(res)} from ${res.beds} bed${res.beds === 1 ? "" : "s"}.${res.xp?.granted ? ` +${res.xp.granted} XP.` : ""}`);
      onPicked();
    });

  return (
    <div className="garden-view">
      {Array.from({ length: beds }, (_, i) => {
        const bed = growing.find((b) => b.bed === i);
        const stg = bedStage(bed, now);
        const p = bed ? bedProgress(bed, now) : 0;
        const open = picked === i;
        const crop = bed?.crop ?? "herbs";
        const word = STAGE_WORD[crop][stg];
        return (
          <div key={i} className="bed-tag-anchor" ref={(el) => void (tags.current[i] = el)}>
            <div
              className={`bed-card stage-${stg}${open ? " open" : ""}`}
              onClick={() => !open && setPicked(i)}
              role="group"
              aria-label={`Bed ${i + 1}: ${bed ? `${crop}, ` : ""}${word}`}
            >
              <div className="bed-card-head">
                <strong>Bed {i + 1}</strong>
                <span>{word}</span>
                {bed?.wateredBy && <i className="drop" title={`Watered by ${bed.wateredBy}`} />}
                {bed?.fedBy && <span className="fed-mark" title={`Fed bonemeal by ${bed.fedBy}`}><ThingIcon icon={resourceIcon("bonemeal")} size={14} /></span>}
              </div>
              {bed && (
                <div className="bed-grow-row">
                  <span className="bed-crop" title={crop === "mushrooms" ? "Mushrooms" : "Herbs"}><ThingIcon icon={resourceIcon(crop)} size={16} /></span>
                  <div className={`bed-grow${stg === "ready" ? " ready" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
                    <span style={{ width: `${Math.round(p * 1000) / 10}%` }} />
                    <em>{stg === "ready" ? "Ready!" : growText(bed.readyAt, now)}</em>
                  </div>
                </div>
              )}
              {open && (
                <div className="bed-actions">
                  {(bed?.wateredBy || bed?.fedBy) && (
                    <span className="bed-note">
                      {bed.wateredBy && <span title={`One more ${ONE[crop]} at picking`}><i className="drop" /> {bed.wateredBy} · +1 {ONE[crop]}</span>}
                      {bed.fedBy && <span title="Grows faster"><ThingIcon icon={resourceIcon("bonemeal")} size={12} /> {bed.fedBy}</span>}
                    </span>
                  )}
                  {!bed && mine && (
                    <>
                      <button className="primary" disabled={busy || !held?.seeds} title={held?.seeds ? undefined : "The market stall sells herb seeds"} onClick={() => void act(() => api.gardenPlant(i, "seeds"), ["plant", i], `Bed ${i + 1} is sown.`)}>
                        <ThingIcon icon={resourceIcon("seeds")} size={16} /> Sow seeds <small>{held?.seeds ?? 0}</small>
                      </button>
                      <button disabled={busy || !held?.herbs} onClick={() => void act(() => api.gardenPlant(i, "herbs"), ["plant", i], `A herb goes into bed ${i + 1}.`)}>
                        <ThingIcon icon={resourceIcon("herbs")} size={16} /> Plant a herb <small>{held?.herbs ?? 0}</small>
                      </button>
                      <button
                        disabled={busy || !held?.mushrooms}
                        title={held?.mushrooms ? `Grows mushrooms, ready in ${hours("mushrooms")} hours` : "Pick mushrooms in the caverns to plant one here"}
                        onClick={() => void act(() => api.gardenPlant(i, "mushrooms"), ["plant", i], `A mushroom goes into bed ${i + 1}.`)}
                      >
                        <ThingIcon icon={resourceIcon("mushrooms")} size={16} /> Plant a mushroom <small>{held?.mushrooms ?? 0}</small>
                      </button>
                    </>
                  )}
                  {!bed && !mine && <span className="bed-note">Nothing planted yet.</span>}
                  {bed && stg !== "ready" && !bed.wateredBy && (
                    <button className="primary" disabled={busy || !!dry} title={dry ?? `One more ${ONE[crop]} at picking`} onClick={() => void act(() => api.gardenWater(owner, i), ["water", i], `You water bed ${i + 1}.`)}>
                      <i className="drop" /> Water {typeof water === "number" && <small>{water}/{CAN_CAPACITY}</small>}
                    </button>
                  )}
                  {bed && stg !== "ready" && !bed.fedBy && (
                    <button disabled={busy || !held?.bonemeal} title={held?.bonemeal ? "Halves the growing still to do" : "Grind bonemeal from a bone, below"} onClick={() => void act(() => api.gardenFeed(owner, i), ["feed", i], `Bonemeal into bed ${i + 1}: it grows faster now.`)}>
                      <ThingIcon icon={resourceIcon("bonemeal")} size={16} /> Bonemeal <small>{held?.bonemeal ?? 0}</small>
                    </button>
                  )}
                  {bed && stg === "ready" && mine && (
                    <button className="primary" disabled={busy} onClick={() => void pick()}>Pick</button>
                  )}
                  {bed && stg === "ready" && !mine && <span className="bed-note">Waiting for {ownerName} to pick it.</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="garden-dock" ref={dock}>
        <div className="garden-dock-head">
          <h2>{mine ? "Your garden" : `${ownerName}'s garden`}</h2>
          <span className="muted">
            {mine
              ? `Herbs are ready ${hours("herbs")} hours after planting, mushrooms ${hours("mushrooms")}. Water for an extra one; bonemeal grows it faster.`
              : "Water a bed and they pick an extra one. Bonemeal grows it faster."}
          </span>
        </div>
        {(error || said) && <div className={`garden-said ${error ? "bad" : "good"}`} key={error ?? said}>{error ?? said}</div>}
        <div className="garden-dock-row">
          {held && (
            <div className="shed-stock">
              <Stock kind="seeds" n={held.seeds ?? 0} />
              <Stock kind="herbs" n={held.herbs ?? 0} />
              <Stock kind="mushrooms" n={held.mushrooms ?? 0} />
              <Stock kind="bonemeal" n={held.bonemeal ?? 0} />
              <Stock kind="bone" n={held.bone ?? 0} />
            </div>
          )}
          <WateringCan water={water} />
          <span className="spacer" />
          <button disabled={busy || !held?.bone} title={`Seeds are ${SEED_PRICE} gold a packet at the market stall`} onClick={() => void act(() => api.grindBone(1), undefined, `You grind a bone into ${BONEMEAL_PER_BONE} scoops of bonemeal.`)}>
            Grind a bone
          </button>
          {mine && (
            <button className="primary garden-pick" disabled={busy || ready.length === 0} onClick={() => void pick()}>
              {ready.length > 0 ? `Pick ${ready.length === 1 ? "1 bed" : `${ready.length} beds`}` : "Nothing to pick"}
            </button>
          )}
          <button onClick={onClose}>Leave</button>
        </div>
        {!held && !error && <p className="muted">Looking over the beds…</p>}
      </div>
    </div>
  );
}

/** Your watering can, and how many waterings are in it: a drop for each. */
function WateringCan({ water }: { water: number | null | undefined }) {
  if (water === undefined) return null;
  const title = water === null ? "No watering can: the market stall sells them" : `Watering can: ${water} of ${CAN_CAPACITY} waterings. Fill it at the well on the green.`;
  return (
    <span className={`shed-can${water === null ? " none" : water === 0 ? " empty" : ""}`} title={title}>
      <Icon name="watering-can" color="#4f9fd6" size={22} />
      {water === null ? <span className="muted">No can</span> : (
        <span className="can-drops" aria-label={`${water} of ${CAN_CAPACITY}`}>
          {Array.from({ length: CAN_CAPACITY }, (_, i) => <i key={i} className={`drop${i < water ? "" : " dry"}`} />)}
        </span>
      )}
    </span>
  );
}

function Stock({ kind, n }: { kind: "seeds" | "herbs" | "mushrooms" | "bonemeal" | "bone"; n: number }) {
  const name = { seeds: "Seeds", herbs: "Herbs", mushrooms: "Mushrooms", bonemeal: "Bonemeal", bone: "Bone" }[kind];
  return (
    <span className={`shed-item${n === 0 ? " none" : ""}`} title={`${name}: ${n}`}>
      <ThingIcon icon={resourceIcon(kind)} size={22} />
      <b>{n}</b>
      <span className="muted">{name}</span>
    </span>
  );
}
