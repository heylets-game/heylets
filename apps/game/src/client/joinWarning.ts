// Asked before walking onto a map others are already on: more heroes there means more enemies for all of them
// (packages/world zone.ts growGroups). The server says whether anyone else is there, and whether the player's whole
// party fits (routes/shared.ts othersOn): a map takes so many, and the last of a party who do not fit stay behind.

export const JOIN_WARNING = "Others are already on this map. Joining them makes it harder for everyone there: each band not yet beaten gets more fighters, to match the bigger party. Join them?";

/** What the server says of a map under way: others are on it; it has room for `room` more, and the player brings `bringing`. */
export interface JoinNews {
  others?: boolean;
  room?: number;
  bringing?: number;
}

/** What the player is asked, if anything: that the map is full, that not all their party fits, or that others are there. */
export function joinQuestion(news: JoinNews): string | null {
  const { room, bringing } = news;
  if (room !== undefined && bringing !== undefined && bringing > room) {
    if (room === 0) return "This map is full: nobody else can join it.";
    const short = bringing - room;
    return `This map has room for ${room} more ${room === 1 ? "hero" : "heroes"}, and your party is ${bringing}: the last ${short === 1 ? "of them stays" : `${short} of them stay`} behind. Others are on it, and joining makes its bands bigger. Go anyway?`;
  }
  return news.others ? JOIN_WARNING : null;
}

/** Go on: there is nobody else there, or the player says yes. A full map is only said, never gone onto. */
export function joinOk(news: JoinNews | boolean | undefined): boolean {
  const ask = joinQuestion(typeof news === "object" ? news : { others: !!news });
  if (!ask) return true;
  if (news && typeof news === "object" && news.room === 0) {
    alert(ask);
    return false;
  }
  return confirm(ask);
}
