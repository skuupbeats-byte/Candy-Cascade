/**
 * Statistics accumulator for the simulator. Plain data, so chunks computed in
 * separate processes can be sent as JSON and merged.
 */
import { type GameConfig, type Mode, Rng, newRoundSummary, simulateRound } from '../engine';

/** Win-size buckets, as multiples of the bet: [from, to). The first bucket is "no win". */
export const BUCKET_EDGES = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

export function bucketLabels(maxWin: number): string[] {
  const labels = ['0 (no win)'];
  for (let i = 0; i < BUCKET_EDGES.length; i++) {
    const from = BUCKET_EDGES[i];
    const to = i + 1 < BUCKET_EDGES.length ? BUCKET_EDGES[i + 1] : maxWin;
    labels.push(i === 0 ? `under ${to}x` : `${from}x to ${to}x`);
  }
  labels.push(`${maxWin}x (max win)`);
  return labels;
}

export interface Stats {
  mode: Mode;
  rounds: number;
  /** Stake per round in hundredths of the bet (100, 125 or 10000). */
  costX100: number;
  sumTotal: number;
  sumBase: number;
  sumFree: number;
  sumSquares: number;
  hits: number;
  triggers: number;
  freeSpinsPlayed: number;
  capped: number;
  maxWinX100: number;
  maxWinSeed: number;
  bucketCounts: number[];
  bucketSums: number[];
  seedFrom: number;
  seedTo: number;
}

export function emptyStats(config: GameConfig, mode: Mode): Stats {
  const costX100 = mode === 'ante' ? config.ante.costMultiplier * 100 : mode === 'buy' ? config.buy.costMultiplier * 100 : 100;
  const n = BUCKET_EDGES.length + 2;
  return {
    mode,
    rounds: 0,
    costX100,
    sumTotal: 0,
    sumBase: 0,
    sumFree: 0,
    sumSquares: 0,
    hits: 0,
    triggers: 0,
    freeSpinsPlayed: 0,
    capped: 0,
    maxWinX100: 0,
    maxWinSeed: -1,
    bucketCounts: new Array(n).fill(0),
    bucketSums: new Array(n).fill(0),
    seedFrom: 0,
    seedTo: 0,
  };
}

/** Play rounds with seeds firstSeed, firstSeed + 1, ... and accumulate the numbers. */
export function runChunk(config: GameConfig, mode: Mode, firstSeed: number, rounds: number): Stats {
  const stats = emptyStats(config, mode);
  const rng = new Rng(0);
  const r = newRoundSummary();
  const edgesX100 = BUCKET_EDGES.map((e) => e * 100);
  const lastBucket = stats.bucketCounts.length - 1;
  stats.seedFrom = firstSeed;
  stats.seedTo = firstSeed + rounds - 1;

  for (let i = 0; i < rounds; i++) {
    const seed = firstSeed + i;
    simulateRound(config, mode, seed, r, rng);
    const win = r.totalWinX100;
    stats.sumTotal += win;
    stats.sumBase += r.baseWinX100;
    stats.sumFree += r.freeSpinsWinX100;
    stats.sumSquares += win * win;
    if (r.triggered) {
      stats.triggers++;
      stats.freeSpinsPlayed += r.freeSpinsPlayed;
    }
    if (win > stats.maxWinX100) {
      stats.maxWinX100 = win;
      stats.maxWinSeed = seed;
    }
    let bucket = 0;
    if (r.capped) {
      stats.capped++;
      bucket = lastBucket;
    } else if (win > 0) {
      bucket = 1;
      while (bucket < edgesX100.length && win >= edgesX100[bucket]) bucket++;
    }
    if (win > 0) stats.hits++;
    stats.bucketCounts[bucket]++;
    stats.bucketSums[bucket] += win;
  }
  stats.rounds = rounds;
  return stats;
}

export function mergeStats(a: Stats, b: Stats): Stats {
  if (a.mode !== b.mode) throw new Error('Cannot merge stats from different modes');
  const takeB = b.maxWinX100 > a.maxWinX100 || (b.maxWinX100 === a.maxWinX100 && b.maxWinSeed < a.maxWinSeed && b.maxWinSeed >= 0);
  return {
    mode: a.mode,
    rounds: a.rounds + b.rounds,
    costX100: a.costX100,
    sumTotal: a.sumTotal + b.sumTotal,
    sumBase: a.sumBase + b.sumBase,
    sumFree: a.sumFree + b.sumFree,
    sumSquares: a.sumSquares + b.sumSquares,
    hits: a.hits + b.hits,
    triggers: a.triggers + b.triggers,
    freeSpinsPlayed: a.freeSpinsPlayed + b.freeSpinsPlayed,
    capped: a.capped + b.capped,
    maxWinX100: Math.max(a.maxWinX100, b.maxWinX100),
    maxWinSeed: takeB || a.maxWinSeed < 0 ? b.maxWinSeed : a.maxWinSeed,
    bucketCounts: a.bucketCounts.map((v, i) => v + b.bucketCounts[i]),
    bucketSums: a.bucketSums.map((v, i) => v + b.bucketSums[i]),
    seedFrom: a.rounds === 0 ? b.seedFrom : b.rounds === 0 ? a.seedFrom : Math.min(a.seedFrom, b.seedFrom),
    seedTo: Math.max(a.seedTo, b.seedTo),
  };
}

/** Headline figures derived from the raw sums. */
export interface Summary {
  mode: Mode;
  rounds: number;
  /** Stake per round as a multiple of the bet. */
  cost: number;
  rtp: number;
  rtpBase: number;
  rtpFree: number;
  /** One standard error of the RTP estimate. */
  rtpStdError: number;
  /** Standard deviation of a round's win, in bets. */
  stdDev: number;
  hitFrequency: number;
  triggerFrequency: number;
  /** Average win of the free spins feature when it triggers, in bets. */
  avgFreeSpinsWin: number;
  avgFreeSpinsPlayed: number;
  maxWin: number;
  maxWinSeed: number;
  capped: number;
}

export function summarize(s: Stats): Summary {
  const n = Math.max(1, s.rounds);
  const mean = s.sumTotal / n;
  const variance = Math.max(0, s.sumSquares / n - mean * mean);
  return {
    mode: s.mode,
    rounds: s.rounds,
    cost: s.costX100 / 100,
    rtp: s.sumTotal / (n * s.costX100),
    rtpBase: s.sumBase / (n * s.costX100),
    rtpFree: s.sumFree / (n * s.costX100),
    rtpStdError: Math.sqrt(variance / n) / s.costX100,
    stdDev: Math.sqrt(variance) / 100,
    hitFrequency: s.hits / n,
    triggerFrequency: s.triggers / n,
    avgFreeSpinsWin: s.triggers > 0 ? s.sumFree / s.triggers / 100 : 0,
    avgFreeSpinsPlayed: s.triggers > 0 ? s.freeSpinsPlayed / s.triggers : 0,
    maxWin: s.maxWinX100 / 100,
    maxWinSeed: s.maxWinSeed,
    capped: s.capped,
  };
}
