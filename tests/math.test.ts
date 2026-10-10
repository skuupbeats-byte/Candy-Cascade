import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/engine';
import { combinedRtp } from '../src/sim/report';
import { emptyStats, mergeStats, runChunk, summarize } from '../src/sim/stats';

/**
 * Quick guards on the tuned math. The real verification is the simulator
 * (`npm run simulate`, results in MATH.md); these only catch an accidental
 * change to the weights. The paid spin on its own has low variance, so a
 * few hundred thousand spins pin it down well.
 */
describe('tuned math (smoke test)', () => {
  const base = runChunk(CONFIG, 'base', 1, 400_000);
  const buy = runChunk(CONFIG, 'buy', 1, 60_000);

  it('the paid spin returns about 72.5% of the bet', () => {
    const s = summarize(base);
    expect(s.rtpBase).toBeGreaterThan(0.705);
    expect(s.rtpBase).toBeLessThan(0.745);
  });

  it('about 38% of spins win something', () => {
    const s = summarize(base);
    expect(s.hitFrequency).toBeGreaterThan(0.367);
    expect(s.hitFrequency).toBeLessThan(0.387);
  });

  it('free spins trigger roughly once in 385 spins', () => {
    const s = summarize(base);
    expect(1 / s.triggerFrequency).toBeGreaterThan(330);
    expect(1 / s.triggerFrequency).toBeLessThan(450);
  });

  it('the buy feature returns roughly its price', () => {
    const s = summarize(buy);
    expect(s.rtp).toBeGreaterThan(0.9);
    expect(s.rtp).toBeLessThan(1.03);
    expect(s.triggerFrequency).toBe(1);
  });

  it('the combined estimate for the base game is near the target', () => {
    const rtp = combinedRtp(base, buy);
    expect(rtp).not.toBeNull();
    expect(Math.abs((rtp as number) - CONFIG.targetRtp)).toBeLessThan(0.06);
  });
});

describe('simulator statistics', () => {
  it('chunks merge to the same totals as one run', () => {
    const whole = runChunk(CONFIG, 'base', 1, 30_000);
    const merged = mergeStats(mergeStats(emptyStats(CONFIG, 'base'), runChunk(CONFIG, 'base', 1, 10_000)), runChunk(CONFIG, 'base', 10_001, 20_000));
    expect(merged.rounds).toBe(whole.rounds);
    expect(merged.sumTotal).toBe(whole.sumTotal);
    expect(merged.sumBase).toBe(whole.sumBase);
    expect(merged.hits).toBe(whole.hits);
    expect(merged.triggers).toBe(whole.triggers);
    expect(merged.maxWinX100).toBe(whole.maxWinX100);
    expect(merged.maxWinSeed).toBe(whole.maxWinSeed);
    expect(merged.bucketCounts).toEqual(whole.bucketCounts);
  });

  it('buckets account for every round', () => {
    const s = runChunk(CONFIG, 'ante', 5, 20_000);
    expect(s.bucketCounts.reduce((a, b) => a + b, 0)).toBe(20_000);
    expect(s.bucketSums.reduce((a, b) => a + b, 0)).toBe(s.sumTotal);
    expect(s.bucketCounts[0]).toBe(20_000 - s.hits);
    expect(s.costX100).toBe(125);
  });
});
