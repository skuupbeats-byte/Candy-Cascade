/**
 * Candy Cascade - the single source of truth for the game's rules and math.
 *
 * Everything that affects payouts lives here: paytable, symbol weights,
 * scatter and bomb parameters, feature costs, the win cap and the bet ladder.
 * The engine reads this object and nothing else, so retuning the game means
 * editing this file and re-running `npm run simulate` (see README.md).
 *
 * How symbols are drawn: every grid position - on the initial drop and on
 * every tumble refill - is drawn independently from one weighted bag. A
 * weight is simply "how many tickets this symbol has in the bag". There is
 * one bag per situation (`reels.base`, `reels.ante`, `reels.free`).
 */

export type Mode = 'base' | 'ante' | 'buy';

export interface SymbolDef {
  /** Stable identifier, used by the UI to pick artwork. */
  id: string;
  name: string;
  /** Payouts as multiples of the bet, one per entry in `payTiers`. */
  pays: readonly number[];
}

export interface ReelWeights {
  /** One integer weight per entry of `symbols`, in the same order. */
  symbols: readonly number[];
  /** Weight of the scatter (lollipop). */
  scatter: number;
  /** Weight of the multiplier bomb. Only meaningful for free spins. */
  bomb: number;
  /**
   * "Hot symbol" spins. On `chancePer1000` out of every 1000 spins, one
   * symbol is picked (using `pickWeights`, one per symbol) and its weight is
   * multiplied by `boost` for that whole spin, refills included. This makes
   * symbol counts clumpy - fewer, bigger wins - which is where the game's
   * volatility comes from. Set `chancePer1000` to 0 to switch it off.
   */
  hot: {
    chancePer1000: number;
    boost: number;
    pickWeights: readonly number[];
  };
}

export interface GameConfig {
  title: string;
  cols: number;
  rows: number;
  /** Target return-to-player the weights were tuned for. */
  targetRtp: number;

  symbols: readonly SymbolDef[];
  /** Minimum symbol counts for each pay tier, ascending. First entry is the minimum win. */
  payTiers: readonly number[];

  scatter: {
    name: string;
    /** Scatter pays as bet multiples: count -> pay. The highest key also covers larger counts. */
    pays: Readonly<Record<number, number>>;
    /** Scatters needed in the base game to trigger free spins. */
    triggerCount: number;
    freeSpins: number;
    /** Scatters needed during free spins to add more spins. */
    retriggerCount: number;
    retriggerSpins: number;
  };

  bomb: {
    name: string;
    /** Possible multiplier values and the weight of each (same length). */
    values: readonly number[];
    weights: readonly number[];
  };

  reels: {
    base: ReelWeights;
    /** Same as base but with more scatters: tuned so free spins trigger twice as often. */
    ante: ReelWeights;
    free: ReelWeights;
  };

  ante: {
    /** Total stake when the ante is on, as a multiple of the bet. */
    costMultiplier: number;
  };

  buy: {
    /** Price of the buy feature, as a multiple of the bet. */
    costMultiplier: number;
    /** How many scatters the bought spin lands: count -> weight. */
    scatterCountWeights: Readonly<Record<number, number>>;
  };

  /** A round can never pay more than this multiple of the bet. */
  maxWinMultiplier: number;
  /** Safety stop for degenerate configs (a real spin never gets close). */
  maxTumblesPerSpin: number;

  /** Allowed bets in credits. */
  bets: readonly number[];
  defaultBet: number;
  startingBalance: number;
}

// One list of symbol weights is shared by all three bags; they differ in
// scatters, bombs and how often (and how strongly) a symbol runs hot.
//                    red   purple green blue  apple plum  melon grapes banana
const SYMBOL_WEIGHTS = [2730, 3060, 3430, 3840, 4300, 4820, 5390, 6040, 6770];
const EVEN_PICK = [1, 1, 1, 1, 1, 1, 1, 1, 1];
const HOT_BASE = { chancePer1000: 384, boost: 3, pickWeights: EVEN_PICK };
const HOT_FREE = { chancePer1000: 280, boost: 8, pickWeights: EVEN_PICK };

export const CONFIG: GameConfig = {
  title: 'Candy Cascade',
  cols: 6,
  rows: 5,
  targetRtp: 0.965,

  symbols: [
    { id: 'red', name: 'Red candy', pays: [10, 25, 50] },
    { id: 'purple', name: 'Purple candy', pays: [2.5, 10, 25] },
    { id: 'green', name: 'Green candy', pays: [2, 5, 15] },
    { id: 'blue', name: 'Blue candy', pays: [1.5, 2, 12] },
    { id: 'apple', name: 'Apple', pays: [1, 1.5, 10] },
    { id: 'plum', name: 'Plum', pays: [0.8, 1.2, 8] },
    { id: 'watermelon', name: 'Watermelon', pays: [0.5, 1, 5] },
    { id: 'grapes', name: 'Grapes', pays: [0.4, 0.9, 4] },
    { id: 'banana', name: 'Banana', pays: [0.25, 0.75, 2] },
  ],
  payTiers: [8, 10, 12],

  scatter: {
    name: 'Lollipop',
    pays: { 4: 3, 5: 5, 6: 100 },
    triggerCount: 4,
    freeSpins: 10,
    retriggerCount: 3,
    retriggerSpins: 5,
  },

  bomb: {
    name: 'Multiplier bomb',
    values: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100],
    weights: [260, 220, 180, 140, 110, 85, 70, 55, 45, 35, 28, 16, 8],
  },

  reels: {
    base: { symbols: SYMBOL_WEIGHTS, scatter: 745, bomb: 0, hot: HOT_BASE },
    ante: { symbols: SYMBOL_WEIGHTS, scatter: 913, bomb: 0, hot: HOT_BASE },
    free: { symbols: SYMBOL_WEIGHTS, scatter: 800, bomb: 312, hot: HOT_FREE },
  },

  ante: { costMultiplier: 1.25 },

  buy: {
    costMultiplier: 100,
    scatterCountWeights: { 4: 897, 5: 94, 6: 9 },
  },

  maxWinMultiplier: 21100,
  maxTumblesPerSpin: 100,

  bets: [0.2, 0.4, 0.6, 0.8, 1, 1.5, 2, 3, 4, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100],
  defaultBet: 1,
  startingBalance: 10000,
};

/** Stake actually charged for a round, in credits (rounded to cents). */
export function roundCost(config: GameConfig, bet: number, mode: Mode): number {
  const mult =
    mode === 'ante' ? config.ante.costMultiplier : mode === 'buy' ? config.buy.costMultiplier : 1;
  return Math.round(bet * mult * 100) / 100;
}
