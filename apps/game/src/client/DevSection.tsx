// A section of a dev toolbox tab (DevToolbox.tsx) that folds away under its heading, so a long tab can be cut down
// to the parts in use. Each remembers, per browser, whether it was left open.

import { useState, type ReactNode } from "react";

const KEY = (id: string) => `gq.dev.section.${id}`;

const recall = (id: string): boolean | null => {
  try {
    const v = localStorage.getItem(KEY(id));
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
};

/** `id` names it for remembering; `open` is how it starts the first time (shut, if left out). `note`: a line beside the heading. */
export function DevSection({ id, title, note, open: first = false, children }: { id: string; title: string; note?: ReactNode; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(() => recall(id) ?? first);
  const toggle = (on: boolean) => {
    setOpen(on);
    try {
      localStorage.setItem(KEY(id), on ? "1" : "0");
    } catch {
      // Blocked storage: it stays as it is until the page is closed.
    }
  };
  return (
    <details className="dev-section" open={open} onToggle={(e) => (e.currentTarget.open !== open ? toggle(e.currentTarget.open) : undefined)}>
      <summary>
        <strong>{title}</strong>
        {note && <span className="muted">{note}</span>}
      </summary>
      <div className="dev-section-body">{children}</div>
    </details>
  );
}
