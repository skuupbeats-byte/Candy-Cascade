import { CONFIG, type GameConfig, type ReelWeights } from '../src/engine';

type Overrides = Partial<Omit<GameConfig, 'reels'>> & { reels?: Partial<GameConfig['reels']> };

/** A fresh config object based on the shipped one, with some parts replaced. */
export function makeConfig(overrides: Overrides = {}): GameConfig {
  return {
    ...CONFIG,
    ...overrides,
    reels: { ...CONFIG.reels, ...(overrides.reels ?? {}) },
  };
}

/** Reel weights from a partial list: symbol weights by id, plus scatter/bomb. */
export function reel(weights: Record<string, number>): ReelWeights {
  return {
    symbols: CONFIG.symbols.map((s) => weights[s.id] ?? 0),
    scatter: weights.scatter ?? 0,
    bomb: weights.bomb ?? 0,
  };
}

/** A 30-position grid holding `count` of `symbol`, padded so nothing else can win. */
export function gridWith(symbol: number, count: number, config: GameConfig = CONFIG): number[] {
  const cells = config.cols * config.rows;
  const fillers = config.symbols.map((_, i) => i).filter((i) => i !== symbol);
  const grid: number[] = [];
  for (let i = 0; i < cells; i++) {
    if (i < count) grid.push(symbol);
    else grid.push(fillers[(i - count) % fillers.length]);
  }
  // Spread deterministically so the winning symbols are not all in one corner.
  return grid.map((_, i) => grid[(i * 7) % cells]);
}
