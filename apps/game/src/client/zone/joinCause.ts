// How a band (or a hero) coming into a fight is told: a line in the log saying why it came, and a word over each of its heads.
// One row per cause the rules give (world zone/types.ts JoinCause), so a new cause is a new row here.

import type { HeroJoinCause, JoinCause } from "@gantt-quest/world";

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

/**
 * The same for a hero coming into a fight already on. `hero` is their name, `other` whom the cause names (who they
 * came near, or acted on), `friend` whether that one is on their side.
 */
export const HERO_JOIN_WORDS: Record<HeroJoinCause["kind"], { float: string; line: ((hero: string, other: string, friend: boolean) => string) | null }> = {
  near: { float: "Joins in!", line: (hero, other) => `${hero} is close to ${other} and joins the fight.` },
  acted: { float: "Joins in!", line: (hero, other, friend) => `${hero} ${friend ? "helps" : "attacks"} ${other} from outside the fight and joins it.` },
  // The band's own line has said it (JOIN_WORDS): they set it off.
  band: { float: "Joins in!", line: null },
};

/** Whom a hero's cause names. */
export const heroJoinUnit = (why: HeroJoinCause): string | null => (why.kind === "near" ? why.near : why.kind === "acted" ? why.on : null);

/** The one the cause names: who was seen, struck or rang, or whom the band heard fighting. */
export const joinCauseUnit = (why: JoinCause): string => (why.kind === "heard" ? why.near : why.by);

/** A band named by its first member and how many more came with it. */
export const bandName = (names: string[]): string => (names.length <= 1 ? (names[0] ?? "Someone") : `${names[0]} and ${names.length - 1} more`);
