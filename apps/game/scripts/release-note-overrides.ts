// Release notes for commits already merged, where the subject (or a missing
// Release-note trailer) did not say it well. Keyed by full commit hash; the
// value is the lines to show instead, each read like a subject
// ("Area: text"). An empty list leaves the commit out.
//
// For new work, write the subject or a Release-note: trailer instead (see
// release-notes.ts); this list is only for the past.

export const OVERRIDES: Record<string, string[]> = {
  // The release after game-v2026.11.26 (#650). Left off the board by "Release-note: skip" on its dev-tool commits;
  // these are its notes, with each change shown as it ended up rather than every step on the way.
  "956b73b2f0a966950d7524d5db3835cdd8b9248d": [
    "Fights: Lucky and Frenzied show as stacks, one used up on each attack, with no turn timer",
    "Fights: Fumbling and Inspired show as stacks that add up, one spent on each roll to hit, and last until the fight ends",
    "Fights: when a fight ends, or you flee one, every effect on you goes except Lucky",
    "Fights: out of a fight, no effect takes hold on anyone except Lucky, and fire, poison, ice and the like on the ground do you no harm",
    "Abilities: those for yourself or an ally can only be used in a fight, or on a friend in one",
    "Town well: lucky rolls you have not spent last past the end of a fight",
    "Hazards: patches that never wear off no longer show a count of rounds",
    "Fights: hold Alt (Option on a Mac) over anyone in a fight to read what each effect on them does",
    "Fights: hovering a shared hex shows the effects on both creatures, in full when you hold Alt",
    "Fights: weather and ground effects on a hex get their own part of the hover card, explained when you hold Alt",
    "Fights: pointing at an enemy shows its level, and a fallen enemy's card shows only its name and that it is down",
    "Fights: an enemy's card says what ground it is unharmed by",
    "Fights: a walk that can't be made says why, instead of blaming your AP",
    "Fights: walking on through web or slime no longer says Slowed again on every hex",
    "Fights: anyone shoved, knocked back or swept away leaves a trail of dust",
    "Fights: a summoned creature appears where it was called, then walks off from there",
    "Fights: an aura or a Fettered chain fades once it ends or its caster dies",
    "Fights: a strike as you leave an enemy's reach no longer shows as that enemy's turn",
    "Fights: when more enemies or another hero join a fight, the log says why, and a word shows over their heads",
    "Fights: a band hears a fight from 3 hexes away, as far as it can see you, no longer 5",
    "Fights: an enemy you met before it changed now fights with its new abilities, instead of standing idle",
    "Fights: Acid Splash and Immolate are drawn landing in the middle of the hexes they hit",
    "Fights: the Join song button is as tall as the turn pennant and level with it",
    "Sound: a hero's critical hit sparkles, and an enemy's lands like a heavy blade",
    "Sound: rolling a natural 20 rings out so the table hears it",
    "Sound: a heal that lands never sounds like one that failed, and a boss arriving never sounds like one falling",
    "Abilities: three- and four-hex areas are laid where your pointer is, turning as you move it",
    "Abilities: tooltips show the damage and healing you would really roll, with your stats, weapon and level added",
    "Chain Lightning: cast once, then it leaps from enemy to enemy by itself",
    "Revitalizing Splash: a ball of water lobbed onto your allies bursts in a splash",
    "Bulwark Strike: adds half your shield to the blow, up to the most the blow could roll without it",
    "Loot: searching a body goes through every body beside it too, all in one window that grows to fit",
    "Loot: when two enemies fall on the same hex, both can be searched, and the gold ring goes once both are empty",
    "Stats: Vitality says it gives 3 max HP a point, as it does",
    "Bottom bar: its tooltips are in the same smooth style as the fight panels",
    "Menu: the menu button's tooltip no longer stays on screen once the menu is open",
    "Party: the gold \"you\" tag reads cleanly, with no smudged shadow",
    "Atlas: lairs, and the bosses in them, turn up about twice as often",
    "Guardian: a hulking golem of sea-worn stone that stands on three hexes, and can be struck from beside any of them",
    "Guardian: too heavy to shove, pull or knock back, and says so",
    "Guardian: Stone Fist hits harder, knocks its target back a hex, and leaves them Prone unless they save",
    "Guardian: Earthquake cracks the ground all round it, then heaves on its next turn and throws whoever is still on it off their feet",
    "Guardian: new Slowing Field slows every hero within two hexes of it for three turns, as light pours off its chest gem",
    "Guardian: 80% more hit points",
    "Pack Leader: its Howl reaches the pack within 3 hexes, and each wolf it stirs glows red",
    "Pack Leader: has 70% more health",
    "Shade: its Wail leaves anyone who fails to resist Fumbling, but it needs 3 turns to recover",
    "Shade: new ghostly animations and sounds for Chill Touch and Wail",
    "Cave Bat: new Fell Swoop replaces Screech, a dive in a straight line that rakes every hero it passes and leaves them Bleeding unless they dodge for half",
    "Cave Bat: nobody gets a free swing at it as it swoops away, and it swoops more often",
    "Cave Bat: its Bite is one quick snap that hits harder, and no longer causes Bleeding",
    "Skeleton: new Memento Mori replaces Bone Rattle: anyone beside it who fails to save starts Fumbling each time they are hurt, for 4 turns",
    "Cave Slime: its Acid Splash lands on 3 hexes and eats into armor",
    "Cave Slime: hitting it in melee burns you with its Acid Armor",
    "Cave Slime: Engulf, Acid Splash and Acid Armor have their own animations",
    "Giant Spider: Web Spit lands on three hexes for 6 damage, but needs three turns to spin again",
    "Giant Spider: Venomous Bite does 7 damage, and both its moves have new animations",
    "Giant Spider: unharmed by poison and slime on the ground",
    "Haunt: a new look, with a royal collar and cape, broken chains on its wrists and burning red eyes",
    "Haunt: Grave Grasp reaches a hand of ice over the three rows in front of it, Slowing whoever fails to dodge",
    "Haunt: Ice Spear flies five hexes in a straight line through everyone on it",
    "Haunt: Ghastly Fetter never misses: it chains a hero to their spot and leaves them an AP short for three turns, unless a Vitality save halves it",
    "Haunt: its Terror Aura gives every hero within 2 hexes disadvantage on saves",
    "Haunt: 69 HP, up from 43",
    "Broodmother: Spin Web covers the ground round its target in web that slows you and speeds up spiders",
    "Broodmother: Brood Swarm calls two Spiderlings to fight beside it, up to 14 at once",
    "Broodmother: Impaling Fang dents your armour on a failed save",
    "Broodmother: each move has its own animation, and it no longer carries an egg sac",
    "Broodmother: has 40% more health",
    "Frost Wolf: breathes a cone of frost that slows everyone it catches, and its bite looks as cold as it is",
    "Ember Hound: bursts into flame, burning everyone beside it; a save only halves it",
    "Ember Hound: walks through fire unharmed, and its bite looks as hot as it is",
    "Snow Bear: a swirling Blizzard Aura replaces Roar, cutting and staggering anyone who stands beside it",
    "Rime Wraith: throws an Icy Bomb that ices over the ground where it lands",
    "Rime Wraith: its frost shot is now a glowing Frost Mote that drifts at you",
    "Enemies: the Rime Wraith, Snow Bear and Frost Wolf cross ice without slipping",
    "Hedge Witch: its Weakening Hex leaves you 2 worse at every save until your next turn ends",
    "Hedge Witch: throws a brew that splashes over 3 hexes, healing its allies and itself",
    "Cultist: Immolate is aimed to keep its fire off the Cultist's allies, unless it catches a crowd of heroes",
    "Brute: Great Cleave cuts one great steel slash across both rows it hits",
    "Great Bear: its mane stops short of its head and rump",
  ],
  // The release after game-v2026.11.24.4 (#624). Its second line said "Map:" where every other line says "Maps:".
  "14eb0597855ab94f94e573a6d4d471ee130b2586": [
    "Enemies: a band notices you from 3 hexes away if it can see you",
    "Maps: a red outline shows where each band can see",
  ],
  // The release after game-v2026.11.23 (#575). Its subject, "Sanity combat balance pass", said nothing a player could
  // use: these are the changes in it they will notice.
  "297f49e19e7416b04756d48e92c4658539848077": [
    "Fights: most attacks, spells and heals were rebalanced, and most now hit a little less hard",
    "Shanty Bard: Hornpipe rallies you and every ally within 2 hexes for +2 damage on your next attack",
    "Reef Druid: Rejuvenate heals again at the start of the ally's next turn",
    "Fights: Soul Drain heals you for half the damage it does",
    "Fights: Pull of the Deep strikes 3 hexes up to 5 away, and Taunt reaches every enemy within 2 hexes",
    "Fights: Roar of Thunder's stun can be resisted, and Beacon Aura gives +2 to hit instead of advantage",
    "Tidewall Warden: the Foghorn Axe's guard is now Against the Waves, with more shield when you stand in water",
    "Tidewall Warden: the big shield is now called Endure, and it also halves damage until your next turn",
  ],
  // game-v2026.11.20.3 (#565). Its first line named the five emotes there were then; the dab, the floss and the
  // running man came in the releases after it, so it names all eight.
  "0dc40f5dfbcbea567cb8cb22341e778ef0fec229": [
    "Emotes: wave, cheer, bow, dab, floss, dance, the running man or breakdance from the new emote wheel beside the chat, or hold G",
    "Emotes: type /wave, /cheer, /bow, /dance or /breakdance into chat",
    "Fights: emote from the button beside the hotbar, for free, without using your turn",
  ],
  // The release after game-v2026.11.19.5 (#549). Its third line said heroes on the same initiative share a turn; #552,
  // in the same release, made every turn one fighter's alone (ties are rolled off), and says so in a line of its own.
  "0d5340a7130da6fdec451d59a7f96d9d239eb1ec": [
    "Fights: your turn ends by itself once you've spent your last AP and walked any movement it bought",
    "Fights: your AP fill up again when your next turn starts on screen, not while the enemy is still moving",
  ],
  // game-v2026.11.19 (#526). Its coat line said the same as #529's, which went further; one line on coats is enough.
  "59c43c51d25a1c6f084578d54f804ef4b55590dc": [
    "Heroes: starting clothes are your class's own outfit again, not a knit cap and navy tunic",
    "Class cards: the Warden, Paladin and Druid hold the weapon they start with",
  ],
  // game-v2026.11.18.6 (#511). The Mage's tricorn look was replaced by the storm witch (#519) and the staff's gem by
  // a driftwood one, so only what is still true is left.
  "9d724350364957ae5e21177e418d3411d0421efb": ["Sashes: the long ends of a sash swing as you walk"],
  // game-v2026.11.18.6 (#517). The glow in the eyes now comes only with a spell (#519).
  "d074ea89f669e00e421d1c73633021aaa61cd189": [
    "Wreck Warlock: a drowned captain in a tricorn, with a scarf over the face",
    "Wreck Warlock: the grimoire glows purple",
  ],
  // game-v2026.11.18.6 (#519). One line named two classes, so it showed with no area.
  "3758b7fd75a869c4da5874b5acfeb734b8c4625f": [
    "Stormcall Mage: a hooded storm witch with a barnacled driftwood staff",
    "Starchart Sage: the ship's navigator, in a tricorn and gold epaulettes, with an armillary sphere",
    "Shanty Bard: a red bandana, a vest over a linen shirt and a red sash",
    "Smuggler Rogue: a headband, a long dark coat, and straps and pouches",
    "Stormcall Mage: eyes light up while casting a spell",
    "Wreck Warlock: eyes light up while casting a spell",
    "Fights: casting from a book is slower and more deliberate",
    "Fights: a staff is swung out to the side when casting, clear of the head",
  ],
  // game-v2026.11.13.5 (#368)
  "2300bc847429c6de0e4bf348de67e8bf55f829b2": ["Sign-in: send http visits to https so returning players can sign in"],
  // game-v2026.11.15.2 (#419)
  "a75dff4189c1bef9666dcc0c09affe79e3ad6f96": [
    "Heroes: choose how your hero looks: build, head, ears, hair, eyes, nose, mustache, beard, skin and hair colour",
    "Heroes: draw your own tattoos on a paper doll, in greys and muted colours",
    "Heroes: existing heroes get a look from their class; change it any time with Change look on your hero sheet",
    "Heroes: starting hat, tunic, trousers and shoes are items you can take off",
  ],
  // game-v2026.11.18 (#500). Left off the board by a "Release-note: skip" on three commits inside the squash.
  "c15abb8e37d3838186b85b7b9fe80ff44678ce7d": [
    "Atlas: a world for your crew to explore, opened from the lighthouse; clear a place to open the ones beyond it",
    "Atlas: places differ by climate and by kind (landfalls, sea caves, lookouts and lairs), and clearing one pays everyone there a bounty",
    "Lodestones: found in bounties and kept in your pack; put one into a far-off place's slot to set out, and what it carries makes that map harder or richer",
    "Stonecutter's bench: beside the smithy, cut a plain lodestone, or fuse, attune, temper and reroll the ones you carry",
    "Town chest: a chest in the town square that the whole crew shares, with tabs you can buy, name, colour and reorder",
    "Harbor: a bigger town square with the notice board and the town chest at its head; one hut plot has moved up the lane to the caverns",
    "Harbor: click the notice board, town chest, stonecutter's bench or market stall to walk up and open it",
  ],
  // game-v2026.11.18 (#494). Left off the board by a "Release-note: skip" on one commit inside the squash.
  "1c738e6bd932583bec48e4feb8f245826e48944f": [
    "Abilities: every class has abilities of its own; choose three on the Skills page of your logbook, in the Harbor, on top of what your weapon gives",
    "Abilities: every weapon gives two abilities of its own, in place of the old ones",
    "Classes: the Paladin is now the Lighthouse Paladin and the Warden the Tidewall Warden",
    "Warden: the Boarding Pike replaces the Lamp Hook, and the Bell-Buoy Maul is the starting weapon",
    "Fights: the ability bar holds ten a row (keys 1 to 9 and 0, the bottom row with Shift), and a cooldown shows as a big number on its slot",
    "Fights: a shield shows as a pale stretch on health bars, and an aura shows its reach as a dashed outline",
    "Fights: the ring and sparks from a landing spell or flask no longer stay frozen on the ground",
  ],
};

// Summaries for releases: the short seafaring paragraph shown above a
// release's lines. Keyed by tag, or, for a release not tagged yet, by the full
// hash of its newest commit on main (it still applies once the tag is cut, and
// "Coming next" shows it before then). A summary here replaces the one the
// release's Release-summary: trailers would make, so it also mends one that
// reads badly. How to write one is in AGENTS.md ("Release notes").
export const SUMMARIES: Record<string, string> = {
  // The release after game-v2026.11.27.2: the pub's top bar (#653), the wooden menus (#654) and these summaries (#656).
  "e194c45fc8cc817390b466ffa227d15f4527c7a8":
    "The menus have had a refit in fine new timber, with Sound, Graphics, Interface and Keys pages, and the crew chat can be hauled anywhere by its title. The pub hangs its name and Leave in a bar along the top, and on a phone the camera buttons fold away and your party shows as round portraits. Every notice on this board now opens with a word from the harbormaster.",
  "game-v2026.11.27.2":
    "The hut's had a refit: Decorate, the lamp and Leave hang from a bar along the top, with Craft and Storage stowed beneath it. Escape now shuts a panel without hauling up the game menu besides.",
  "game-v2026.11.27":
    "All hands! Every enemy has been rebuilt from keel to masthead, with new abilities and new ways to move. Effects stack up and clear when a fight is done, hold Alt over anyone to read what ails them, and battle rings truer to the ear.",
  "game-v2026.11.26": "Hail your crew from the combat log, even with steel drawn, and watch their words float over their heads on the maps.",
  "game-v2026.11.25.9": "The warlock has stowed the scarf, so beards and the like show plain on deck.",
  "game-v2026.11.25.8":
    "Googly eyes roll with the swell as you walk, any hero in your party can take a new name and face from the hero sheet, and the level circle on a name plate grows as you draw in close.",
  "game-v2026.11.25.7":
    "Aim lines and cones whichever way the wind blows, shields hold for the whole fight, and a missed Chain Lightning stops dead. Make a new hero right from the party picker, march your group across the maps together, and find the bottom bar trimmed in the same timber as the shops.",
  "game-v2026.11.25.6":
    "Twenty-six new hats, tops, breeches and boots have come ashore, some with powers of their own, and every piece of armor looks like its name. Any hero in your party may take the party's boat, and the townsfolk will answer your questions and gossip about the crew.",
  "game-v2026.11.25.5": "The Your catch panel in your sea bag shuts tight again.",
  "game-v2026.11.25.4": "In a fight the camera keeps a lookout's eye on whoever's turn it is, and pulls back to frame a long shot.",
  "game-v2026.11.25.3": "The wizard beard fits every head now, sideburns and all, and there's a plain mustache for the clean-cut sailor.",
  "game-v2026.11.25.2": "More ways to shape your hero's face and body, and beards stay fast to the jaw instead of drifting off.",
  "game-v2026.11.25":
    "A great haul! Sail with a party of up to four of your own heroes, keep several heroes and worlds on one account, and each world has a hut of its own. Enemies think for themselves, run for the alarm bell to raise the rest, and grow to match a crew of up to six on a map.",
  "game-v2026.11.24.4": "A new main menu greets you at the gangplank, with password logins and a hero maker in three steps.",
  "game-v2026.11.24.3":
    "Spot a crewmate's portrait over the building they've ducked into, see your flotsam float up overhead, tell acid from poison at a glance, and sit yourself down on the deck until you walk off.",
};
