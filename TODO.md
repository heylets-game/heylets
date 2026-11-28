# TODO

Work that still needs doing on the game. Agents: read this before you start, and add to it whenever you notice
something that should be done but is not part of your task (one line each, under the area it belongs to). Take a
line off once it is done.

## Combat

- Merge the hero and enemy ability engines into one effect list (docs/combat-effects-design.md).

## Enemies

- Adjust scaling for enemy abilities: how each one's numbers grow with level (`scales` in
  `packages/world/src/zone/enemyabilities.ts`, rates in `rules.ts` SCALE_RATES).

## Ships

- A map's own limit is still six heroes (zone.ts `MAX_PARTY`, `othersOn` in `server/routes/shared.ts`, `sailTo` in
  `HarborView.tsx`): heroes who sail out to a map after it was made can take it past what the crew's ship carries.
  Carry the ship's number on the map's options and hold joining to it.
- The fountain makes no sound (the waygate's burst had one): add running water near it in `audio/manifest.ts`.
- The middle pier head is the ship's now: "Cast a line" there is only the second button, and only while the crew
  has no map open. Give `Here` more than one `also`, or move the ship's boarding hex one step back along the pier.
- The atlas does not yet show which places are past the ship's reach (PR 2 owns `AtlasLayer.ts`): mark them, and
  say which ship is needed, instead of only refusing on setting out (`reachProblem` in `voyage/ships.ts`).
- Ship numbers (`SHIPS` in `packages/world/src/voyage/ships.ts`) and the Brig's and Galleon's costs in
  `projects.ts` are first guesses: tune them once voyages are played.

## UI

- The keepers' rooms (Talk on the strip over the bottom bar) could use the top bar the hut and the pub have,
  `apps/game/src/client/ui/TopBar.tsx`: the room's name, what to do here, and Leave.
- Windows still in the old pixel frame and orange buttons: the party picker (`PartyPicker.tsx`), the hero sheet, the
  sea bag's buttons. Move them to the new wood (`ui/WoodWindow.tsx`, theme.css `.timber`), as the menus, the account
  window and the chat are.

## Charters

- Lodestones are shown to players as charters, but the internal names and stored kinds still say lodestone
  (`consumables.kind`, `town_tabs.kind`, `atlas_nodes.stone`, the `lodebearing` mod id, file and export names). They
  could be renamed, with a data migration.
- The chartmaker's room and the atlas's node markers are still modelled as cut stones and gem shelves
  (`render/lapidary.ts`, `render/lapidaryProps.ts`, `client/atlas/AtlasLayer.ts`). They want parchment, ink and seals.
- A crew's town-chest tab made before the rename is still named "Lodestones" (`town_tabs.name` is stored when the
  tabs are first made). Rename the ones nobody renamed themselves, with a data migration.
- Writing a boon into a charter still costs what it did as a stone (the `lodebearing` row of `ATTUNE_MATERIALS` in
  `packages/world/src/stonecraft.ts` is stone, iron and gems). Decide whether parchment wants other makings.

## Release notes

- A `Release-note: skip` on any one commit in a PR hides the whole squash-merged PR from the notice board (Atlas #500,
  class abilities #494, the enemy rework #650 all needed overrides). Make `skip` apply only to its own `* subject`
  section of a squash message in `apps/game/scripts/release-notes.ts`, or have CI flag a PR whose branch has a `skip`.

## Voyages

- A passage is sailed on the crew's own ship with her hull as the yard keeps it (`passageShip` in
  `apps/game/src/server/atlas.ts`), but what the voyage takes off her hull is not written back to `crew_ships` when
  it ends (`apps/game/src/server/db/ships.ts`).
- Stations still to build (`STATIONS` in `packages/world/src/voyage/voyage.ts`): cannon, pump, crow's nest. Hull hits
  only take hull off: no breaches to mend with planks yet, and nobody goes overboard.
- Sea creatures (a spitting squid with a `swims` flag in `ENEMY_KIT`) are not in: boarders are bandits and skeletons.
- The harpoon is a tap on what is adrift (`zone/Voyage.tsx`): the sweeping aim, a line drawn to what was struck and a
  reel-in (`SpellFx.harpoon`) are not done, and a second line into wreckage shows nothing while it holds.
- After a passage is beaten the party goes home: "Sail on to an island beyond" (open the next map from the deck) is
  not built. A sunk ship only says so in the strip; nobody is sent home, and half the hold is not kept.
- A passage's mark on the atlas is a place's marker (`AtlasLayer`): it wants its own (a buoy), and the ship is not
  drawn sailing the route. A silent run past a passage has no night-sail moment.
- Tune: rocks strike often for a lone hero (a sloop lost two thirds of her hull unsteered in one passage); the share of
  routes with salvage waters (`PASSAGES`), the stretch's length (`VOYAGE_MS`) and what salvage pays.
- A room's walls and a deck's edges are cut in half (`packages/world/src/roomedges.ts` says which; drawn by
  `cutColumn` and `wallSide` in `WorldRenderer.ts` and the floor fill in `render/ambience.ts`). Furniture stands on
  the floor half by its footprint (`onCutFloor` in `hutroom.ts`), anchored on the floor hex beside it: it cannot be
  anchored on the half itself, small things cannot be set down there, and nobody walks there. Corners are squared
  (a quarter of the corner hex goes to the floor); a wall with floor on both sides of it is left whole. A corner's
  face along the side wall takes wallpaper but nothing can be hung on it. Several
  hex sides share one straight face (a third each on a side wall, half each on a back or front wall), so two wide
  things hung on neighbouring sides of one wall hex can overlap.
