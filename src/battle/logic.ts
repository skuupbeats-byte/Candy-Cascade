/**
 * Battle mode rules: pure logic, no DOM. The slot engine is untouched; a
 * battle only turns each spin's win into points.
 *
 * A turn: the player's spins run one after the other, then the player decides
 * what to do with the points: attack one or several players (each target drinks
 * as many parts as the player pays for, no upper limit), buy a shield of any
 * size (it absorbs the next parts of beer aimed at them), or do nothing.
 * There are no hit points and no end: the game goes on until someone stops it.
 */

export interface Weapon {
  id: string;
  name: string;
  /** Points to use it. */
  cost: number;
  /** Parts of the target's beer (out of `beerParts`) it makes them drink. */
  parts: number;
}

export interface Shield {
  id: string;
  name: string;
  /** Points to buy it. Always more than the attack of the same size. */
  cost: number;
  /** Parts of beer it absorbs before it breaks. */
  absorb: number;
}

export const BATTLE = {
  /** Parts in one glass when nothing else is chosen. */
  beerParts: 5,
  /** Smallest and biggest glass a game can use, in parts. */
  minGlass: 1,
  maxGlass: 20,
  defaultSpins: 5,
  /** Choices for the number of spins played in a row at each turn. */
  spinChoices: [3, 5, 8, 10],
  minPlayers: 2,
  maxPlayers: 6,
  /** Points earned per 1x of bet won. A 0.25x win gives 3 points. */
  pointsPerBet: 10,
  /**
   * Price of a bought free spins round, in points. A bought round pays back about
   * what it costs (100 bets on average, like the classic mode's 100x), but with big swings.
   */
  freeSpinsCost: 1000,
} as const;

/** One attack per beer part: the bigger the attack, the more the target drinks. */
export const WEAPONS: readonly Weapon[] = [
  { id: 'pichenette', name: 'Pichenette', cost: 10, parts: 1 },
  { id: 'decapsuleur', name: 'Décapsuleur', cost: 25, parts: 2 },
  { id: 'bouchon', name: 'Bouchon canon', cost: 45, parts: 3 },
  { id: 'fut', name: 'Coup de fût', cost: 70, parts: 4 },
  { id: 'tsunami', name: 'Tsunami de houblon', cost: 100, parts: 5 },
];

/** Shields cost more than the attack that matches them, so defending is harder than attacking. */
export const SHIELDS: readonly Shield[] = [
  { id: 'couvercle', name: 'Couvercle', cost: 15, absorb: 1 },
  { id: 'sous-bock', name: 'Sous-bock', cost: 35, absorb: 2 },
  { id: 'bouclier-bois', name: 'Bouclier en bois', cost: 60, absorb: 3 },
  { id: 'bouclier-fut', name: 'Bouclier de fût', cost: 90, absorb: 4 },
  { id: 'forteresse', name: 'Forteresse de houblon', cost: 130, absorb: 5 },
];

/** Past one full beer (5 parts) every extra part costs this much, for attacks and for shields. */
const EXTRA_ATTACK_PART = 20;
const EXTRA_SHIELD_PART = 26;

/**
 * A price read off a table that is worth one point per "beer part": a beer glass has 5 parts, so
 * one part of a beer is `1`, a whole shot (1 part in a 1-part glass) is `5`, one part of a
 * 10-part cocktail is `0.5`. Between the table's lines the price is a straight line, so a whole
 * glass costs the same whatever the drink, and a shot costs more than a sip of beer.
 */
function priced(equivalent: number, table: readonly number[], extra: number): number {
  const top = table.length; // equivalent of one full 5-part glass
  if (equivalent >= top) return Math.ceil(table[top - 1] + (equivalent - top) * extra);
  const low = Math.floor(equivalent);
  const from = low === 0 ? 0 : table[low - 1];
  return Math.ceil(from + (table[low] - from) * (equivalent - low));
}

const equivalentOf = (parts: number, glass: number): number => (parts * BATTLE.beerParts) / glass;

function checkSize(parts: number, glass: number, what: string): void {
  if (!Number.isInteger(parts) || parts < 1) throw new Error(`${what} is worth at least 1 part`);
  if (!Number.isInteger(glass) || glass < BATTLE.minGlass || glass > BATTLE.maxGlass) throw new Error('Bad glass size');
}

/**
 * Points to make someone drink `parts` parts of a `glass`-part glass. Cheap for a sip of a big
 * glass, dearer for a whole shot; a full glass costs the same for every drink.
 */
export function attackCost(parts: number, glass: number = BATTLE.beerParts): number {
  checkSize(parts, glass, 'An attack');
  return priced(equivalentOf(parts, glass), WEAPONS.map((w) => w.cost), EXTRA_ATTACK_PART);
}

/** Points for a shield that absorbs `parts` parts of a `glass`-part glass. Always more than the attack of the same size. */
export function shieldCost(parts: number, glass: number = BATTLE.beerParts): number {
  checkSize(parts, glass, 'A shield');
  return priced(equivalentOf(parts, glass), SHIELDS.map((x) => x.cost), EXTRA_SHIELD_PART);
}

/** Name of an attack of `n` parts: the five classics, then bigger and bigger ones. */
export function attackName(n: number): string {
  if (n <= WEAPONS.length) return WEAPONS[n - 1].name;
  return `Déluge de ${n} parts`;
}

export function shieldName(n: number): string {
  if (n <= SHIELDS.length) return SHIELDS[n - 1].name;
  return `Forteresse renforcée (${n} parts)`;
}

/** The most parts `points` can buy at the given price curve. */
function maxParts(points: number, cost: (n: number) => number): number {
  let n = 0;
  while (cost(n + 1) <= points) n++;
  return n;
}
export const maxAttackParts = (points: number, glass: number = BATTLE.beerParts) => maxParts(points, (n) => attackCost(n, glass));
export const maxShieldParts = (points: number, glass: number = BATTLE.beerParts) => maxParts(points, (n) => shieldCost(n, glass));

/** A kind of drink and how many parts one glass of it holds. */
export interface Drink {
  id: string;
  name: string;
  icon: string;
  /** Parts in one glass. A "part" is the unit attacks are counted in. */
  parts: number;
}

/** The usual drinks. Their sizes can be changed when a game is set up. */
export const DRINKS: readonly Drink[] = [
  { id: 'biere', name: 'Bière', icon: '🍺', parts: 5 },
  { id: 'cocktail', name: 'Cocktail', icon: '🍹', parts: 10 },
  { id: 'shot', name: 'Shot', icon: '🥃', parts: 1 },
];

export type Phase = 'spins' | 'actions';

export interface Player {
  id: number;
  name: string;
  /** The drink this player plays with. */
  drinkName: string;
  icon: string;
  /** Parts in one of their glasses. */
  glass: number;
  /** Parts left in the glass being drunk, from `glass` down to 1. A finished glass is replaced at once. */
  beer: number;
  /** Every part of beer drunk since the start. */
  partsDrunk: number;
  /** Whole beers finished. */
  beersFinished: number;
  /** Attacks made. */
  hits: number;
  /** Parts of beer other players actually had to drink because of this player. */
  partsDealt: number;
  /** Parts of beer this player's shields have absorbed. */
  partsBlocked: number;
  /** Parts this player got out of drinking by winning the wheel. */
  partsSaved: number;
  /** Parts the current shield can still absorb. It loses one part at the end of every turn. */
  shield: number;
  points: number;
}

export interface Battle {
  players: Player[];
  /** Index of the player whose turn it is. */
  current: number;
  phase: Phase;
  /** 1-based number of the round (everyone plays once per round). */
  round: number;
  spinsPerTurn: number;
}

export interface AttackResult {
  attacker: Player;
  target: Player;
  /** What the attack is called. */
  name: string;
  /** Parts the attack was worth. */
  parts: number;
  /** Parts the target's shield took. */
  absorbed: number;
  /** Parts the target has to drink. */
  drunk: number;
  /** Parts left in the target's beer before the hit. */
  beerBefore: number;
  /** Parts drunk from the beer they had. */
  fromCurrent: number;
  /** Parts drunk after the first beer is finished: from fresh beers, whole ones first. */
  fromNext: number;
  /** Beers the target finishes with this hit. */
  finished: number;
  /** The wheel, if the target tried it. */
  dodge: DodgeOutcome | null;
}

/** An attack that has paid its points and met the shield, but nobody has drunk yet: the target may still try the wheel. */
export interface PendingHit {
  attacker: Player;
  target: Player;
  name: string;
  parts: number;
  absorbed: number;
  /** Parts left to drink once the shield took its share. */
  incoming: number;
}

export interface DodgeOutcome {
  /** Parts the target tried to get out of. */
  parts: number;
  success: boolean;
  chance: number;
  /** What a failure multiplies the incoming parts by. */
  multiplier: number;
}

/**
 * Chance (0 to 1) to win the wheel when trying to get out of `k` parts of a `glass`-part glass.
 * It depends on the share of the glass: a fifth of it is 80%, all of it 20%, never under 5%.
 */
export function dodgeChance(k: number, glass: number = BATTLE.beerParts): number {
  checkSize(k, glass, 'A dodge');
  return Math.max(0.05, Math.round((0.95 - 0.75 * (k / glass)) * 1e4) / 1e4);
}

/** What a lost wheel multiplies the incoming parts by: always the same, whatever was tried. Only the odds change with the size. */
export const FAIL_MULTIPLIER = 2;

export function dodgeMultiplier(k: number, glass: number = BATTLE.beerParts): number {
  checkSize(k, glass, 'A dodge');
  return FAIL_MULTIPLIER;
}

/** Parts the target drinks if the wheel is lost. */
export function failedDrink(incoming: number, k: number, glass: number = BATTLE.beerParts): number {
  return Math.ceil(incoming * dodgeMultiplier(k, glass) - 1e-9);
}

export function pointsFor(totalWin: number): number {
  return Math.round(totalWin * BATTLE.pointsPerBet);
}

/** Glasses drunk as a number, counting parts as fractions of a glass: 11 parts of a 5-part glass is 2.2. */
export function beersDrunk(p: Player): number {
  return p.partsDrunk / p.glass;
}

export function createBattle(names: readonly string[], spinsPerTurn: number, drinks: readonly Drink[] = []): Battle {
  if (names.length < BATTLE.minPlayers || names.length > BATTLE.maxPlayers) {
    throw new Error(`A battle needs ${BATTLE.minPlayers} to ${BATTLE.maxPlayers} players`);
  }
  if (!Number.isInteger(spinsPerTurn) || spinsPerTurn < 1) throw new Error('spinsPerTurn must be a positive whole number');
  return {
    players: names.map((raw, id) => {
      const drink = drinks[id] ?? DRINKS[0];
      if (!Number.isInteger(drink.parts) || drink.parts < BATTLE.minGlass || drink.parts > BATTLE.maxGlass) {
        throw new Error(`A glass holds ${BATTLE.minGlass} to ${BATTLE.maxGlass} parts`);
      }
      return {
      id,
      name: raw.trim() || `Joueur ${id + 1}`,
      drinkName: drink.name,
      icon: drink.icon,
      glass: drink.parts,
      beer: drink.parts,
      partsDrunk: 0,
      beersFinished: 0,
      hits: 0,
      partsDealt: 0,
      partsBlocked: 0,
      partsSaved: 0,
      shield: 0,
      points: 0,
    };
    }),
    current: 0,
    phase: 'spins',
    round: 1,
    spinsPerTurn,
  };
}

/**
 * A player swaps their drink in the middle of the game. They start the new glass full; what they already drank,
 * their points and their shield stay as they are.
 */
export function changeDrink(b: Battle, playerId: number, drink: Drink): void {
  const p = b.players[playerId];
  if (!p) throw new Error('Unknown player');
  if (!Number.isInteger(drink.parts) || drink.parts < BATTLE.minGlass || drink.parts > BATTLE.maxGlass) {
    throw new Error(`A glass holds ${BATTLE.minGlass} to ${BATTLE.maxGlass} parts`);
  }
  p.drinkName = drink.name;
  p.icon = drink.icon;
  p.glass = drink.parts;
  p.beer = drink.parts;
}

export function activePlayer(b: Battle): Player {
  return b.players[b.current];
}

/** The current player's spins are done: add the points of every spin and open the actions step. Returns the points won. */
export function recordSpins(b: Battle, totalWins: readonly number[]): number {
  if (b.phase !== 'spins') throw new Error('Not the spins phase');
  const points = totalWins.reduce((sum, win) => sum + pointsFor(win), 0);
  activePlayer(b).points += points;
  b.phase = 'actions';
  return points;
}

export function targets(b: Battle): Player[] {
  const me = activePlayer(b);
  return b.players.filter((p) => p.id !== me.id);
}

export function canAttack(b: Battle): boolean {
  return b.phase === 'actions' && targets(b).some((t) => activePlayer(b).points >= attackCost(1, t.glass));
}

export function canDefend(b: Battle): boolean {
  const me = activePlayer(b);
  return b.phase === 'actions' && me.points >= shieldCost(1, me.glass);
}

/**
 * Make a player drink `parts`. The parts come out of the beer they have; if
 * that runs out they finish it and the rest comes out of fresh beers.
 */
export function drink(p: Player, parts: number): { fromCurrent: number; fromNext: number; finished: number } {
  const fromCurrent = Math.min(parts, p.beer);
  const fromNext = parts - fromCurrent;
  let finished = 0;
  p.partsDrunk += parts;
  p.beer -= fromCurrent;
  if (fromCurrent > 0 && p.beer === 0) {
    finished += 1;
    p.beer = p.glass;
  }
  if (fromNext > 0) {
    finished += Math.floor(fromNext / p.glass);
    p.beer -= fromNext % p.glass;
  }
  p.beersFinished += finished;
  return { fromCurrent, fromNext, finished };
}

export interface Allocation {
  targetId: number;
  parts: number;
}

/** One attack, drunk at once (no wheel). */
export function attack(b: Battle, targetId: number, parts: number): AttackResult {
  return resolveHit(attackMany(b, [{ targetId, parts }])[0], null);
}

/**
 * Attack several players in one go, each for its own number of parts. Every
 * attack is priced on its own; the whole thing is refused if the total is more
 * than the points, so nothing is half done. The shield is applied now; the
 * drinking waits for `resolveHit`, so each target can try the wheel first.
 */
export function attackMany(b: Battle, plan: readonly Allocation[]): PendingHit[] {
  if (b.phase !== 'actions') throw new Error('Not the actions phase');
  if (plan.length === 0) throw new Error('Nobody to attack');
  const attacker = activePlayer(b);
  const seen = new Set<number>();
  let total = 0;
  for (const { targetId, parts } of plan) {
    const target = b.players.find((p) => p.id === targetId);
    if (!target || target.id === attacker.id || seen.has(targetId)) throw new Error('Invalid target');
    seen.add(targetId);
    total += attackCost(parts, target.glass);
  }
  if (attacker.points < total) throw new Error('Not enough points');

  return plan.map(({ targetId, parts }) => {
    const target = b.players.find((p) => p.id === targetId) as Player;
    attacker.points -= attackCost(parts, target.glass);
    attacker.hits += 1;
    const absorbed = Math.min(parts, target.shield);
    target.shield -= absorbed;
    target.partsBlocked += absorbed;
    return { attacker, target, name: attackName(parts), parts, absorbed, incoming: parts - absorbed };
  });
}

/**
 * The target drinks. `dodge` is null when they just drink. When they tried the
 * wheel: a win takes `dodge.parts` off the incoming parts, a loss multiplies them.
 */
export function resolveHit(hit: PendingHit, dodge: { parts: number; success: boolean } | null): AttackResult {
  const { attacker, target, incoming } = hit;
  let outcome: DodgeOutcome | null = null;
  let drunk = incoming;
  if (dodge) {
    if (dodge.parts < 1 || dodge.parts > incoming) throw new Error('Cannot dodge that many parts');
    outcome = { parts: dodge.parts, success: dodge.success, chance: dodgeChance(dodge.parts, target.glass), multiplier: dodgeMultiplier(dodge.parts, target.glass) };
    drunk = dodge.success ? incoming - dodge.parts : failedDrink(incoming, dodge.parts, target.glass);
    if (dodge.success) target.partsSaved += dodge.parts;
  }
  attacker.partsDealt += drunk;
  const beerBefore = target.beer;
  const { fromCurrent, fromNext, finished } = drink(target, drunk);
  return {
    attacker,
    target,
    name: hit.name,
    parts: hit.parts,
    absorbed: hit.absorbed,
    drunk,
    beerBefore,
    fromCurrent,
    fromNext,
    finished,
    dodge: outcome,
  };
}

/** Buy a shield that absorbs `parts` parts. It adds to the one you already have. */
export function buyShield(b: Battle, parts: number): number {
  if (b.phase !== 'actions') throw new Error('Not the actions phase');
  const me = activePlayer(b);
  const cost = shieldCost(parts, me.glass);
  if (me.points < cost) throw new Error('Not enough points');
  me.points -= cost;
  me.shield += parts;
  return cost;
}

export function canBuyFreeSpins(b: Battle): boolean {
  return b.phase === 'actions' && activePlayer(b).points >= BATTLE.freeSpinsCost;
}

/** Pay for a free spins round. The caller plays it and then hands the win to `addWinnings`. */
export function payFreeSpins(b: Battle): void {
  if (!canBuyFreeSpins(b)) throw new Error('Cannot buy free spins now');
  activePlayer(b).points -= BATTLE.freeSpinsCost;
}

/** Turn the win of a bought round into points for the current player. Returns the points won. */
export function addWinnings(b: Battle, totalWin: number): number {
  const points = pointsFor(totalWin);
  activePlayer(b).points += points;
  return points;
}

/** Pass to the next player. At the end of every turn, every player's shield wears down by one part. */
export function endTurn(b: Battle): void {
  if (b.phase !== 'actions') throw new Error('Not the actions phase');
  b.current = (b.current + 1) % b.players.length;
  if (b.current === 0) b.round += 1;
  for (const p of b.players) p.shield = Math.max(0, p.shield - 1);
  b.phase = 'spins';
}

/** Players ranked by who drank the most, then by who hit the most. */
export function standings(b: Battle): Player[] {
  return [...b.players].sort((a, c) => c.partsDrunk - a.partsDrunk || c.hits - a.hits || a.id - c.id);
}

export interface Awards {
  /** Most attacks made, or null if nobody attacked. */
  sharpest: Player | null;
  /** Most beer drunk, or null if nobody drank. */
  thirstiest: Player | null;
}

export function awards(b: Battle): Awards {
  const sharpest = [...b.players].sort((a, c) => c.hits - a.hits || c.partsDealt - a.partsDealt || a.id - c.id)[0];
  const thirstiest = standings(b)[0];
  return {
    sharpest: sharpest.hits > 0 ? sharpest : null,
    thirstiest: thirstiest.partsDrunk > 0 ? thirstiest : null,
  };
}
