# TODO

Work that still needs doing on the game. Agents: read this before you start, and add to it whenever you notice
something that should be done but is not part of your task (one line each, under the area it belongs to). Take a
line off once it is done.

## Combat

- Merge the hero and enemy ability engines into one effect list (docs/combat-effects-design.md).

## Enemies

- Adjust scaling for enemy abilities: how each one's numbers grow with level (`scales` in
  `packages/world/src/zone/enemyabilities.ts`, rates in `rules.ts` SCALE_RATES).

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

- A passage is sailed on a fixed Sloop (`PASSAGE_SHIP` in `apps/game/src/server/atlas.ts`). Read the crew's own ship
  and her hull from the shipyard (`packages/world/src/voyage/ships.ts`, `crew_ships`) once that is merged, and write
  her hull back when the voyage ends.
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
- A room's side walls are squared (`squared`, `halfColumn`, `wallSide` in `WorldRenderer.ts`; the floor's half-hex
  fill is `squareEdges` in `render/ambience.ts`), but its back and front walls still zigzag along the row, as do a
  deck's bow and stern: those want triangles, not half hexes. On a squared wall three hex sides share one straight
  face, a third each, so two wide things hung on neighbouring sides of one wall hex can overlap.
