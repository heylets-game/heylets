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

## Release notes

- A `Release-note: skip` on any one commit in a PR hides the whole squash-merged PR from the notice board (Atlas #500,
  class abilities #494, the enemy rework #650 all needed overrides). Make `skip` apply only to its own `* subject`
  section of a squash message in `apps/game/scripts/release-notes.ts`, or have CI flag a PR whose branch has a `skip`.
