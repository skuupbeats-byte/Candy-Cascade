import { describe, expect, it } from 'vitest';
import {
  BATTLE,
  activePlayer,
  attack,
  attackCost,
  attackMany,
  attackName,
  awards,
  beersDrunk,
  buyShield,
  canAttack,
  canDefend,
  DRINKS,
  changeDrink,
  createBattle,
  dodgeChance,
  dodgeMultiplier,
  drink,
  failedDrink,
  endTurn,
  maxAttackParts,
  maxShieldParts,
  pointsFor,
  recordSpins,
  resolveHit,
  shieldCost,
  standings,
  targets,
} from '../src/battle/logic';

const make = (n = 3, spins = 5) => createBattle(Array.from({ length: n }, (_, i) => `P${i + 1}`), spins);
const withPoints = (n = 3, points = 500) => {
  const b = make(n);
  recordSpins(b, [points / BATTLE.pointsPerBet]);
  return b;
};

describe('setup', () => {
  it('everyone starts with a full beer and nothing drunk', () => {
    const b = make();
    expect(b.players.every((p) => p.beer === 5 && p.partsDrunk === 0 && p.hits === 0 && p.shield === 0 && p.points === 0)).toBe(true);
    expect(b.phase).toBe('spins');
    expect(b.spinsPerTurn).toBe(5);
  });
  it('names empty players and rejects bad sizes', () => {
    expect(createBattle(['', 'Léa'], 3).players[0].name).toBe('Joueur 1');
    expect(() => createBattle(['solo'], 3)).toThrow();
    expect(() => createBattle(Array(7).fill('x'), 3)).toThrow();
    expect(() => createBattle(['a', 'b'], 0)).toThrow();
  });
  it('turns wins into points', () => {
    expect(pointsFor(0)).toBe(0);
    expect(pointsFor(0.25)).toBe(3);
    expect(pointsFor(12.5)).toBe(125);
  });
});

describe('drinking', () => {
  it('drinks from the current beer', () => {
    const b = make();
    const p = b.players[0];
    expect(drink(p, 2)).toEqual({ fromCurrent: 2, fromNext: 0, finished: 0 });
    expect(p.beer).toBe(3);
    expect(p.partsDrunk).toBe(2);
  });

  it('finishing the beer exactly gives a fresh one', () => {
    const p = make().players[0];
    p.beer = 3;
    expect(drink(p, 3)).toEqual({ fromCurrent: 3, fromNext: 0, finished: 1 });
    expect(p.beer).toBe(5);
    expect(p.beersFinished).toBe(1);
  });

  it('carries the rest into the next beer: 3 parts with 1 left means finish it plus 2 of the next', () => {
    const p = make().players[0];
    p.beer = 1;
    expect(drink(p, 3)).toEqual({ fromCurrent: 1, fromNext: 2, finished: 1 });
    expect(p.beer).toBe(3);
    expect(p.beersFinished).toBe(1);
    expect(p.partsDrunk).toBe(3);
  });

  it('a big drink finishes whole beers: 13 parts with 2 left is 3 beers and 3 parts of the fourth', () => {
    const p = make().players[0];
    p.beer = 2;
    expect(drink(p, 13)).toEqual({ fromCurrent: 2, fromNext: 11, finished: 3 });
    expect(p.beer).toBe(4);
    expect(p.partsDrunk).toBe(13);
    expect(p.beersFinished).toBe(3);
  });

  it('a drink of exactly whole beers leaves a fresh one', () => {
    const p = make().players[0];
    expect(drink(p, 10)).toEqual({ fromCurrent: 5, fromNext: 5, finished: 2 });
    expect(p.beer).toBe(5);
  });

  it('counts beers as fifths', () => {
    const p = make().players[0];
    drink(p, 5);
    drink(p, 5);
    drink(p, 1);
    expect(beersDrunk(p)).toBeCloseTo(2.2);
    expect(p.beersFinished).toBe(2);
  });
});

describe('a turn', () => {
  it('spins give points, then the actions step, then the next player', () => {
    const b = make();
    expect(recordSpins(b, [0.5, 0, 3, 0.25, 0])).toBe(5 + 0 + 30 + 3 + 0);
    expect(activePlayer(b).points).toBe(38);
    expect(b.phase).toBe('actions');
    expect(() => recordSpins(b, [1])).toThrow();
    endTurn(b);
    expect(activePlayer(b).name).toBe('P2');
    expect(b.phase).toBe('spins');
    expect(() => endTurn(b)).toThrow();
  });

  it('counts rounds', () => {
    const b = make(2);
    for (let i = 0; i < 4; i++) {
      recordSpins(b, [0]);
      endTurn(b);
    }
    expect(b.round).toBe(3);
    expect(activePlayer(b).name).toBe('P1');
  });
});

describe('attack prices', () => {
  it('follow the table up to a full beer, then 20 points per extra part', () => {
    expect([1, 2, 3, 4, 5].map((n) => attackCost(n))).toEqual([10, 25, 45, 70, 100]);
    expect(attackCost(6)).toBe(120);
    expect(attackCost(25)).toBe(500); // 500 points: five full beers
  });
  it('rejects nonsense sizes', () => {
    expect(() => attackCost(0)).toThrow();
    expect(() => attackCost(1.5)).toThrow();
    expect(() => shieldCost(0)).toThrow();
  });
  it('a shield always costs more than the attack of the same size', () => {
    for (let n = 1; n <= 40; n++) expect(shieldCost(n)).toBeGreaterThan(attackCost(n));
  });
  it('prices keep rising', () => {
    for (let n = 2; n <= 40; n++) {
      expect(attackCost(n)).toBeGreaterThan(attackCost(n - 1));
      expect(shieldCost(n)).toBeGreaterThan(shieldCost(n - 1));
    }
  });
  it('says how many parts the points can buy', () => {
    expect(maxAttackParts(9)).toBe(0);
    expect(maxAttackParts(10)).toBe(1);
    expect(maxAttackParts(44)).toBe(2);
    expect(maxAttackParts(500)).toBe(25);
    expect(maxShieldParts(14)).toBe(0);
    expect(maxShieldParts(130)).toBe(5);
    expect(maxShieldParts(156)).toBe(6);
  });
  it('names the classics and the bigger ones', () => {
    expect(attackName(3)).toBe('Bouchon canon');
    expect(attackName(10)).toBe('Déluge de 10 parts');
    expect(attackName(7)).toBe('Déluge de 7 parts');
  });
});

describe('attacks', () => {
  it('make the target drink and count a hit for the attacker', () => {
    const b = withPoints(3, 100);
    expect(canAttack(b)).toBe(true);
    const r = attack(b, 1, 3);
    expect(r.drunk).toBe(3);
    expect(r.name).toBe('Bouchon canon');
    expect(b.players[1].beer).toBe(2);
    expect(b.players[0].points).toBe(55);
    expect(b.players[0].hits).toBe(1);
    expect(b.players[0].partsDealt).toBe(3);
  });

  it('a 3-part attack on a player with 1 part left finishes it and starts the next beer', () => {
    const b = withPoints();
    b.players[1].beer = 1;
    const r = attack(b, 1, 3);
    expect(r).toMatchObject({ beerBefore: 1, fromCurrent: 1, fromNext: 2, finished: 1, drunk: 3 });
    expect(b.players[1].beer).toBe(3);
    expect(b.players[1].beersFinished).toBe(1);
  });

  it('can be bigger than one beer', () => {
    const b = withPoints(3, 500);
    const r = attack(b, 1, 25);
    expect(r).toMatchObject({ drunk: 25, finished: 5 });
    expect(b.players[0].points).toBe(0);
    expect(b.players[1].beer).toBe(5);
    expect(b.players[1].partsDrunk).toBe(25);
  });

  it('can hit several players at once, each for its own size', () => {
    const b = withPoints(4, 200);
    const results = attackMany(b, [
      { targetId: 1, parts: 5 },
      { targetId: 2, parts: 2 },
      { targetId: 3, parts: 1 },
    ]).map((h) => resolveHit(h, null));
    expect(results.map((r) => r.drunk)).toEqual([5, 2, 1]);
    expect(b.players[0].points).toBe(200 - 100 - 25 - 10);
    expect(b.players[0].hits).toBe(3);
    expect(b.players[0].partsDealt).toBe(8);
    expect(b.players[1].beersFinished).toBe(1);
    expect(b.players[2].beer).toBe(3);
  });

  it('are refused as a whole when the total is too much, with nothing changed', () => {
    const b = withPoints(3, 100);
    expect(() => attackMany(b, [{ targetId: 1, parts: 5 }, { targetId: 2, parts: 1 }])).toThrow(/points/);
    expect(b.players[0].points).toBe(100);
    expect(b.players[1].partsDrunk).toBe(0);
    expect(b.players[0].hits).toBe(0);
  });

  it('refuse bad targets and empty plans', () => {
    const b = withPoints(3, 500);
    expect(() => attack(b, 0, 1)).toThrow(); // yourself
    expect(() => attack(b, 9, 1)).toThrow();
    expect(() => attackMany(b, [{ targetId: 1, parts: 1 }, { targetId: 1, parts: 1 }])).toThrow(); // twice the same
    expect(() => attackMany(b, [])).toThrow();
    expect(targets(b).map((p) => p.id)).toEqual([1, 2]);
  });

  it('can be repeated while points last', () => {
    const b = withPoints(3, 30);
    attack(b, 2, 2);
    expect(b.players[0].points).toBe(5);
    expect(canAttack(b)).toBe(false);
    expect(() => attack(b, 1, 1)).toThrow();
  });

  it('are only possible after the spins', () => {
    expect(() => attack(make(), 1, 1)).toThrow();
  });
});

describe('prices follow the drink', () => {
  const [beer, cocktail, shot] = DRINKS;
  it('a whole glass costs the same whatever the drink', () => {
    expect(attackCost(5, 5)).toBe(100);
    expect(attackCost(10, 10)).toBe(100);
    expect(attackCost(1, 1)).toBe(100);
    expect(attackCost(20, 20)).toBe(100);
    expect(shieldCost(1, 1)).toBe(130);
  });
  it('a shot costs more than a sip of beer, a sip of cocktail costs less', () => {
    expect(attackCost(1, 1)).toBeGreaterThan(attackCost(1, 5));
    expect(attackCost(1, 5)).toBeGreaterThan(attackCost(1, 10));
    expect(attackCost(1, 10)).toBe(5);
  });
  it('more shots keep costing more', () => {
    expect(attackCost(2, 1)).toBe(200); // two whole glasses
    expect(attackCost(3, 1)).toBe(300);
  });
  it('shields stay dearer than attacks for any drink and size', () => {
    for (const glass of [1, 2, 5, 7, 10, 20]) {
      for (let n = 1; n <= 40; n++) expect(shieldCost(n, glass)).toBeGreaterThan(attackCost(n, glass));
    }
  });
  it('prices keep rising with the size, for any glass', () => {
    for (const glass of [1, 3, 5, 10, 20]) {
      for (let n = 2; n <= 40; n++) expect(attackCost(n, glass)).toBeGreaterThanOrEqual(attackCost(n - 1, glass));
    }
  });
  it('an attack is priced on the target\'s glass', () => {
    const b = createBattle(['A', 'B', 'C'], 5, [beer, cocktail, shot]);
    recordSpins(b, [30]); // 300 points
    const [onShot, onCocktail] = attackMany(b, [{ targetId: 2, parts: 1 }, { targetId: 1, parts: 2 }]);
    expect(onShot.target.name).toBe('C');
    expect(b.players[0].points).toBe(300 - 100 - attackCost(2, 10));
    expect(onCocktail.incoming).toBe(2);
  });
  it('a shield is priced on its owner\'s glass', () => {
    const b = createBattle(['A', 'B'], 5, [shot, beer]);
    recordSpins(b, [30]);
    buyShield(b, 1);
    expect(b.players[0].points).toBe(300 - 130);
    expect(b.players[0].shield).toBe(1);
  });
  it('the wheel follows the share of the glass: a whole shot is as hard as five parts of a beer', () => {
    expect(dodgeChance(1, 1)).toBeCloseTo(0.2);
    expect(dodgeChance(1, 10)).toBeCloseTo(0.875);
    expect(dodgeChance(5, 10)).toBeCloseTo(0.575);
    expect(dodgeMultiplier(1, 1)).toBe(2);
    expect(dodgeMultiplier(1, 10)).toBe(2);
    expect(failedDrink(2, 1, 1)).toBe(4);
  });
});

describe('the wheel', () => {
  it('odds: 80% for one part, 20% for five, never under 5%', () => {
    expect([1, 2, 3, 4, 5].map((k) => Math.round(dodgeChance(k) * 100))).toEqual([80, 65, 50, 35, 20]);
    expect(dodgeChance(6)).toBeCloseTo(0.05);
    expect(dodgeChance(40)).toBeCloseTo(0.05);
    expect(() => dodgeChance(0)).toThrow();
  });
  it('a lost wheel is always x2, whatever you tried to dodge', () => {
    for (const k of [1, 2, 3, 4, 5, 30]) expect(dodgeMultiplier(k)).toBe(2);
    expect(failedDrink(5, 1)).toBe(10);
    expect(failedDrink(5, 5)).toBe(10);
    expect(failedDrink(3, 2)).toBe(6);
  });
  it('an attack waits for its target: points are paid and the shield used, nobody has drunk', () => {
    const b = withPoints(3, 200);
    b.players[1].shield = 2;
    const [hit] = attackMany(b, [{ targetId: 1, parts: 5 }]);
    expect(hit).toMatchObject({ parts: 5, absorbed: 2, incoming: 3 });
    expect(b.players[0].points).toBe(100);
    expect(b.players[0].hits).toBe(1);
    expect(b.players[1].partsDrunk).toBe(0);
    expect(b.players[1].shield).toBe(0);
  });
  it('winning takes the dodged parts off', () => {
    const b = withPoints(3, 200);
    const [hit] = attackMany(b, [{ targetId: 1, parts: 5 }]);
    const r = resolveHit(hit, { parts: 2, success: true });
    expect(r.drunk).toBe(3);
    expect(r.dodge).toMatchObject({ parts: 2, success: true, chance: 0.65, multiplier: 2 });
    expect(b.players[1].partsDrunk).toBe(3);
    expect(b.players[1].partsSaved).toBe(2);
    expect(b.players[0].partsDealt).toBe(3);
  });
  it('losing multiplies what is drunk', () => {
    const b = withPoints(3, 200);
    const [hit] = attackMany(b, [{ targetId: 1, parts: 5 }]);
    const r = resolveHit(hit, { parts: 5, success: false });
    expect(r.drunk).toBe(10);
    expect(r.finished).toBe(2);
    expect(b.players[1].partsSaved).toBe(0);
    expect(b.players[0].partsDealt).toBe(10);
  });
  it('trying to dodge more than is incoming is refused', () => {
    const b = withPoints(3, 200);
    const [hit] = attackMany(b, [{ targetId: 1, parts: 2 }]);
    expect(() => resolveHit(hit, { parts: 3, success: true })).toThrow();
    expect(() => resolveHit(hit, { parts: 0, success: true })).toThrow();
  });
});

describe('shields', () => {
  it('buying one costs points and adds to your shield', () => {
    const b = withPoints(3, 100);
    expect(canDefend(b)).toBe(true);
    buyShield(b, 2);
    expect(activePlayer(b).points).toBe(65);
    expect(activePlayer(b).shield).toBe(2);
    buyShield(b, 1);
    expect(activePlayer(b).shield).toBe(3);
    expect(() => buyShield(b, 5)).toThrow();
  });

  it('can be bigger than one beer', () => {
    const b = withPoints(3, 500);
    buyShield(b, 12);
    expect(activePlayer(b).shield).toBe(12);
    expect(activePlayer(b).points).toBe(500 - shieldCost(12));
  });

  it('absorbs part of an attack and only the rest is drunk', () => {
    const b = withPoints(3, 200);
    b.players[1].shield = 2;
    const r = attack(b, 1, 3);
    expect(r).toMatchObject({ parts: 3, absorbed: 2, drunk: 1 });
    expect(b.players[1].shield).toBe(0);
    expect(b.players[1].beer).toBe(4);
    expect(b.players[1].partsBlocked).toBe(2);
    expect(b.players[0].partsDealt).toBe(1);
    expect(b.players[0].hits).toBe(1);
  });

  it('blocks a small attack completely and keeps what is left', () => {
    const b = withPoints(3, 200);
    b.players[1].shield = 3;
    const r = attack(b, 1, 2);
    expect(r.drunk).toBe(0);
    expect(r.absorbed).toBe(2);
    expect(b.players[1].shield).toBe(1);
    expect(b.players[1].beer).toBe(5);
  });

  it('wears down by one part for every player at the end of each turn', () => {
    const b = make(2);
    recordSpins(b, [20]);
    buyShield(b, 3);
    b.players[1].shield = 2;
    endTurn(b); // P1 ends
    expect(b.players.map((p) => p.shield)).toEqual([2, 1]);
    recordSpins(b, [0]);
    endTurn(b); // P2 ends
    expect(b.players.map((p) => p.shield)).toEqual([1, 0]);
    recordSpins(b, [0]);
    endTurn(b);
    expect(b.players[0].shield).toBe(0);
  });
});

describe('drinks', () => {
  it('the usual glasses: beer 5, cocktail 10, shot 1', () => {
    expect(DRINKS.map((d) => [d.id, d.parts])).toEqual([['biere', 5], ['cocktail', 10], ['shot', 1]]);
  });
  it('each player has their own glass', () => {
    const [beer, cocktail, shot] = DRINKS;
    const b = createBattle(['A', 'B', 'C'], 5, [beer, cocktail, shot]);
    expect(b.players.map((p) => [p.glass, p.beer, p.icon])).toEqual([[5, 5, '🍺'], [10, 10, '🍹'], [1, 1, '🥃']]);
  });
  it('defaults to the beer', () => {
    expect(make().players.every((p) => p.glass === 5 && p.drinkName === 'Bière')).toBe(true);
  });
  it('accepts a glass of any size from 1 to 20 and nothing else', () => {
    const custom = (parts: number) => createBattle(['A', 'B'], 3, [{ id: 'x', name: 'Pinte', icon: '🍻', parts }]);
    expect(custom(20).players[0].glass).toBe(20);
    expect(() => custom(0)).toThrow();
    expect(() => custom(21)).toThrow();
    expect(() => custom(2.5)).toThrow();
  });
  it('drinking follows the glass size: 7 parts is a shot glass seven times over', () => {
    const b = createBattle(['A', 'B'], 3, [DRINKS[0], DRINKS[2]]);
    expect(drink(b.players[1], 7)).toEqual({ fromCurrent: 1, fromNext: 6, finished: 7 });
    expect(b.players[1].beer).toBe(1);
    expect(beersDrunk(b.players[1])).toBe(7);
  });
  it('a cocktail holds ten parts', () => {
    const b = createBattle(['A', 'B'], 3, [DRINKS[0], DRINKS[1]]);
    const p = b.players[1];
    expect(drink(p, 13)).toEqual({ fromCurrent: 10, fromNext: 3, finished: 1 });
    expect(p.beer).toBe(7);
    expect(beersDrunk(p)).toBeCloseTo(1.3);
  });
});

describe('stats', () => {
  it('ranks by beer drunk, and names the sharpest and the thirstiest', () => {
    const b = make(3);
    b.players[0].hits = 4;
    b.players[0].partsDealt = 9;
    b.players[1].partsDrunk = 12;
    b.players[2].partsDrunk = 7;
    b.players[2].hits = 1;
    expect(standings(b).map((p) => p.name)).toEqual(['P2', 'P3', 'P1']);
    const a = awards(b);
    expect(a.sharpest?.name).toBe('P1');
    expect(a.thirstiest?.name).toBe('P2');
  });

  it('has no awards before anything happened', () => {
    expect(awards(make())).toEqual({ sharpest: null, thirstiest: null });
  });
});

describe('changeDrink', () => {
  it('gives a fresh glass of the new drink and keeps the rest', () => {
    const b = createBattle(['A', 'B'], 3);
    b.players[0].points = 40;
    b.players[0].partsDrunk = 7;
    b.players[0].beer = 2;
    changeDrink(b, 0, { id: 'shot', name: 'Shot', icon: '🥃', parts: 1 });
    expect(b.players[0]).toMatchObject({ drinkName: 'Shot', icon: '🥃', glass: 1, beer: 1, points: 40, partsDrunk: 7 });
    expect(() => changeDrink(b, 5, DRINKS[0])).toThrow();
  });
});
