// Asked before walking onto a map others are already on: more heroes there means more enemies for all of them
// (packages/world zone.ts growGroups). The server says whether anyone else is there (routes/shared.ts othersOn).

export const JOIN_WARNING = "Others are already on this map. Joining them makes it harder for everyone there: each band not yet beaten gets more fighters, to match the bigger party. Join them?";

/** Go on: there is nobody else there, or the player says yes. */
export const joinOk = (others?: boolean): boolean => !others || confirm(JOIN_WARNING);
