import { useEffect, useState } from "react";

/** Whether this is a Mac, where the Alt key is called Option (⌥). */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** The Alt key as it is named on this machine, for a hint that says to hold it. */
export const altName = isMac ? "⌥ Option" : "Alt";

/**
 * Whether a modifier key is held down just now, for anything that shows more while it is held (holding Alt over a
 * unit in a fight to read its effects in full). Let go, or the window losing focus, ends it, so a key released
 * while elsewhere never sticks. A bare press of Alt is kept from the browser, which would otherwise move the focus
 * to its own menu when it is let go.
 */
export function useHeldKey(key: "Alt" | "Shift" | "Control" | "Meta"): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const flag = { Alt: "altKey", Shift: "shiftKey", Control: "ctrlKey", Meta: "metaKey" } as const;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === key && !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) e.preventDefault();
      setHeld(e[flag[key]]);
    };
    // A pointer that moves says too, which catches the key pressed or let go while the page did not have focus.
    const onMove = (e: MouseEvent) => setHeld(e[flag[key]]);
    const off = () => setHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", off);
    };
  }, [key]);
  return held;
}
