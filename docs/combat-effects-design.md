# One effect list for heroes and enemies (a design, not yet built)

A hero's ability is an `AbilityDef` (content.ts) plus a `Tactic` (zone/kit.ts), an enemy's is an `EnemyAbilityDef`
(zone/enemyabilities.ts). Each side has its own engine: `resolveAbility` (a table of kinds, `ABILITY_KINDS`) and
`enemyAttack` (a single function that walks the same effects in a fixed order). This note says what still differs after
the shared pieces landed, and proposes one effect list for both. **Nothing here is built. It needs agreeing first.**

## What is already shared

Arriving on a hex (`arrive`), saving for half (`saveForHalf`), the splash (`splashAround`), the knockback
(`knockBack`), the drain and what stops an effect (`unless.ts`), and the area shapes (`Spread`, `spreadOver`). The
enemy's strike also carries its whole definition (`EnemyStrike.def`).

## What still differs

| | Hero (`Tactic` / `AbilityDef`) | Enemy (`EnemyAbilityDef`) |
| --- | --- | --- |
| Choosing it | the player picks, `checkAbility` says if it can | `behaviours.ts` weighs it, `strikes.ts` checks a dev's aim |
| Damage | `abilityDice`, plus the user's stat, level and the parts of the moment (`rollDamage`) | `diceFor(scaled(...))` by level, no parts |
| To hit | `attackRoll` with a stat; or none (`sure`) | `attackRoll` with `potency`; or none (an area, a `saves` blow) |
| Aim | `Aim` (target, hex, lean) | a target and a hex |
| What it leaves | `afflict` with `saveOr` / `targetEffect` / `selfEffect` | `saveOr`, `onSave`, `tether` |
| The ground | `surface`, `ignites`, `weather` | `surface`, `chills`, `field`, `aftershock` |
| Moving someone | `knockback`, `pull`, `overwhelm`, a wave's sweep | `push` |
| Moving the user | `blink`, `stride`, a Jump | `dash`, `leap` |
| Its own side | heals, shields, shanties, rally, hide, taunt | `rally`, `heal`, `summon`, `field` |
| Cost | AP and a cooldown, from the ability | `cost`, `cooldown` |

Several of these are deliberate features of one ability (Soul Drain's rounding, a hero's blast reaching hexes with no
ground, an enemy's away-player protection), so merging means keeping each as a setting, not dropping it.

## A proposal: effects as data

Give both sides one list of what an ability does, applied in order to what it reaches:

```ts
type Effect =
  | { kind: "damage"; dice: Dice | "scaled"; save?: "half" | "none"; unless?: Unless[] }
  | { kind: "drain"; share: number; unless?: Unless[] }
  | { kind: "condition"; effect: Inflict; save?: boolean; onSave?: Inflict }
  | { kind: "push"; hexes: number; stopAtWall?: boolean }
  | { kind: "pull"; hexes: number }
  | { kind: "splash"; share: number; save?: boolean }
  | { kind: "surface"; surface: SurfaceKind; rounds: number }
  | { kind: "field"; ... }
  | { kind: "heal" | "shield" | "summon" | "rally"; ... };

interface AbilityShape {
  reach: { range: number; shape: "single" | Spread; sees?: boolean };
  roll: { stat: StatKey | "potency" } | "none";
  effects: Effect[];
}
```

A hero's `Tactic` flags and an enemy's optional fields both become `effects`. `resolveAbility` and `enemyAttack` become
one `applyEffects(ctx, user, shape, aim)`, with the hero-only rules (the parts of the moment, spurs, Unseen) as hooks
the hero side supplies. The enemy AI weighs an ability by walking its `effects` instead of naming a `behaviour`.

## Order of migration

1. Give each shared effect above an `Effect` entry and have the existing code build and run it (no data change).
2. Move enemy abilities to `effects` one behaviour at a time (`strike`, `burst`, `shove`, then the rest), keeping the
   golden recordings (`golden.test.ts`) unchanged at every step.
3. Move the hero tactics over by shape (`single`, areas, then the many one-off flags), splitting `use_support` as it goes.
4. Let the AI weigh `effects` directly, and drop `behaviour`.
5. Retire `Tactic`'s flags and `EnemyAbilityDef`'s optional fields.

## Questions for the owner before starting

- Should heroes ever use an enemy's abilities (a charmed foe, a summon)? The shared list makes it possible.
- Is the hero's blast meant to reach hexes with no ground? (`Spread.onMapOnly`: an enemy's leaves them out, a hero's does not.)
- How should an enemy's cooldown and AP, which a hero's ability sets differently, be written in one place?
