// One release's notes as a list, a line each: "Felling: Chops cut a notch".
// The notice board and the "newer version" notice both show notes this way.
//
// ReleaseRollup shows a release's written summary, if it has one, then a long
// release as how many changes and which parts of the game they touch, with a
// Details button for the lines.

import { useId, useState } from "react";
import { releaseAreas, type ReleaseNote } from "../releases";

export function ReleaseLines({ notes, className, id }: { notes: readonly ReleaseNote[]; className?: string; id?: string }) {
  return (
    <ul className={className} id={id}>
      {notes.map((n, i) => (
        <li key={i}>
          {n.area && <strong>{n.area}: </strong>}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

/** A release with more lines than this is summed up until the player asks for the details. Shorter ones are as quick to read in full. */
const ROLL_UP_OVER = 3;
/** Areas named in a summary before the rest are counted as "+N more". */
const AREAS_NAMED = 6;

/** A release's written summary: a short paragraph over its lines. */
export function ReleaseSummary({ summary }: { summary?: string }) {
  return summary ? <p className="release-summary-text">{summary}</p> : null;
}

/**
 * A release's notes, summed up: its written summary, "12 changes", each part of
 * the game they touch with how many lines are about it, and Details to read
 * every line. A short release's lines are listed in full, as there is nothing to save.
 */
export function ReleaseRollup({ notes, summary, className }: { notes: readonly ReleaseNote[]; summary?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (notes.length <= ROLL_UP_OVER) {
    return (
      <div className="release-rollup">
        <ReleaseSummary summary={summary} />
        <ReleaseLines notes={notes} className={className} />
      </div>
    );
  }
  const areas = releaseAreas(notes);
  // A big release touches dozens of areas: name the busiest, and say how many more.
  const named = areas.length > AREAS_NAMED + 1 ? areas.slice(0, AREAS_NAMED) : areas;
  const more = areas.length - named.length;
  return (
    <div className="release-rollup">
      <ReleaseSummary summary={summary} />
      <div className="release-summary">
        <span className="release-count">{notes.length} changes</span>
        <ul className="release-areas" aria-label="Parts of the game this changes">
          {named.map((a) => (
            <li key={a.area ?? ""}>
              {a.area ?? "Other"}
              {a.count > 1 && <span className="release-area-count">{a.count}</span>}
            </li>
          ))}
          {more > 0 && <li className="release-areas-more">+{more} more</li>}
        </ul>
        <button className="link release-details" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>
      {open && <ReleaseLines notes={notes} className={className} id={listId} />}
    </div>
  );
}
