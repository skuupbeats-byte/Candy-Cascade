import { describe, expect, it } from 'vitest';
import { Rng, randomSeed } from '../src/engine';

describe('Rng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('gives different sequences for neighbouring seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBeLessThan(3);
  });

  it('uses the high bits of large seeds', () => {
    const a = new Rng(7);
    const b = new Rng(7 + 2 ** 32);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it('reseed restarts the sequence', () => {
    const a = new Rng(99);
    const first = [a.nextU32(), a.nextU32(), a.nextU32()];
    a.reseed(99);
    expect([a.nextU32(), a.nextU32(), a.nextU32()]).toEqual(first);
  });

  it('int(n) stays in range and is roughly uniform', () => {
    const rng = new Rng(2024);
    const buckets = new Array(10).fill(0);
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const v = rng.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      buckets[v]++;
    }
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n * 0.005);
  });

  it('float() is in [0, 1)', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rejects invalid seeds', () => {
    expect(() => new Rng(-1)).toThrow();
    expect(() => new Rng(1.5)).toThrow();
    expect(() => new Rng(Number.NaN)).toThrow();
  });

  it('randomSeed returns a usable seed', () => {
    for (let i = 0; i < 100; i++) expect(() => new Rng(randomSeed())).not.toThrow();
  });
});
