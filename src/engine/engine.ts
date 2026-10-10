/**
 * Candy Cascade game engine: pure logic, no rendering, no DOM, no I/O.
 *
 * `spin(config, bet, mode, seed)` plays one complete round (the paid spin and
 * any free spins it triggers) and returns everything that happened, so a
 * renderer only has to play the result back. `simulateRound` runs exactly the
 * same code path without recording grids, for fast simulation.
 */
import { type GameConfig, type Mode, type ReelWeights, roundCost } from './config';
import { Rng } from './rng';
import type {
  BombHit,
  GridSnapshot,
  RoundResult,
  RoundSummary,
  SpinResult,
  SymbolWin,
  TumbleStep,
} from './types';

/** Symbol codes used in grid snapshots, beyond the indices of `config.symbols`. */
export function symbolCodes(config: GameConfig): { SCATTER: number; BOMB: number } {
  return { SCATTER: config.symbols.length, BOMB: config.symbols.length + 1 };
}

// ---------------------------------------------------------------------------
// Compiled config: lookup tables derived once per config object.
// ---------------------------------------------------------------------------

/** The bags a spin can draw from: the normal one, plus one per possible hot symbol. */
interface ReelSet {
  normal: Uint8Array;
  hot: Uint8Array[];
  /** Hot-spin chance out of 1000. */
  hotChance: number;
  /** Lookup table for picking the hot symbol. */
  hotPick: Uint8Array;
}

interface Compiled {
  cells: number;
  cols: number;
  rows: number;
  nSym: number;
  scatter: number;
  bomb: number;
  minCount: number;
  /** payX100[symbol * (cells + 1) + count] in hundredths of the bet. */
  payX100: Int32Array;
  /** scatterPayX100[count] in hundredths of the bet. */
  scatterPayX100: Int32Array;
  reels: { base: ReelSet; ante: ReelSet; free: ReelSet; buy: ReelSet };
  bombTable: Uint16Array;
  buyScatterTable: Uint8Array;
  triggerCount: number;
  freeSpins: number;
  retriggerCount: number;
  retriggerSpins: number;
  capX100: number;
  maxTumbles: number;
  // Scratch buffers, reused between spins.
  grid: Uint8Array;
  bombValues: Uint16Array;
  counts: Int32Array;
  order: Uint8Array;
}

const compiledCache = new WeakMap<GameConfig, Compiled>();

function toX100(value: number, what: string): number {
  const x = Math.round(value * 100);
  if (Math.abs(x - value * 100) > 1e-6) {
    throw new Error(`${what} must be a multiple of 0.01, got ${value}`);
  }
  return x;
}

function checkWeight(w: number, what: string): void {
  if (!Number.isInteger(w) || w < 0) throw new Error(`${what} must be a non-negative integer, got ${w}`);
}

function buildTable(entries: Array<[code: number, weight: number]>, what: string): number[] {
  const out: number[] = [];
  for (const [code, weight] of entries) {
    checkWeight(weight, `${what} weight`);
    for (let i = 0; i < weight; i++) out.push(code);
  }
  if (out.length === 0) throw new Error(`${what}: weights sum to zero`);
  if (out.length > 1 << 20) throw new Error(`${what}: weights sum to more than 2^20`);
  return out;
}

function reelSet(config: GameConfig, reel: ReelWeights, name: string, withScatter = true): ReelSet {
  const nSym = config.symbols.length;
  if (reel.symbols.length !== nSym) {
    throw new Error(`reels.${name}.symbols needs ${nSym} weights, got ${reel.symbols.length}`);
  }
  const table = (hotSymbol: number): Uint8Array => {
    const entries: Array<[number, number]> = reel.symbols.map((w, i) => [
      i,
      i === hotSymbol ? Math.round(w * reel.hot.boost) : w,
    ]);
    entries.push([nSym, withScatter ? reel.scatter : 0], [nSym + 1, reel.bomb]);
    return Uint8Array.from(buildTable(entries, `reels.${name}`));
  };
  const hot = reel.hot;
  if (!Number.isInteger(hot.chancePer1000) || hot.chancePer1000 < 0 || hot.chancePer1000 > 1000) {
    throw new Error(`reels.${name}.hot.chancePer1000 must be an integer from 0 to 1000`);
  }
  if (!(hot.boost >= 0)) throw new Error(`reels.${name}.hot.boost must not be negative`);
  if (hot.pickWeights.length !== nSym) throw new Error(`reels.${name}.hot.pickWeights needs ${nSym} weights`);
  const active = hot.chancePer1000 > 0;
  return {
    normal: table(-1),
    hot: active ? reel.symbols.map((_, i) => table(i)) : [],
    hotChance: hot.chancePer1000,
    hotPick: active
      ? Uint8Array.from(buildTable(hot.pickWeights.map((w, i) => [i, w] as [number, number]), `reels.${name}.hot.pickWeights`))
      : new Uint8Array(0),
  };
}

/** Choose the bag for one spin: usually the normal one, sometimes a hot-symbol one. */
function pickTable(set: ReelSet, rng: Rng): Uint8Array {
  if (set.hotChance === 0) return set.normal;
  if (rng.int(1000) >= set.hotChance) return set.normal;
  return set.hot[set.hotPick[rng.int(set.hotPick.length)]];
}

function compile(config: GameConfig): Compiled {
  const cached = compiledCache.get(config);
  if (cached) return cached;

  const cells = config.cols * config.rows;
  const nSym = config.symbols.length;
  if (cells < 1 || cells > 255) throw new Error('Grid must have between 1 and 255 positions');
  if (nSym < 1 || nSym > 200) throw new Error('Unsupported number of symbols');
  const tiers = config.payTiers;
  if (tiers.length === 0) throw new Error('payTiers must not be empty');
  for (let t = 1; t < tiers.length; t++) {
    if (tiers[t] <= tiers[t - 1]) throw new Error('payTiers must be ascending');
  }

  const payX100 = new Int32Array(nSym * (cells + 1));
  config.symbols.forEach((sym, s) => {
    if (sym.pays.length !== tiers.length) {
      throw new Error(`Symbol ${sym.id} needs ${tiers.length} pays, got ${sym.pays.length}`);
    }
    for (let count = 0; count <= cells; count++) {
      let pay = 0;
      for (let t = 0; t < tiers.length; t++) {
        if (count >= tiers[t]) pay = toX100(sym.pays[t], `Pay for ${sym.id}`);
      }
      payX100[s * (cells + 1) + count] = pay;
    }
  });

  const scatterPayX100 = new Int32Array(cells + 1);
  const scatterKeys = Object.keys(config.scatter.pays)
    .map(Number)
    .sort((a, b) => a - b);
  for (let count = 0; count <= cells; count++) {
    let pay = 0;
    for (const k of scatterKeys) {
      if (count >= k) pay = toX100(config.scatter.pays[k], 'Scatter pay');
    }
    scatterPayX100[count] = pay;
  }

  if (config.bomb.values.length !== config.bomb.weights.length) {
    throw new Error('bomb.values and bomb.weights must have the same length');
  }
  const bombTable = Uint16Array.from(
    buildTable(
      config.bomb.values.map((v, i) => [v, config.bomb.weights[i]] as [number, number]),
      'bomb',
    ),
  );

  const buyEntries = Object.keys(config.buy.scatterCountWeights).map(
    (k) => [Number(k), config.buy.scatterCountWeights[Number(k)]] as [number, number],
  );
  for (const [count] of buyEntries) {
    if (count < config.scatter.triggerCount || count > cells) {
      throw new Error(`buy.scatterCountWeights: ${count} scatters would not trigger free spins`);
    }
  }
  const buyScatterTable = Uint8Array.from(buildTable(buyEntries, 'buy.scatterCountWeights'));

  const compiled: Compiled = {
    cells,
    cols: config.cols,
    rows: config.rows,
    nSym,
    scatter: nSym,
    bomb: nSym + 1,
    minCount: tiers[0],
    payX100,
    scatterPayX100,
    reels: {
      base: reelSet(config, config.reels.base, 'base'),
      ante: reelSet(config, config.reels.ante, 'ante'),
      free: reelSet(config, config.reels.free, 'free'),
      // The bought spin lands exactly the scatters it was given, no extras.
      buy: reelSet(config, config.reels.base, 'base', false),
    },
    bombTable,
    buyScatterTable,
    triggerCount: config.scatter.triggerCount,
    freeSpins: config.scatter.freeSpins,
    retriggerCount: config.scatter.retriggerCount,
    retriggerSpins: config.scatter.retriggerSpins,
    capX100: toX100(config.maxWinMultiplier, 'maxWinMultiplier'),
    maxTumbles: config.maxTumblesPerSpin,
    grid: new Uint8Array(cells),
    bombValues: new Uint16Array(cells),
    counts: new Int32Array(nSym + 2),
    order: new Uint8Array(cells),
  };
  compiledCache.set(config, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// One spin (initial drop + tumbles)
// ---------------------------------------------------------------------------

/** Mutable outcome of the last spin played; reused to avoid allocation. */
interface SpinOutcome {
  winX100: number;
  tumbleWinX100: number;
  scatterWinX100: number;
  scatters: number;
  bombSum: number;
}

function snapshot(c: Compiled): GridSnapshot {
  return { symbols: Array.from(c.grid), bombValues: Array.from(c.bombValues) };
}

function playSpin(
  c: Compiled,
  rng: Rng,
  reels: ReelSet,
  forcedScatters: number,
  out: SpinOutcome,
  rec: SpinResult | null,
): void {
  const { cells, cols, rows, nSym, grid, bombValues, counts, bombTable, minCount, payX100 } = c;
  const table = pickTable(reels, rng);
  const tableLen = table.length;
  const bombLen = bombTable.length;
  const BOMB = c.bomb;
  const SCATTER = c.scatter;

  // Initial drop: every position is an independent weighted draw.
  for (let i = 0; i < cells; i++) {
    const s = table[rng.int(tableLen)];
    grid[i] = s;
    bombValues[i] = s === BOMB ? bombTable[rng.int(bombLen)] : 0;
  }

  // Buy feature: place the guaranteed scatters on distinct random positions.
  if (forcedScatters > 0) {
    const order = c.order;
    for (let i = 0; i < cells; i++) order[i] = i;
    for (let k = 0; k < forcedScatters; k++) {
      const j = k + rng.int(cells - k);
      const pos = order[j];
      order[j] = order[k];
      order[k] = pos;
      grid[pos] = SCATTER;
      bombValues[pos] = 0;
    }
  }

  if (rec) rec.initialGrid = snapshot(c);

  let tumbleWin = 0;
  let tumbles = 0;
  for (;;) {
    counts.fill(0);
    for (let i = 0; i < cells; i++) counts[grid[i]]++;

    let stepWin = 0;
    let any = false;
    for (let s = 0; s < nSym; s++) {
      if (counts[s] >= minCount) {
        any = true;
        stepWin += payX100[s * (cells + 1) + counts[s]];
      }
    }
    if (!any) break;
    tumbleWin += stepWin;

    let step: TumbleStep | null = null;
    if (rec) {
      const wins: SymbolWin[] = [];
      const removed: number[] = [];
      for (let s = 0; s < nSym; s++) {
        if (counts[s] < minCount) continue;
        const positions: number[] = [];
        for (let i = 0; i < cells; i++) if (grid[i] === s) positions.push(i);
        wins.push({ symbol: s, count: counts[s], positions, pay: payX100[s * (cells + 1) + counts[s]] / 100 });
      }
      for (let i = 0; i < cells; i++) {
        const s = grid[i];
        if (s < nSym && counts[s] >= minCount) removed.push(i);
      }
      step = { grid: snapshot(c), wins, stepWin: stepWin / 100, removed, gridAfter: null as unknown as GridSnapshot };
    }

    // Remove winners, let the rest fall, refill each column from the top.
    for (let col = 0; col < cols; col++) {
      const top = col * rows;
      let write = rows - 1;
      for (let row = rows - 1; row >= 0; row--) {
        const s = grid[top + row];
        if (s < nSym && counts[s] >= minCount) continue;
        if (write !== row) {
          grid[top + write] = s;
          bombValues[top + write] = bombValues[top + row];
        }
        write--;
      }
      for (let row = write; row >= 0; row--) {
        const s = table[rng.int(tableLen)];
        grid[top + row] = s;
        bombValues[top + row] = s === BOMB ? bombTable[rng.int(bombLen)] : 0;
      }
    }

    if (step && rec) {
      step.gridAfter = snapshot(c);
      rec.steps.push(step);
    }
    if (++tumbles >= c.maxTumbles) break;
  }

  // Scatters and bombs are never removed, so they are counted once, at the end.
  let scatters = 0;
  let bombSum = 0;
  for (let i = 0; i < cells; i++) {
    if (grid[i] === SCATTER) scatters++;
    bombSum += bombValues[i];
  }
  const scatterWin = c.scatterPayX100[scatters];
  let win = tumbleWin + scatterWin;
  const multiplier = win > 0 && bombSum > 0 ? bombSum : 1;
  win *= multiplier;

  out.winX100 = win;
  out.tumbleWinX100 = tumbleWin;
  out.scatterWinX100 = scatterWin;
  out.scatters = scatters;
  out.bombSum = bombSum;

  if (rec) {
    rec.finalGrid = snapshot(c);
    rec.tumbleWin = tumbleWin / 100;
    rec.scatterCount = scatters;
    rec.scatterWin = scatterWin / 100;
    rec.multiplier = multiplier;
    rec.win = win / 100;
    const bombs: BombHit[] = [];
    const scatterPositions: number[] = [];
    for (let i = 0; i < cells; i++) {
      if (bombValues[i] > 0) bombs.push({ position: i, value: bombValues[i] });
      if (grid[i] === SCATTER) scatterPositions.push(i);
    }
    rec.bombs = bombs;
    rec.scatterPositions = scatterPositions;
  }
}

function emptySpinResult(): SpinResult {
  const empty: GridSnapshot = { symbols: [], bombValues: [] };
  return {
    initialGrid: empty,
    steps: [],
    finalGrid: empty,
    tumbleWin: 0,
    scatterCount: 0,
    scatterPositions: [],
    scatterWin: 0,
    bombs: [],
    multiplier: 1,
    win: 0,
    freeSpinsAwarded: 0,
  };
}

// ---------------------------------------------------------------------------
// One round (paid spin + free spins)
// ---------------------------------------------------------------------------

const scratchOutcome: SpinOutcome = { winX100: 0, tumbleWinX100: 0, scatterWinX100: 0, scatters: 0, bombSum: 0 };

function playRound(c: Compiled, mode: Mode, rng: Rng, summary: RoundSummary, rec: RoundResult | null): void {
  const out = scratchOutcome;
  const cap = c.capX100;

  const baseTable = mode === 'ante' ? c.reels.ante : mode === 'buy' ? c.reels.buy : c.reels.base;
  const forced = mode === 'buy' ? c.buyScatterTable[rng.int(c.buyScatterTable.length)] : 0;
  const baseRec = rec ? rec.baseSpin : null;
  playSpin(c, rng, baseTable, forced, out, baseRec);

  let baseWin = out.winX100;
  let freeWin = 0;
  let played = 0;
  let capped = false;
  const triggered = out.scatters >= c.triggerCount;
  if (baseRec && triggered) baseRec.freeSpinsAwarded = c.freeSpins;

  if (baseWin >= cap) {
    baseWin = cap;
    capped = true;
  } else if (triggered) {
    let remaining = c.freeSpins;
    while (remaining > 0) {
      remaining--;
      played++;
      const fsRec = rec ? emptySpinResult() : null;
      playSpin(c, rng, c.reels.free, 0, out, fsRec);
      if (out.scatters >= c.retriggerCount) {
        remaining += c.retriggerSpins;
        if (fsRec) fsRec.freeSpinsAwarded = c.retriggerSpins;
      }
      if (rec && fsRec) rec.freeSpins.push(fsRec);
      freeWin += out.winX100;
      if (baseWin + freeWin >= cap) {
        freeWin = cap - baseWin;
        capped = true;
        break;
      }
    }
  }

  summary.baseWinX100 = baseWin;
  summary.freeSpinsWinX100 = freeWin;
  summary.totalWinX100 = baseWin + freeWin;
  summary.triggered = triggered;
  summary.freeSpinsPlayed = played;
  summary.capped = capped;
}

export function newRoundSummary(): RoundSummary {
  return { baseWinX100: 0, freeSpinsWinX100: 0, totalWinX100: 0, triggered: false, freeSpinsPlayed: 0, capped: false };
}

function checkBet(bet: number): void {
  if (!(bet > 0) || !Number.isFinite(bet)) throw new Error(`Bet must be a positive number, got ${bet}`);
}

/**
 * Play one complete round and return everything that happened.
 *
 * @param bet  the base bet in credits. Wins are multiples of this. The ante
 *             and buy modes charge more than the bet (see `roundCost`).
 * @param seed any integer from 0 to 2^53-1; the same inputs always give the
 *             same result.
 */
export function spin(config: GameConfig, bet: number, mode: Mode, seed: number): RoundResult {
  checkBet(bet);
  const c = compile(config);
  const rng = new Rng(seed);
  const summary = newRoundSummary();
  const result: RoundResult = {
    seed,
    mode,
    bet,
    cost: roundCost(config, bet, mode),
    baseSpin: emptySpinResult(),
    triggered: false,
    freeSpins: [],
    baseWin: 0,
    freeSpinsWin: 0,
    totalWin: 0,
    payout: 0,
    capped: false,
  };
  playRound(c, mode, rng, summary, result);
  result.triggered = summary.triggered;
  result.baseWin = summary.baseWinX100 / 100;
  result.freeSpinsWin = summary.freeSpinsWinX100 / 100;
  result.totalWin = summary.totalWinX100 / 100;
  result.payout = Math.round(bet * summary.totalWinX100) / 100;
  result.capped = summary.capped;
  return result;
}

/**
 * Fast path for simulations: identical outcomes to `spin` for the same seed,
 * but only the numbers are kept. Pass a reusable `rng` and `summary` to avoid
 * allocating in hot loops.
 */
export function simulateRound(
  config: GameConfig,
  mode: Mode,
  seed: number,
  summary: RoundSummary = newRoundSummary(),
  rng?: Rng,
): RoundSummary {
  const c = compile(config);
  if (rng) rng.reseed(seed);
  playRound(c, mode, rng ?? new Rng(seed), summary, null);
  return summary;
}

// ---------------------------------------------------------------------------
// Small pure helpers (used by tests and the UI)
// ---------------------------------------------------------------------------

/** All symbol wins on a grid, without tumbling. */
export function findWins(config: GameConfig, symbols: readonly number[]): SymbolWin[] {
  const c = compile(config);
  if (symbols.length !== c.cells) throw new Error(`Expected ${c.cells} positions, got ${symbols.length}`);
  const wins: SymbolWin[] = [];
  for (let s = 0; s < c.nSym; s++) {
    const positions: number[] = [];
    for (let i = 0; i < c.cells; i++) if (symbols[i] === s) positions.push(i);
    const pay = c.payX100[s * (c.cells + 1) + positions.length];
    if (positions.length >= c.minCount) wins.push({ symbol: s, count: positions.length, positions, pay: pay / 100 });
  }
  return wins;
}

/** Payout (bet multiple) for `count` of a symbol anywhere on the grid. */
export function symbolPay(config: GameConfig, symbol: number, count: number): number {
  const c = compile(config);
  if (symbol < 0 || symbol >= c.nSym) throw new Error(`Unknown symbol ${symbol}`);
  return c.payX100[symbol * (c.cells + 1) + Math.max(0, Math.min(c.cells, count))] / 100;
}

/** Scatter payout (bet multiple) for `count` scatters. */
export function scatterPay(config: GameConfig, count: number): number {
  const c = compile(config);
  return c.scatterPayX100[Math.max(0, Math.min(c.cells, count))] / 100;
}

/** Total multiplier applied by a set of bombs (their values added together). */
export function bombMultiplier(bombs: readonly BombHit[]): number {
  let sum = 0;
  for (const b of bombs) sum += b.value;
  return sum > 0 ? sum : 1;
}

/**
 * Reference tumble: remove `removed`, drop the survivors, and fill the top of
 * each column with `incoming` symbols (given per column, top to bottom).
 */
export function collapse(
  config: GameConfig,
  grid: GridSnapshot,
  removed: readonly number[],
  incoming: ReadonlyArray<ReadonlyArray<{ symbol: number; bombValue?: number }>>,
): GridSnapshot {
  const { cols, rows } = config;
  const gone = new Set(removed);
  const symbols: number[] = new Array(cols * rows);
  const bombValues: number[] = new Array(cols * rows);
  for (let col = 0; col < cols; col++) {
    const keep: number[] = [];
    for (let row = 0; row < rows; row++) if (!gone.has(col * rows + row)) keep.push(col * rows + row);
    const fresh = incoming[col] ?? [];
    const missing = rows - keep.length;
    if (fresh.length !== missing) {
      throw new Error(`Column ${col} needs ${missing} incoming symbols, got ${fresh.length}`);
    }
    for (let row = 0; row < rows; row++) {
      const idx = col * rows + row;
      if (row < missing) {
        symbols[idx] = fresh[row].symbol;
        bombValues[idx] = fresh[row].bombValue ?? 0;
      } else {
        const from = keep[row - missing];
        symbols[idx] = grid.symbols[from];
        bombValues[idx] = grid.bombValues[from];
      }
    }
  }
  return { symbols, bombValues };
}
