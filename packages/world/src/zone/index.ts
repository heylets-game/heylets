// Zones: maps a party walks freely and fights on, turn by turn, on the
// tiles themselves. What the server and the client need is named here;
// the rest (the small moves in engine.ts, the enemy's reasoning in ai.ts)
// stays inside.

export * from "./types";
export { createZone, ensureEnemyAbilities, ensureMouth, loadZone, stepZone, zoneView, zoneAwaiting, zoneUntimed, zoneHero, standInHero, growGroups, MAX_PARTY, MAP_FULL } from "./zone";
export { ZONE_GRIDS, ALERT_RANGE, JOIN_RANGE, DEFAULT_ZONE_OPTIONS, BIOME_LEADS, zoneOptions, generateZone, groupKinds, type ZonePlan } from "./gen";
export {
  FREE_WALK, MAX_ELEV, HEX_ROOM, HIGH_REACH,
  zoneReach, pathIn, sees, sameHex, elevOf, inFight, flies, hovers, perkOf, unitAt, unitsAt, roomAt, heldAgainst, unitById, isDead, lineFrom, stepCost, blockerAt, seesFor, wallAt, ladderBetween, strikes, reachFrom, pitAt, solid as zoneSolid,
  blast as zoneBlast, big, bulk, span, spanAt, covers, noWayThere, fetterBars, roomFor, nearOf, gap, gapTo, meet, reaches, SPAN3, leanWithin, nearestHexes, type Lean, type Reached, type Course, type Pit,
} from "./geometry";
export { PROPS, PROP_KINDS, propOf, type PropKind, type PropDef } from "./props";
export { SITES, SITE_IDS, FACTIONS, siteInside, siteOpen, siteFor, placeName, SITE_GROUNDS, LOOKOUT_INSIDE, LAIR_INSIDE, backdropOf, factionsOf, bandOf, type SiteId, type SiteGround, type SiteDef, type Backdrop, type PieceKind, type FactionId } from "./sites";
export { LAY_GRIDS, layZone } from "./lay";
export {
  TACTICS,
  tacticOf,
  abilityDice,
  healDice,
  CONDITION_INFO,
  conditionText,
  COMMON_ACTIONS,
  commonCost,
  commonCostFor,
  jumpRange,
  blinkRange,
  FLEE_RANGE,
  THROWABLES,
  STARTING_ITEMS,
  THROWABLE_KINDS,
  LIGHT_RADIUS,
  TORCH_HELD_ROUNDS,
  TORCH_GROUND_ROUNDS,
  EXPLORE_ROUND_MS,
  TORCH_ROUND_MS,
  SHIELD_SET_ASIDE,
  SMUGGLED,
  SEA_TURTLE,
  DROWNED_GUNNER,
  DROWNED_CUTLASS,
  SUMMONS,
  SUMMON_CALLS,
  DROWNING,
  DROWNING_CURSE,
  BLACK_SPOT,
  RED_SKY,
  UNHOLY_WATERS,
  AQUEOUS,
  CORAL_ARMOR,
  SPLASH,
  SHANTY,
  AURAS,
  CHORUS_PER_ALLY,
  GUIDING_LIGHT,
  CONSTELLATION,
  CHART,
  NORTH_STAR,
  AGAINST_WAVES,
  ENDURE,
  OVERWHELM,
  FORTIFY,
  BULWARK,
  TAUNT,
  cleanItems,
  throwRange,
  JUMP_RANGE,
  JUMP_UP,
  JUMP_DOWN,
  AP_TURN,
  SUMMON_AP_TURN,
  AP_MAX,
  ACTION_AP,
  BONUS_AP,
  ITEM_AP,
  POTION_DICE,
  POTION_EDGE,
  ENEMY_KIT,
  ENEMY_BURST,
  abilityStrikes,
  enemyStrikes,
  retortDice,
  unitStrikes,
  unitStrike,
  mindOf,
  DEFAULT_MIND,
  type Mind,
  enemyDefence,
  enemyMove,
  ENEMY_MOVE_AP,
  enemyHp,
  ENEMY_EDGE,
  GROUP_EXTRAS,
  STROLL_STEP_MS,
  type Tactic,
  type SummonDef,
  type SummonCall,
  type Shape,
  type ThrowableDef,
  type EnemyStrike,
} from "./kit";
export { mod as statMod, proficiency, heroMove, heroDefence, diceFor, diceText, diceAverage, hitChance, rollShown, scaled, SCALE_RATES, DEFAULT_SCALE, type Dice, type ScaleRate } from "./rules";
export { SPURS, UNTIMED, attackContext, defenceOf, has as hasCondition, shieldOf, unseen, usesLeft, type AttackContext } from "./engine";
export { FIGHTS_ONLY, abilityArea, damageRoll, healRoll, carrySpot, checkAbility, checkCommon, checkDrink, checkLight, checkThrow, courseFor, crateBlow, isBlink, moveLeft, walkAp, apForMove, payMove, previewAttack, leavesReach, shiftInto, shoveDest, edgeDc, EDGE_DC, BARD_AURA_RANGE, type Aim, type Shift } from "./combat";
export { chartOf, constellationHexes, constellationLinks, courseMarks, litFoes } from "./stars";
export { SURFACE_INFO, HARMFUL as HARMFUL_SURFACES } from "./surfaces";
export { WEATHER_INFO, clusterHexes, wallHexes } from "./weather";
export { summonsOf, summonSpots } from "./summon";
export { breathDc, drowningStacks } from "./drowning";
export { SHANTIES, isShanty, joinable, shantyOf, shantyRadius, songsOn, type Song } from "./song";
export { carriesLantern, isDark, litHexes, inDark, seenByHeroes, lightSources, hiddenEnemies } from "./light";
export { MAX_CATCHUP_ROUNDS, nextTick } from "./clock";
export { CHEST_PAY, SPOILS_ID, bountyPay, checkOpen, checkLoot, lootGroup, lootIn, sharedLoot, unopened, unlooted, zoneCleared } from "./loot";
export { ENEMY_FAMILY, FAMILY_LOOT, BOSS_LOOT, rollBody, rollChest, rollSpoils, type Family } from "./spoils";
export { ENEMY_DEV_MAX_LEVEL, KIT_MAX_LEVEL } from "./zone";
export { FORCE_DC, NOISE_RANGE, checkUnlock, doorAt } from "./doors";
export { GLOWCAP_LIGHT, GLOWCAP_MUSHROOMS, checkForage } from "./forage";
export { CRATE_HP, CRATE_PAY, crateAt, crateById, crateHp, isCrateId } from "./crates";
export { ENEMY_ABILITIES, type AbilityScales, type EnemyAbilityDef } from "./enemyabilities";
export { TURN_STEPS, type Turn, type TurnStep } from "./ai";
export { checkStrike, strikeAim, strikeHexes, type StrikeAim } from "./strikes";
export { BEHAVIOURS, behaviourOf, type Behaviour, type BehaviourId, type Look, type Use } from "./behaviours";
export { BELL_AP, BELL_CHANCE, BELL_RUSH, liveBell } from "./bell";
export { DELVE_GRID, DELVE_CRATES, generateDelve } from "./delve";
export { ZONE_MODS, ZONE_MOD_IDS, PERIL_IDS, BOON_IDS, MAX_MODS, MAX_BOONS, cleanMods, modsOf, modOf, modToken, modEffect, modName, modSide, modRanks, rollMod, type ZoneMod, type ZoneModId, type ZoneModDef, type ModSum } from "./mods";
