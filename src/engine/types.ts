import type { Mode } from './config';

/**
 * A snapshot of the grid. Positions are stored column by column:
 * index = col * rows + row, with row 0 at the top.
 *
 * `symbols[i]` is an index into `config.symbols`, or SCATTER / BOMB
 * (see `symbolCodes`). `bombValues[i]` is the multiplier shown on a bomb,
 * and 0 for every other position.
 */
export interface GridSnapshot {
  symbols: number[];
  bombValues: number[];
}

export interface SymbolWin {
  /** Index into `config.symbols`. */
  symbol: number;
  count: number;
  positions: number[];
  /** Payout as a multiple of the bet. */
  pay: number;
}

/** One tumble: the wins found on `grid`, what was removed, and the grid after the refill. */
export interface TumbleStep {
  grid: GridSnapshot;
  wins: SymbolWin[];
  /** Sum of the wins in this step, as a bet multiple. */
  stepWin: number;
  /** All positions that disappear (the union of the winning positions). */
  removed: number[];
  /** Grid after gravity and refill. New symbols occupy the top of each column. */
  gridAfter: GridSnapshot;
}

export interface BombHit {
  position: number;
  value: number;
}

export interface SpinResult {
  /** Grid as it first lands. */
  initialGrid: GridSnapshot;
  steps: TumbleStep[];
  /** Grid when the tumbles have finished. */
  finalGrid: GridSnapshot;
  /** Sum of all symbol wins across tumbles, as a bet multiple (before bombs). */
  tumbleWin: number;
  scatterCount: number;
  scatterPositions: number[];
  /** Scatter payout as a bet multiple (before bombs). */
  scatterWin: number;
  /** Bombs on the final grid (free spins only). */
  bombs: BombHit[];
  /** Sum of the bomb values, or 1 when there are none or nothing was won. */
  multiplier: number;
  /** (tumbleWin + scatterWin) x multiplier, as a bet multiple, before the round cap. */
  win: number;
  /** Free spins awarded by this spin (trigger or retrigger). */
  freeSpinsAwarded: number;
}

export interface RoundResult {
  seed: number;
  mode: Mode;
  bet: number;
  /** Credits charged for the round. */
  cost: number;
  baseSpin: SpinResult;
  triggered: boolean;
  freeSpins: SpinResult[];
  /** Base spin win as a bet multiple (after the cap). */
  baseWin: number;
  /** Free spins win as a bet multiple (after the cap). */
  freeSpinsWin: number;
  /** Whole round as a bet multiple (after the cap). */
  totalWin: number;
  /** Credits paid out for the round, rounded to cents. */
  payout: number;
  /** True when the round hit the max win and was cut short. */
  capped: boolean;
}

/** Numbers-only outcome used by the simulator (no grid history is recorded). */
export interface RoundSummary {
  /** Wins in hundredths of the bet, to keep the arithmetic in exact integers. */
  baseWinX100: number;
  freeSpinsWinX100: number;
  totalWinX100: number;
  triggered: boolean;
  freeSpinsPlayed: number;
  capped: boolean;
}
