// Who is inside the Harbor's buildings: a small portrait of each crewmate in the pub, a workshop or a hut, bobbing
// gently over its roof so the rest of the crew can see where everyone is. Like AttentionMark and GardenMarks it
// follows the camera frame by frame. The Harbor's room says who is where (HarborPlayer.inside).

import { useEffect, useRef, type RefObject } from "react";
import type { HarborMember, HarborPlayer } from "@gantt-quest/world";
import type { WorldRenderer } from "./render/WorldRenderer";
import { spriteDataUrl } from "./render/sprites";
import { uiZoom } from "./uiScale";

/** Portraits shown over one roof before the rest are counted ("+2"). */
const SHOWN = 3;

/** The place in the scene a building someone is inside is drawn as: a hut is its owner's plot. */
export const insidePoi = (inside: string): string => (inside.startsWith("hut:") ? `plot:${inside.slice(4)}` : inside);

const NAMES: Record<string, string> = { pub: "the pub", smithy: "the smithy", apothecary: "the apothecary", galley: "the galley", lapidary: "the Chartmaker's" };

/** Where someone is, in words: "in the pub", "at home", "in Ada's hut". */
export function insideWords(p: HarborPlayer, members: HarborMember[]): string {
  const inside = p.inside ?? "";
  if (!inside.startsWith("hut:")) return `in ${NAMES[inside] ?? "a building"}`;
  const owner = inside.slice(4);
  if (owner === p.id) return "at home";
  return `in ${members.find((m) => m.id === owner)?.name ?? "someone"}'s hut`;
}

export function IndoorMarks({ renderer, indoors, members }: { renderer: RefObject<WorldRenderer | null>; indoors: HarborPlayer[]; members: HarborMember[] }) {
  const byPlace = new Map<string, HarborPlayer[]>();
  for (const p of indoors) {
    if (!p.inside) continue;
    const poi = insidePoi(p.inside);
    byPlace.set(poi, [...(byPlace.get(poi) ?? []), p]);
  }
  const places = [...byPlace].sort(([a], [b]) => a.localeCompare(b));
  return <>{places.map(([poiId, who], i) => <Mark key={poiId} renderer={renderer} poiId={poiId} who={who} members={members} beat={i} />)}</>;
}

function Mark({ renderer, poiId, who, members, beat }: { renderer: RefObject<WorldRenderer | null>; poiId: string; who: HarborPlayer[]; members: HarborMember[]; beat: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const el = wrap.current;
      if (!el) return;
      const at = renderer.current?.screenAbovePoi(poiId, 0.3) ?? null;
      el.style.visibility = at ? "visible" : "hidden";
      const z = uiZoom();
      if (at) el.style.transform = `translate(${Math.round(at.x / z)}px, ${Math.round(at.y / z)}px)`;
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [renderer, poiId]);

  const sorted = [...who].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const shown = sorted.slice(0, SHOWN);
  const more = sorted.length - shown.length;
  const label = `${sorted.map((p) => p.name).join(", ")} ${sorted.length === 1 ? "is" : "are"} ${insideWords(sorted[0], members)}`;
  return (
    <div className="indoor-mark" ref={wrap} role="status" aria-label={label}>
      {/* Each building bobs a little out of step with the next, so a row of them does not move as one. */}
      <div style={{ animationDelay: `${-(beat * 0.45) % 1.8}s` }}>
        {shown.map((p) => (
          <span key={p.id} className="indoor-face">
            <img className="pixel-icon" src={spriteDataUrl(p.classId, p.outfit)} alt="" width={27} height={33} />
          </span>
        ))}
        {more > 0 && <span className="indoor-more">+{more}</span>}
      </div>
    </div>
  );
}
