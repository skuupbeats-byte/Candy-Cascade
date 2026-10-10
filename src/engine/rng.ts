/**
 * Seedable pseudo-random number generator (xoshiro128**), seeded through
 * splitmix32 so that nearby seeds (1, 2, 3 ...) give unrelated streams.
 *
 * Seeds are non-negative integers below 2^53. The same seed always produces
 * the same sequence, on every platform, which is what makes a spin
 * reproducible from its seed.
 */

export const MAX_SEED = Number.MAX_SAFE_INTEGER;

function splitmix32(state: number): () => number {
  let a = state | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number) {
    this.reseed(seed);
  }

  /** Re-initialise in place (avoids allocating in simulation hot loops). */
  reseed(seed: number): void {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error(`Seed must be an integer between 0 and ${MAX_SEED}, got ${seed}`);
    }
    const lo = seed >>> 0;
    const hi = Math.floor(seed / 4294967296) >>> 0;
    const mixLo = splitmix32(lo);
    const mixHi = splitmix32(hi ^ 0x5bd1e995);
    this.s0 = mixLo() ^ mixHi();
    this.s1 = mixLo() ^ mixHi();
    this.s2 = mixLo() ^ mixHi();
    this.s3 = mixLo() ^ mixHi();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    // Warm up so the first outputs are well mixed.
    for (let i = 0; i < 8; i++) this.nextU32();
  }

  /** Uniform unsigned 32-bit integer. */
  nextU32(): number {
    const s1 = this.s1;
    const r = Math.imul(s1, 5);
    const result = Math.imul((r << 7) | (r >>> 25), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = (this.s3 << 11) | (this.s3 >>> 21);
    return result;
  }

  /** Uniform integer in [0, n). n must be at most 2^20 to stay exact. */
  int(n: number): number {
    return Math.floor((this.nextU32() * n) / 4294967296);
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.nextU32() / 4294967296;
  }
}

/** A fresh random seed for interactive play (not used by the engine itself). */
export function randomSeed(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto?.getRandomValues) {
    const buf = g.crypto.getRandomValues(new Uint32Array(2));
    return (buf[0] & 0x1fffff) * 4294967296 + buf[1];
  }
  return Math.floor(Math.random() * MAX_SEED);
}
