// Brass corners, the logbook cover's own (ui/frames.ts draws them), laid over
// the four corners of whatever holds them: the bottom bar, the sea bag and the
// windows that open beside it. The holder must be positioned; it says where
// the corners sit and how big they are with --corner-at (from its padding
// edge, negative to stand over its frame) and --corner-size (corners.css).

import "./corners.css";

export function BrassCorners() {
  return (
    <>
      {(["tl", "tr", "bl", "br"] as const).map((k) => <i key={k} className={`brass-corner ${k}`} aria-hidden />)}
    </>
  );
}
