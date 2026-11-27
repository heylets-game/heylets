// A window in the new UI's wood: a board of the sea bag's timber (theme.css
// `.timber` for everything in it) with the logbook's brass corners, its name on
// a ribbon over the top edge, and a close button at its corner if it has one.
// The game menu, the account window and the main menu are each one; anything that opens over
// the view as a window of its own can be.
//
// It is the box only: the overlay behind it, and closing on Escape or a press
// outside, belong to whoever opens it. Sized and laid out by its own class.

import type { ReactNode } from "react";
import { BrassCorners } from "./BrassCorners";
import "./wood.css";

export function WoodWindow({ plate, label, className = "", id, onClose, role = "dialog", labelledBy, children }: {
  /** The name on the ribbon. */
  plate?: ReactNode;
  /** What a screen reader calls it, where the ribbon is not plain words. */
  label?: string;
  className?: string;
  id?: string;
  /** The × at its top right corner. Left out, there is none (the window has its own way out). */
  onClose?(): void;
  /** "dialog" for a window opened over the view; a screen that is the window (the main menu) says "region". */
  role?: string;
  /** The id of its own heading, where that names it. */
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <div className={`wood-window timber ${className}`} id={id} role={role} aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label ?? (typeof plate === "string" ? plate : undefined)}>
      <BrassCorners />
      {plate && <span className="win-plate">{plate}</span>}
      {onClose && <button type="button" className="wood-close" aria-label="Close" title="Close" onClick={onClose}>×</button>}
      {children}
    </div>
  );
}
