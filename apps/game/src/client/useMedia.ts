// Whether a media query matches, kept up to date as the window changes. For a
// layout that changes what a press does, not only how things look (a phone's
// roster opens a card where a computer's acts at once): the stylesheet uses the
// same query for the look.

import { useEffect, useState } from "react";

/** A phone, held either way: the stylesheets' own `(max-width: 760px), (max-height: 520px)`. */
export const PHONE_QUERY = "(max-width: 760px), (max-height: 520px)";

const matches = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setOn(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return on;
}
