// Marks floated over the herb gardens in the Harbor, following the camera frame by frame like AttentionMark:
// over your own garden a ring that fills as its next bed grows, with the time still to go, that turns gold and
// bobs when a bed is ready to pick; over a crewmate's garden near you, a drop of water while one of its beds
// still wants watering.

import { useEffect, useRef, type RefObject } from "react";
import { growText } from "@gantt-quest/world";
import type { WorldRenderer } from "./render/WorldRenderer";
import { ThingIcon, resourceIcon } from "./thingIcons";
import { uiZoom } from "./uiScale";
import "./garden.css";

export interface GardenMarkInfo {
  /** The garden's place id in the scene. */
  poiId: string;
  kind: "mine" | "thirsty";
  ready: number;
  /** The next bed to be ready: when, and how far it has grown (0 to 1). */
  next?: { at: number; p: number };
}

export function GardenMarks({ renderer, marks, now }: { renderer: RefObject<WorldRenderer | null>; marks: GardenMarkInfo[]; now: number }) {
  return <>{marks.map((m) => <Mark key={m.poiId} renderer={renderer} mark={m} now={now} />)}</>;
}

function Mark({ renderer, mark, now }: { renderer: RefObject<WorldRenderer | null>; mark: GardenMarkInfo; now: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { poiId } = mark;
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const el = wrap.current;
      if (!el) return;
      const at = renderer.current?.screenAbovePoi(poiId, 0.35) ?? null;
      el.style.visibility = at ? "visible" : "hidden";
      const z = uiZoom();
      if (at) el.style.transform = `translate(${Math.round(at.x / z)}px, ${Math.round(at.y / z)}px)`;
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [renderer, poiId]);

  const ready = mark.ready > 0;
  const label = mark.kind === "thirsty" ? "Needs watering" : ready ? `${mark.ready} ready to pick` : mark.next ? growText(mark.next.at, now) : null;
  return (
    <div className="garden-mark" ref={wrap} role="status" aria-label={label ?? "Herb garden"}>
      <div>
        {mark.kind === "thirsty" ? (
          <span className="ring thirsty"><i className="drop" /></span>
        ) : (
          <span className={`ring${ready ? " ready" : ""}`} style={{ ["--p" as string]: ready ? 1 : mark.next?.p ?? 0 }}>
            <ThingIcon icon={resourceIcon("herbs")} size={18} />
          </span>
        )}
        {label && <span className={`label${ready && mark.kind === "mine" ? " ready" : ""}`}>{label}</span>}
      </div>
    </div>
  );
}
