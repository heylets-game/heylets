// A finish's swatch, as Nell's catalogue and a hut's edit mode show it: a length of the wallpaper or a square of the
// floor, cut from the very sheet the room is papered or laid with (render/groundArt.ts), or a little house under a
// roof of the colour. "Plain" is the way huts come.

import { finishById, type FinishKind } from "@gantt-quest/world";
import { finishFloorTexture, floorTexture, wallpaperTexture } from "./render/groundArt";

// toDataURL is not free: cut each swatch once.
const cut = new Map<string, string>();

function swatchUrl(id: string | null, kind: FinishKind): string | null {
  const key = `${kind}:${id ?? "plain"}`;
  const had = cut.get(key);
  if (had) return had;
  const def = finishById(id);
  let source: CanvasImageSource | null = null;
  if (def?.kind === "wall") source = wallpaperTexture(def.id, def.look).image as HTMLCanvasElement;
  else if (def?.kind === "floor") source = finishFloorTexture(def.id, def.look).image as HTMLCanvasElement;
  else if (kind === "floor") source = floorTexture().image as HTMLCanvasElement;
  if (!source) return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  if (kind === "wall") {
    // The whole height of the wall, beam to skirting, a little over a third of a sheet across.
    canvas.width = 48;
    canvas.height = 84;
    ctx.drawImage(source, 0, 0, 96, 448, 0, 0, 48, 84);
  } else {
    canvas.width = 72;
    canvas.height = 72;
    ctx.drawImage(source, 0, 0, 160, 160, 0, 0, 72, 72);
  }
  const url = canvas.toDataURL();
  cut.set(key, url);
  return url;
}

/** Bare walls, as huts come: plain boards of the room's own colour. */
const BARE_WALL = "#b9a27c";
/** A roof's colour when none is chosen: a hut's own, which is picked from its owner. Shown as a neutral grey-brown. */
const PLAIN_ROOF = "#8c6a4a";

export function FinishSwatch({ kind, id, size = 1 }: { kind: FinishKind; id: string | null; size?: number }) {
  if (kind === "roof") {
    const def = finishById(id);
    const color = def?.kind === "roof" ? def.look.color : PLAIN_ROOF;
    return (
      <svg className="finish-swatch roof" width={56 * size} height={48 * size} viewBox="0 0 56 48" aria-hidden>
        <rect x="12" y="22" width="32" height="22" fill="#e8d9b5" stroke="#4a2f22" strokeWidth="1.5" />
        <rect x="24" y="31" width="8" height="13" fill="#5a3d22" />
        <rect x="14" y="28" width="5" height="7" fill={color} />
        <rect x="37" y="28" width="5" height="7" fill={color} />
        <path d="M6 24 L28 6 L50 24 Z" fill={color} stroke="#2a1a12" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );
  }
  const url = swatchUrl(id, kind);
  const [w, h] = kind === "wall" ? [48, 84] : [72, 72];
  if (!url) return <span className="finish-swatch" style={{ width: w * size, height: h * size, background: BARE_WALL }} aria-hidden />;
  return <img className={`finish-swatch ${kind}`} src={url} width={w * size} height={h * size} alt="" />;
}
