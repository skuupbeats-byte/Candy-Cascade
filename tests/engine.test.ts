import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  bombMultiplier,
  collapse,
  findWins,
  roundCost,
  scatterPay,
  simulateRound,
  spin,
  symbolCodes,
  symbolPay,
  type GameConfig,
  type Mode,
  type RoundResult,
  type SpinResult,
} from '../src/engine';
import { gridWith, makeConfig, reel } from './helpers';

const { SCATTER, BOMB } = symbolCodes(CONFIG);
const id = (name: string) => CONFIG.symbols.findIndex((s) => s.id === name);

// The paytable from the brief, written out independently of config.ts.
const PAYTABLE: Record<string, [number, number, number]> = {
  red: [10, 25, 50],
  purple: [2.5, 10, 25],
  green: [2, 5, 15],
  blue: [1.5, 2, 12],
  apple: [1, 1.5, 10],
  plum: [0.8, 1.2, 8],
  watermelon: [0.5, 1, 5],
  grapes: [0.4, 0.9, 4],
  banana: [0.25, 0.75, 2],
};

describe('grid and paytable', () => {
  it('is a 6 x 5 grid with nine paying symbols', () => {
    expect(CONFIG.cols).toBe(6);
    expect(CONFIG.rows).toBe(5);
    expect(CONFIG.symbols.map((s) => s.id)).toEqual(Object.keys(PAYTABLE));
  });

  it('matches the paytable for every symbol and tier', () => {
    for (const [name, [low, mid, high]] of Object.entries(PAYTABLE)) {
      const s = id(name);
      expect(symbolPay(CONFIG, s, 8)).toBe(low);
      expect(symbolPay(CONFIG, s, 9)).toBe(low);
      expect(symbolPay(CONFIG, s, 10)).toBe(mid);
      expect(symbolPay(CONFIG, s, 11)).toBe(mid);
      expect(symbolPay(CONFIG, s, 12)).toBe(high);
      expect(symbolPay(CONFIG, s, 30)).toBe(high);
    }
  });
});

describe('win detection', () => {
  it('does not pay 7 of a kind', () => {
    for (let s = 0; s < CONFIG.symbols.length; s++) {
      expect(findWins(CONFIG, gridWith(s, 7))).toEqual([]);
      expect(symbolPay(CONFIG, s, 7)).toBe(0);
    }
  });

  it.each([
    [8, 0],
    [9, 0],
    [10, 1],
    [11, 1],
    [12, 2],
    [13, 2],
    [20, 2],
  ])('pays %i of a kind at tier %i', (count, tier) => {
    for (let s = 0; s < CONFIG.symbols.length; s++) {
      const wins = findWins(CONFIG, gridWith(s, count));
      expect(wins).toHaveLength(1);
      expect(wins[0].symbol).toBe(s);
      expect(wins[0].count).toBe(count);
      expect(wins[0].positions).toHaveLength(count);
      expect(wins[0].pay).toBe(CONFIG.symbols[s].pays[tier]);
    }
  });

  it('pays anywhere: positions do not matter', () => {
    const red = id('red');
    const a = gridWith(red, 8);
    const b = [...a].reverse();
    expect(findWins(CONFIG, a)[0].pay).toBe(10);
    expect(findWins(CONFIG, b)[0].pay).toBe(10);
  });

  it('pays several symbols at once', () => {
    const grid: number[] = [];
    for (let i = 0; i < 30; i++) grid.push(i < 8 ? id('red') : i < 18 ? id('banana') : i < 30 ? id('plum') : 0);
    const wins = findWins(CONFIG, grid);
    expect(wins.map((w) => [CONFIG.symbols[w.symbol].id, w.count, w.pay])).toEqual([
      ['red', 8, 10],
      ['plum', 12, 8],
      ['banana', 10, 0.75],
    ]);
  });

  it('never counts scatters or bombs as symbol wins', () => {
    expect(findWins(CONFIG, new Array(30).fill(SCATTER))).toEqual([]);
    expect(findWins(CONFIG, new Array(30).fill(BOMB))).toEqual([]);
  });
});

describe('tumble gravity', () => {
  it('drops survivors and fills from the top', () => {
    const config = CONFIG;
    // Column 0 (top to bottom): A B C D E ; remove B and D.
    const symbols = new Array(30).fill(8);
    const bombValues = new Array(30).fill(0);
    [0, 1, 2, 3, 4].forEach((s, row) => (symbols[row] = s));
    const incoming = [[{ symbol: 6 }, { symbol: 7 }], [], [], [], [], []];
    const after = collapse(config, { symbols, bombValues }, [1, 3], incoming);
    expect(after.symbols.slice(0, 5)).toEqual([6, 7, 0, 2, 4]);
    expect(after.symbols.slice(5)).toEqual(symbols.slice(5));
  });

  it('carries bomb values along with the falling bomb', () => {
    const symbols = new Array(30).fill(8);
    const bombValues = new Array(30).fill(0);
    symbols[0] = BOMB;
    bombValues[0] = 25;
    symbols[4] = 0;
    const after = collapse(CONFIG, { symbols, bombValues }, [4], [[{ symbol: 3 }], [], [], [], [], []]);
    expect(after.symbols.slice(0, 5)).toEqual([3, BOMB, 8, 8, 8]);
    expect(after.bombValues.slice(0, 5)).toEqual([0, 25, 0, 0, 0]);
  });
});

/** Check every internal consistency rule of one recorded spin. */
function checkSpin(config: GameConfig, s: SpinResult, isFree: boolean): void {
  const cells = config.cols * config.rows;
  const { SCATTER: SC, BOMB: BM } = symbolCodes(config);
  expect(s.initialGrid.symbols).toHaveLength(cells);

  let grid = s.initialGrid;
  let tumbleWin = 0;
  for (const step of s.steps) {
    expect(step.grid).toEqual(grid);
    const wins = findWins(config, step.grid.symbols);
    expect(wins.length).toBeGreaterThan(0);
    expect(step.wins).toEqual(wins);
    const removed = wins.flatMap((w) => w.positions).sort((a, b) => a - b);
    expect(step.removed).toEqual(removed);
    for (const pos of removed) {
      expect(step.grid.symbols[pos]).not.toBe(SC);
      expect(step.grid.symbols[pos]).not.toBe(BM);
    }
    const stepWin = wins.reduce((sum, w) => sum + w.pay, 0);
    expect(step.stepWin).toBeCloseTo(stepWin, 9);
    tumbleWin += stepWin;

    // Rebuild gridAfter with the reference collapse, taking the new symbols from the top.
    const incoming = [];
    for (let col = 0; col < config.cols; col++) {
      const n = removed.filter((p) => Math.floor(p / config.rows) === col).length;
      const fresh = [];
      for (let row = 0; row < n; row++) {
        const idx = col * config.rows + row;
        fresh.push({ symbol: step.gridAfter.symbols[idx], bombValue: step.gridAfter.bombValues[idx] });
      }
      incoming.push(fresh);
    }
    expect(step.gridAfter).toEqual(collapse(config, step.grid, removed, incoming));
    grid = step.gridAfter;
  }

  expect(s.finalGrid).toEqual(grid);
  if (s.steps.length < config.maxTumblesPerSpin) expect(findWins(config, s.finalGrid.symbols)).toEqual([]);
  expect(s.tumbleWin).toBeCloseTo(tumbleWin, 6);

  const scatterPositions = s.finalGrid.symbols.flatMap((v, i) => (v === SC ? [i] : []));
  expect(s.scatterPositions).toEqual(scatterPositions);
  expect(s.scatterCount).toBe(scatterPositions.length);
  expect(s.scatterWin).toBe(scatterPay(config, s.scatterCount));

  const bombs = s.finalGrid.symbols.flatMap((v, i) => (v === BM ? [{ position: i, value: s.finalGrid.bombValues[i] }] : []));
  expect(s.bombs).toEqual(bombs);
  for (const b of bombs) expect(config.bomb.values).toContain(b.value);
  if (!isFree) expect(bombs).toEqual([]);

  const raw = s.tumbleWin + s.scatterWin;
  const expectedMultiplier = raw > 0 && bombs.length > 0 ? bombMultiplier(bombs) : 1;
  expect(s.multiplier).toBe(expectedMultiplier);
  expect(s.win).toBeCloseTo(raw * expectedMultiplier, 6);
}

function checkRound(config: GameConfig, r: RoundResult): void {
  checkSpin(config, r.baseSpin, false);
  for (const fs of r.freeSpins) checkSpin(config, fs, true);

  expect(r.triggered).toBe(r.baseSpin.scatterCount >= config.scatter.triggerCount);
  expect(r.baseSpin.freeSpinsAwarded).toBe(r.triggered ? config.scatter.freeSpins : 0);
  if (!r.triggered) expect(r.freeSpins).toEqual([]);

  const cap = config.maxWinMultiplier;
  const uncapped = r.baseSpin.win + r.freeSpins.reduce((sum, s) => sum + s.win, 0);
  expect(r.totalWin).toBeCloseTo(Math.min(cap, uncapped), 6);
  expect(r.capped).toBe(uncapped >= cap);
  expect(r.baseWin + r.freeSpinsWin).toBeCloseTo(r.totalWin, 6);
  expect(r.payout).toBeCloseTo(Math.round(r.totalWin * r.bet * 100) / 100, 9);

  if (r.triggered && !r.capped) {
    const retriggers = r.freeSpins.filter((s) => s.scatterCount >= config.scatter.retriggerCount).length;
    expect(r.freeSpins).toHaveLength(config.scatter.freeSpins + retriggers * config.scatter.retriggerSpins);
    for (const s of r.freeSpins) {
      expect(s.freeSpinsAwarded).toBe(s.scatterCount >= config.scatter.retriggerCount ? config.scatter.retriggerSpins : 0);
    }
  }
}

describe('complete rounds are internally consistent', () => {
  it.each(['base', 'ante', 'buy'] as Mode[])('%s mode, shipped config', (mode) => {
    const rounds = mode === 'buy' ? 150 : 1500;
    let wins = 0;
    let tumbles = 0;
    for (let seed = 1; seed <= rounds; seed++) {
      const r = spin(CONFIG, 1, mode, seed);
      checkRound(CONFIG, r);
      if (r.totalWin > 0) wins++;
      tumbles += r.baseSpin.steps.length;
    }
    expect(wins).toBeGreaterThan(0);
    expect(tumbles).toBeGreaterThan(0);
  });

  it('with a feature-heavy config (many scatters and bombs)', () => {
    const config = makeConfig({
      reels: {
        base: reel({ red: 10, purple: 10, green: 10, blue: 10, apple: 10, plum: 10, watermelon: 30, grapes: 30, banana: 40, scatter: 25 }),
        free: reel({ red: 10, purple: 10, green: 10, blue: 10, apple: 10, plum: 10, watermelon: 30, grapes: 30, banana: 40, scatter: 5, bomb: 8 }),
      },
    });
    let triggered = 0;
    let retriggered = 0;
    let multiplied = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = spin(config, 2, 'base', seed);
      checkRound(config, r);
      if (r.triggered) triggered++;
      if (r.freeSpins.some((s) => s.freeSpinsAwarded > 0)) retriggered++;
      if (r.freeSpins.some((s) => s.multiplier > 1)) multiplied++;
    }
    expect(triggered).toBeGreaterThan(20);
    expect(retriggered).toBeGreaterThan(5);
    expect(multiplied).toBeGreaterThan(5);
  });
});

describe('scatters', () => {
  it('pay 3x for 4, 5x for 5 and 100x for 6 or more', () => {
    expect(scatterPay(CONFIG, 0)).toBe(0);
    expect(scatterPay(CONFIG, 3)).toBe(0);
    expect(scatterPay(CONFIG, 4)).toBe(3);
    expect(scatterPay(CONFIG, 5)).toBe(5);
    expect(scatterPay(CONFIG, 6)).toBe(100);
    expect(scatterPay(CONFIG, 7)).toBe(100);
    expect(scatterPay(CONFIG, 30)).toBe(100);
  });

  it('trigger 10 free spins with 4 or more, and nothing with fewer', () => {
    const config = makeConfig({
      reels: { base: reel({ red: 12, purple: 12, green: 12, blue: 12, apple: 12, plum: 12, watermelon: 12, grapes: 12, banana: 12, scatter: 10 }) },
    });
    const seen = new Set<number>();
    for (let seed = 1; seed <= 600; seed++) {
      const r = spin(config, 1, 'base', seed);
      const n = r.baseSpin.scatterCount;
      seen.add(Math.min(n, 6));
      if (n >= 4) {
        expect(r.triggered).toBe(true);
        expect(r.baseSpin.freeSpinsAwarded).toBe(10);
        expect(r.freeSpins.length).toBeGreaterThanOrEqual(r.capped ? 1 : 10);
        expect(r.baseSpin.scatterWin).toBe(n === 4 ? 3 : n === 5 ? 5 : 100);
      } else {
        expect(r.triggered).toBe(false);
        expect(r.freeSpins).toHaveLength(0);
        expect(r.baseSpin.scatterWin).toBe(0);
      }
    }
    for (const n of [2, 3, 4, 5, 6]) expect(seen.has(n)).toBe(true);
  });

  it('are never removed by tumbles', () => {
    let checked = 0;
    for (let seed = 1; seed <= 3000 && checked < 200; seed++) {
      const r = spin(CONFIG, 1, 'ante', seed);
      const s = r.baseSpin;
      if (s.steps.length === 0 || s.initialGrid.symbols.indexOf(SCATTER) < 0) continue;
      checked++;
      let before = s.initialGrid.symbols.filter((v) => v === SCATTER).length;
      for (const step of s.steps) {
        const after = step.gridAfter.symbols.filter((v) => v === SCATTER).length;
        expect(after).toBeGreaterThanOrEqual(before);
        before = after;
      }
    }
    expect(checked).toBe(200);
  });
});

describe('free spins', () => {
  const lively = makeConfig({
    reels: {
      free: reel({ red: 10, purple: 10, green: 10, blue: 10, apple: 10, plum: 10, watermelon: 30, grapes: 30, banana: 40, scatter: 5, bomb: 8 }),
    },
  });

  it('retrigger: 3 or more scatters add 5 spins', () => {
    let retriggers = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = spin(lively, 1, 'buy', seed);
      if (r.capped) continue;
      let expected = 10;
      r.freeSpins.forEach((s, i) => {
        expect(i).toBeLessThan(expected);
        if (s.scatterCount >= 3) {
          expected += 5;
          retriggers++;
          expect(s.freeSpinsAwarded).toBe(5);
        } else {
          expect(s.freeSpinsAwarded).toBe(0);
        }
      });
      expect(r.freeSpins).toHaveLength(expected);
    }
    expect(retriggers).toBeGreaterThan(20);
  });

  it('bombs: values on screen are added together and multiply the spin win', () => {
    let singles = 0;
    let multiples = 0;
    let wasted = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = spin(lively, 1, 'buy', seed);
      for (const s of r.freeSpins) {
        const sum = s.bombs.reduce((a, b) => a + b.value, 0);
        const raw = s.tumbleWin + s.scatterWin;
        if (s.bombs.length === 0) {
          expect(s.multiplier).toBe(1);
          expect(s.win).toBeCloseTo(raw, 6);
        } else if (raw > 0) {
          expect(s.multiplier).toBe(sum);
          expect(s.win).toBeCloseTo(raw * sum, 6);
          if (s.bombs.length === 1) singles++;
          else multiples++;
        } else {
          expect(s.multiplier).toBe(1);
          expect(s.win).toBe(0);
          wasted++;
        }
      }
    }
    expect(singles).toBeGreaterThan(10);
    expect(multiples).toBeGreaterThan(10);
    expect(wasted).toBeGreaterThan(10);
  });

  it('bombMultiplier adds values and is 1 with no bombs', () => {
    expect(bombMultiplier([])).toBe(1);
    expect(bombMultiplier([{ position: 0, value: 2 }])).toBe(2);
    expect(bombMultiplier([{ position: 0, value: 2 }, { position: 7, value: 100 }, { position: 9, value: 25 }])).toBe(127);
  });

  it('bombs stay on the grid for the whole tumble sequence', () => {
    let checked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const r = spin(lively, 1, 'buy', seed);
      for (const s of r.freeSpins) {
        let before = s.initialGrid.bombValues.filter((v) => v > 0).sort();
        for (const step of s.steps) {
          const after = step.gridAfter.bombValues.filter((v) => v > 0).sort();
          const remaining = [...after];
          for (const v of before) {
            const at = remaining.indexOf(v);
            expect(at).toBeGreaterThanOrEqual(0);
            remaining.splice(at, 1);
          }
          before = after;
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('bombs only appear in free spins', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = spin(CONFIG, 1, 'buy', seed);
      expect(r.baseSpin.initialGrid.symbols).not.toContain(BOMB);
      expect(r.baseSpin.finalGrid.symbols).not.toContain(BOMB);
    }
    expect(CONFIG.reels.base.bomb).toBe(0);
    expect(CONFIG.reels.ante.bomb).toBe(0);
    expect(CONFIG.reels.free.bomb).toBeGreaterThan(0);
  });

  it('bomb values are the thirteen from the rules, weighted towards low values', () => {
    expect(CONFIG.bomb.values).toEqual([2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100]);
    const w = CONFIG.bomb.weights;
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
    expect(w[0]).toBeGreaterThan(w[w.length - 1] * 20);
  });
});

describe('max win cap', () => {
  // Every position is a red candy or a bomb: enormous wins on every free spin.
  const jackpot = makeConfig({
    reels: { free: reel({ red: 90, bomb: 10 }) },
    maxTumblesPerSpin: 5,
  });

  it('caps the round at 21,100x and ends it immediately', () => {
    expect(CONFIG.maxWinMultiplier).toBe(21100);
    for (let seed = 1; seed <= 50; seed++) {
      const r = spin(jackpot, 2.5, 'buy', seed);
      expect(r.capped).toBe(true);
      expect(r.totalWin).toBe(21100);
      expect(r.payout).toBe(52750);
      expect(r.freeSpins.length).toBeLessThan(10);
      // The spin that crossed the cap is the last one played.
      const before = r.baseSpin.win + r.freeSpins.slice(0, -1).reduce((sum, s) => sum + s.win, 0);
      expect(before).toBeLessThan(21100);
      const s = simulateRound(jackpot, 'buy', seed);
      expect(s.capped).toBe(true);
      expect(s.totalWinX100).toBe(2110000);
    }
  });

  it('caps a base spin too, and then plays no free spins', () => {
    const config = makeConfig({
      reels: { base: reel({ red: 95, scatter: 5 }) },
      maxWinMultiplier: 100,
      maxTumblesPerSpin: 10,
    });
    for (let seed = 1; seed <= 50; seed++) {
      const r = spin(config, 1, 'base', seed);
      expect(r.capped).toBe(true);
      expect(r.totalWin).toBe(100);
      expect(r.baseWin).toBe(100);
      expect(r.freeSpins).toHaveLength(0);
    }
  });

  it('does not flag ordinary rounds as capped', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = spin(CONFIG, 1, 'base', seed);
      expect(r.capped).toBe(false);
      expect(r.totalWin).toBeLessThan(21100);
    }
  });
});

describe('ante and buy modes', () => {
  it('charge the right stake', () => {
    expect(roundCost(CONFIG, 1, 'base')).toBe(1);
    expect(roundCost(CONFIG, 1, 'ante')).toBe(1.25);
    expect(roundCost(CONFIG, 1, 'buy')).toBe(100);
    expect(roundCost(CONFIG, 0.2, 'ante')).toBe(0.25);
    expect(roundCost(CONFIG, 0.2, 'buy')).toBe(20);
    expect(roundCost(CONFIG, 7.5, 'ante')).toBe(9.38);
    expect(spin(CONFIG, 4, 'ante', 1).cost).toBe(5);
    expect(spin(CONFIG, 4, 'buy', 1).cost).toBe(400);
  });

  it('ante pays on the base bet, not on the raised stake', () => {
    const same = makeConfig({ reels: { ante: CONFIG.reels.base } });
    for (let seed = 1; seed <= 200; seed++) {
      const a = spin(same, 2, 'ante', seed);
      const b = spin(same, 2, 'base', seed);
      expect(a.totalWin).toBe(b.totalWin);
      expect(a.payout).toBe(b.payout);
      expect(a.cost).toBe(2.5);
    }
  });

  it('ante uses its own reel weights, with more scatters than the base game', () => {
    expect(CONFIG.reels.ante.scatter).toBeGreaterThan(CONFIG.reels.base.scatter);
    expect(CONFIG.reels.ante.symbols).toEqual(CONFIG.reels.base.symbols);
    const always = makeConfig({ reels: { ante: reel({ scatter: 1 }) } });
    const r = spin(always, 1, 'ante', 3);
    expect(r.baseSpin.scatterCount).toBe(30);
    expect(r.triggered).toBe(true);
    expect(spin(always, 1, 'base', 3).baseSpin.scatterCount).toBeLessThan(30);
  });

  it('ante roughly doubles the free-spin trigger chance', () => {
    const n = 300_000;
    let base = 0;
    let ante = 0;
    for (let seed = 1; seed <= n; seed++) {
      if (simulateRound(CONFIG, 'base', seed).triggered) base++;
      if (simulateRound(CONFIG, 'ante', seed + 10_000_000).triggered) ante++;
    }
    expect(base).toBeGreaterThan(300);
    expect(ante / base).toBeGreaterThan(1.7);
    expect(ante / base).toBeLessThan(2.3);
  });

  it('buy always triggers free spins', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 2000; seed++) {
      const r = spin(CONFIG, 1, 'buy', seed);
      expect(r.triggered).toBe(true);
      expect(r.baseSpin.scatterCount).toBeGreaterThanOrEqual(4);
      expect(r.baseSpin.initialGrid.symbols.filter((v) => v === SCATTER).length).toBeGreaterThanOrEqual(4);
      expect(r.freeSpins.length).toBeGreaterThanOrEqual(r.capped ? 1 : 10);
      counts.add(r.baseSpin.scatterCount);
    }
    expect(counts.has(4)).toBe(true);
    expect(counts.has(5)).toBe(true);
  });

  it('costs 100x and the buy price is in the config', () => {
    expect(CONFIG.buy.costMultiplier).toBe(100);
    expect(CONFIG.ante.costMultiplier).toBe(1.25);
  });
});

describe('determinism', () => {
  it('the same seed always gives the same result', () => {
    for (const mode of ['base', 'ante', 'buy'] as Mode[]) {
      for (let seed = 1; seed <= 40; seed++) {
        expect(spin(CONFIG, 1, mode, seed)).toEqual(spin(CONFIG, 1, mode, seed));
      }
    }
    const big = 2 ** 53 - 1;
    expect(spin(CONFIG, 1, 'buy', big)).toEqual(spin(CONFIG, 1, 'buy', big));
  });

  it('different seeds give different results', () => {
    const grids = new Set<string>();
    for (let seed = 0; seed < 200; seed++) grids.add(spin(CONFIG, 1, 'base', seed).baseSpin.initialGrid.symbols.join(','));
    expect(grids.size).toBe(200);
  });

  it('the bet scales the payout but not the outcome', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const a = spin(CONFIG, 0.2, 'buy', seed);
      const b = spin(CONFIG, 100, 'buy', seed);
      expect(a.totalWin).toBe(b.totalWin);
      expect(a.baseSpin).toEqual(b.baseSpin);
      expect(b.payout).toBeCloseTo(b.totalWin * 100, 6);
      expect(a.payout).toBeCloseTo(Math.round(a.totalWin * 20) / 100, 9);
    }
  });

  it('the fast simulation path matches the recorded path', () => {
    for (const mode of ['base', 'ante', 'buy'] as Mode[]) {
      const rounds = mode === 'buy' ? 300 : 3000;
      for (let seed = 1; seed <= rounds; seed++) {
        const full = spin(CONFIG, 1, mode, seed);
        const fast = simulateRound(CONFIG, mode, seed);
        expect(fast.totalWinX100).toBe(Math.round(full.totalWin * 100));
        expect(fast.baseWinX100).toBe(Math.round(full.baseWin * 100));
        expect(fast.freeSpinsWinX100).toBe(Math.round(full.freeSpinsWin * 100));
        expect(fast.triggered).toBe(full.triggered);
        expect(fast.freeSpinsPlayed).toBe(full.freeSpins.length);
        expect(fast.capped).toBe(full.capped);
      }
    }
  });
});

describe('inputs and config validation', () => {
  it('rejects bad bets and seeds', () => {
    expect(() => spin(CONFIG, 0, 'base', 1)).toThrow();
    expect(() => spin(CONFIG, -1, 'base', 1)).toThrow();
    expect(() => spin(CONFIG, Number.NaN, 'base', 1)).toThrow();
    expect(() => spin(CONFIG, 1, 'base', -5)).toThrow();
    expect(() => spin(CONFIG, 1, 'base', 0.5)).toThrow();
  });

  it('rejects broken configs', () => {
    expect(() => spin(makeConfig({ reels: { base: { symbols: [1, 2, 3], scatter: 1, bomb: 0 } } }), 1, 'base', 1)).toThrow();
    expect(() => spin(makeConfig({ reels: { base: reel({ red: 1.5 }) } }), 1, 'base', 1)).toThrow();
    expect(() => spin(makeConfig({ reels: { base: reel({}) } }), 1, 'base', 1)).toThrow();
    expect(() => spin(makeConfig({ payTiers: [10, 8, 12] }), 1, 'base', 1)).toThrow();
    expect(() => spin(makeConfig({ bomb: { name: 'b', values: [2, 3], weights: [1] } }), 1, 'base', 1)).toThrow();
    expect(() => spin(makeConfig({ buy: { costMultiplier: 100, scatterCountWeights: { 3: 1 } } }), 1, 'buy', 1)).toThrow();
  });

  it('the bet ladder runs from 0.20 to 100', () => {
    const bets = CONFIG.bets;
    expect(bets[0]).toBe(0.2);
    expect(bets[bets.length - 1]).toBe(100);
    for (let i = 1; i < bets.length; i++) expect(bets[i]).toBeGreaterThan(bets[i - 1]);
    expect(bets).toContain(CONFIG.defaultBet);
    // Every stake is a whole number of cents in every mode.
    for (const bet of bets) {
      expect(Math.round(bet * 100)).toBeCloseTo(bet * 100, 9);
      expect(roundCost(CONFIG, bet, 'buy') * 100).toBeCloseTo(Math.round(bet * 10000), 6);
    }
  });
});
