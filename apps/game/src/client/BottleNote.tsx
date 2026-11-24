// A message from a bottle washed up in the Harbor (packages/world/src/flotsam.ts): unrolled and read where it was
// found. A scrap of damp paper over the view, closed by a click anywhere.

import "./fishing.css";

export function BottleNote({ note, line, onClose }: { note: string; line: string; onClose(): void }) {
  return (
    <div className="overlay bottle-overlay" onClick={onClose} role="dialog" aria-label="A message in a bottle">
      <div className="bottle-note" onClick={(e) => e.stopPropagation()}>
        <p className="muted bottle-line">{line}</p>
        <blockquote>{note}</blockquote>
        <button className="small" onClick={onClose}>
          Roll it up again
        </button>
      </div>
    </div>
  );
}
