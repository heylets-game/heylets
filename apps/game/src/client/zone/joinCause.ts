// How a band coming into a fight is told: a line in the log saying why it came, and a word over each of its heads.
// One row per cause the rules give (world zone/types.ts JoinCause), so a new cause is a new row here.

import type { JoinCause } from "@gantt-quest/world";

/** The words for one band joining: `band` is who came ("Bandit", "Bandit and 2 more"), `many` whether that is more than one. */
interface JoinWords {
  /** Over each of the band's heads as it comes. */
  float: string;
  /** The log line, or null where another line already says it (the bell's "The alarm is up"). */
  line: ((band: string, many: boolean, cause: string, caves: boolean) => string) | null;
}

const s = (many: boolean, one: string, more: string) => (many ? more : one);

export const JOIN_WORDS: Record<JoinCause["kind"], JoinWords> = {
  seen: { float: "Spotted you!", line: (band, many, by) => `${band} ${s(many, "spots", "spot")} ${by} and ${s(many, "joins", "join")} the fight.` },
  heard: {
    float: "Heard!",
    line: (band, many, near, caves) => `${band} ${s(many, "hears", "hear")} the fighting${caves ? " through the tunnels" : ""} near ${near} and ${s(many, "joins", "join")} in.`,
  },
  struck: { float: "Joins in!", line: (band, many, by) => `${by}'s attack draws ${band} into the fight.` },
  noise: { float: "Heard!", line: (band, many, by) => `${band} ${s(many, "hears", "hear")} ${by} force the door and ${s(many, "comes", "come")} running.` },
  bell: { float: "The bell!", line: null },
};

/** The one the cause names: who was seen, struck or rang, or whom the band heard fighting. */
export const joinCauseUnit = (why: JoinCause): string => (why.kind === "heard" ? why.near : why.by);

/** A band named by its first member and how many more came with it. */
export const bandName = (names: string[]): string => (names.length <= 1 ? (names[0] ?? "Someone") : `${names[0]} and ${names.length - 1} more`);
