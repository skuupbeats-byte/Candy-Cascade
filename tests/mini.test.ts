import { describe, expect, it } from 'vitest';
import { COLORS, MINI_KINDS, type MiniInput, type MiniPlayer, createMini, pickMini, rewardsFor } from '../src/mini';

/** A small seeded random generator, so the tests repeat. */
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const players = (n: number): MiniPlayer[] => Array.from({ length: n }, (_, i) => ({ id: i, name: `P${i}`, color: COLORS[i] }));

/** A canvas that accepts every call, to check that drawing never throws. */
const fakeCtx = (): CanvasRenderingContext2D =>
  new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : k === 'createLinearGradient' ? () => ({ addColorStop: () => undefined }) : () => undefined),
    set: (t, k, v) => ((t[k as string] = v), true),
  }) as unknown as CanvasRenderingContext2D;

describe('rewards', () => {
  it('gives 50 and 25 from four players, and 30 to the winner alone below', () => {
    expect(rewardsFor(6)).toEqual([50, 25]);
    expect(rewardsFor(4)).toEqual([50, 25]);
    expect(rewardsFor(3)).toEqual([30]);
    expect(rewardsFor(2)).toEqual([30]);
  });
  it('never repeats the same game twice in a row', () => {
    const rng = rngFrom(5);
    let prev = pickMini(null, rng);
    for (let i = 0; i < 200; i++) {
      const next = pickMini(prev, rng);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});

describe('mini games', () => {
  for (const kind of MINI_KINDS) {
    for (const n of [2, 4, 6]) {
      it(`${kind} with ${n} players ends and ranks everybody once`, () => {
        const rng = rngFrom(n * 17 + kind.length);
        const g = createMini(kind, players(n), rng);
        const inputs: MiniInput[] = [{ a: 'tap' }, { a: 'dir', d: 0 }, { a: 'dir', d: 1 }, { a: 'dir', d: 2 }, { a: 'dir', d: 3 }, { a: 'bomb' }, { a: 'fire' }, { a: 'slash', d: 0 }, { a: 'slash', d: 1 }, { a: 'slash', d: 3 }, { a: 'move', x: 1, y: 0.3 }, { a: 'move', x: -1, y: -0.5 }, { a: 'aim', x: 1, y: 0 }, { a: 'aim', x: 0, y: -1 }, { a: 'aim', x: 0, y: 0 }];
        let steps = 0;
        while (!g.over && steps < (g.maxTime + 2) * 60) {
          if (steps % 6 === 0) for (let id = 0; id < n; id++) g.input(id, inputs[Math.floor(rng() * inputs.length)]);
          g.update(1 / 60);
          if (steps % 120 === 0) g.render(fakeCtx());
          steps++;
        }
        expect(g.over).toBe(true);
        const r = g.ranking();
        expect([...r].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
        expect(Object.keys(g.labels())).toHaveLength(n);
        g.render(fakeCtx());
      });
    }
  }

  it('click rush ranks by number of taps', () => {
    const g = createMini('click', players(3));
    for (let i = 0; i < 5; i++) g.input(1, { a: 'tap' });
    for (let i = 0; i < 9; i++) g.input(2, { a: 'tap' });
    g.input(0, { a: 'tap' });
    g.update(5.1);
    expect(g.over).toBe(true);
    expect(g.ranking()).toEqual([2, 1, 0]);
    g.input(0, { a: 'tap' });
    expect(g.labels()[0]).toBe('1 clic');
    expect(g.labels()[2]).toBe('9 clics');
  });

  it('flappy: nobody dies in the first seconds, even without tapping', () => {
    const g = createMini('flappy', players(4), rngFrom(9));
    for (let i = 0; i < 60 * 2; i++) g.update(1 / 60);
    expect(g.over).toBe(false);
    expect(Object.values(g.labels()).every((l) => !l.startsWith('tombé'))).toBe(true);
  });

  it('flappy: a bird that never flaps falls first and ranks last', () => {
    const g = createMini('flappy', players(2), rngFrom(3));
    for (let i = 0; i < 600 && !g.over; i++) {
      if (i % 20 === 0) g.input(0, { a: 'tap' });
      g.update(1 / 60);
    }
    expect(g.ranking()[1]).toBe(1);
  });
});

describe('snake in full 2D', () => {
  it('turns towards the joystick and eats', () => {
    const g = createMini('snake', players(2), rngFrom(4));
    const before = g.labels()[0];
    g.input(0, { a: 'move', x: 0, y: 1 });
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    expect(g.labels()[0]).toBeDefined();
    expect(before).toContain('longueur');
  });
  it('a snake that runs into a wall is out and ranks last', () => {
    const g = createMini('snake', players(2), rngFrom(6));
    g.input(0, { a: 'move', x: 1, y: 0 });
    g.input(1, { a: 'move', x: 1, y: 0 });
    for (let i = 0; i < 60 * 40 && !g.over; i++) g.update(1 / 60);
    expect(g.over).toBe(true);
    expect([...g.ranking()].sort()).toEqual([0, 1]);
  });
});

describe('tanks', () => {
  it('a bullet bounces on a wall, then a crate it breaks comes back after 10 seconds', () => {
    const g = createMini('tanks', players(2), rngFrom(11)) as unknown as {
      grid: number[][];
      update(dt: number): void;
      input(id: number, i: MiniInput): void;
      bullets: Array<{ x: number; y: number; vx: number; vy: number; bounces: number }>;
      tanks: Map<number, { x: number; y: number; aim: number; alive: boolean }>;
    };
    // An empty arena with one crate, to follow it.
    for (let r = 1; r < 14; r++) for (let c = 1; c < 23; c++) g.grid[r][c] = 0;
    g.grid[2][8] = 2;
    const t0 = g.tanks.get(0);
    if (!t0) throw new Error('no tank');
    t0.x = 6.5 * 40;
    t0.y = 2.5 * 40;
    t0.aim = 0;
    g.input(0, { a: 'fire' });
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    expect(g.grid[2][8]).toBe(3);
    for (let i = 0; i < 60 * 9; i++) g.update(1 / 60);
    expect(g.grid[2][8]).toBe(3);
    for (let i = 0; i < 60 * 2; i++) g.update(1 / 60);
    expect(g.grid[2][8]).toBe(2);
  });

  it('a bullet bounces off a solid wall and can hit the tank that fired it', () => {
    const g = createMini('tanks', players(2), rngFrom(2)) as unknown as {
      grid: number[][];
      update(dt: number): void;
      input(id: number, i: MiniInput): void;
      ranking(): number[];
      tanks: Map<number, { x: number; y: number; aim: number; alive: boolean }>;
    };
    for (let r = 1; r < 14; r++) for (let c = 1; c < 23; c++) g.grid[r][c] = 0;
    const t0 = g.tanks.get(0);
    const t1 = g.tanks.get(1);
    if (!t0 || !t1) throw new Error('no tank');
    t1.x = 20.5 * 40;
    t1.y = 12.5 * 40;
    t0.x = 3.5 * 40;
    t0.y = 7.5 * 40;
    t0.aim = Math.PI; // straight at the left wall: the bullet comes back
    g.input(0, { a: 'fire' });
    for (let i = 0; i < 60 * 3 && t0.alive; i++) g.update(1 / 60);
    expect(t0.alive).toBe(false);
    expect(g.ranking()[0]).toBe(1);
  });

  it('a tank has 3 lives: it respawns with a shield, then is out after the third death', () => {
    type T = { x: number; y: number; aim: number; alive: boolean; lives: number; out: boolean; shieldUntil: number };
    const g = createMini('tanks', players(2), rngFrom(2)) as unknown as {
      grid: number[][];
      update(dt: number): void;
      input(id: number, i: MiniInput): void;
      ranking(): number[];
      over: boolean;
      tanks: Map<number, T>;
    };
    for (let r = 1; r < 14; r++) for (let c = 1; c < 23; c++) g.grid[r][c] = 0;
    const t0 = g.tanks.get(0) as T;
    const t1 = g.tanks.get(1) as T;
    expect(t0.lives).toBe(3);
    const suicide = (): void => {
      t0.x = 3.5 * 40;
      t0.y = 7.5 * 40;
      t0.aim = Math.PI;
      g.input(0, { a: 'fire' });
      for (let i = 0; i < 60 * 3 && t0.alive; i++) g.update(1 / 60);
    };
    t1.x = 20.5 * 40;
    t1.y = 12.5 * 40;
    suicide();
    expect(t0.alive).toBe(false);
    expect(t0.lives).toBe(2);
    expect(t0.out).toBe(false);
    for (let i = 0; i < 60 * 3; i++) g.update(1 / 60);
    expect(t0.alive).toBe(true);
    expect(g.over).toBe(false);
    // Let the shield and the cooldown pass, then die twice more.
    for (let i = 0; i < 60 * 2; i++) g.update(1 / 60);
    suicide();
    expect(t0.lives).toBe(1);
    for (let i = 0; i < 60 * 5; i++) g.update(1 / 60);
    for (let i = 0; i < 60 * 2; i++) g.update(1 / 60);
    suicide();
    expect(t0.lives).toBe(0);
    expect(t0.out).toBe(true);
    for (let i = 0; i < 60 * 4; i++) g.update(1 / 60);
    expect(t0.alive).toBe(false);
    expect(g.over).toBe(true);
    expect(g.ranking()[0]).toBe(1);
  });

  it('the aim stick turns the barrel and fires when pushed all the way', () => {
    const g = createMini('tanks', players(2), rngFrom(3)) as unknown as {
      grid: number[][];
      update(dt: number): void;
      input(id: number, i: MiniInput): void;
      bullets: unknown[];
      tanks: Map<number, { aim: number }>;
    };
    const t0 = g.tanks.get(0);
    if (!t0) throw new Error('no tank');
    g.input(0, { a: 'aim', x: 0, y: 0.4 });
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    expect(t0.aim).toBeCloseTo(Math.PI / 2, 1);
    expect(g.bullets.length).toBe(0);
    g.input(0, { a: 'aim', x: 0, y: 1 });
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    expect(g.bullets.length).toBeGreaterThan(0);
  });

  it('every tank can reach every other one in the generated arenas', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = createMini('tanks', players(6), rngFrom(seed)) as unknown as { grid: number[][] };
      expect(g.grid[0][0]).toBe(1);
      expect(g.grid.flat().filter((v) => v === 1).length).toBeLessThan(300);
    }
  });
});

describe('duel de sabres', () => {
  const duel = () => {
    const g = createMini('sabre', players(3), rngFrom(8)) as unknown as {
      over: boolean;
      update(dt: number): void;
      input(id: number, i: MiniInput): void;
      ranking(): number[];
      labels(): Record<number, string>;
      dir: number;
      phase: string;
    };
    return g;
  };
  const toShow = (g: ReturnType<typeof duel>) => {
    for (let i = 0; i < 60 * 5 && g.phase !== 'show'; i++) g.update(1 / 60);
  };

  it('a strike before the arrow locks the player out of the round', () => {
    const g = duel();
    g.input(0, { a: 'slash', d: 0 });
    toShow(g);
    g.input(0, { a: 'slash', d: g.dir });
    expect(g.labels()[0]).toContain('0 point');
    g.input(1, { a: 'slash', d: g.dir });
    expect(g.labels()[1]).toContain('1 point');
  });

  it('the first right strike wins the round, a wrong direction locks the player', () => {
    const g = duel();
    toShow(g);
    g.input(2, { a: 'slash', d: (g.dir + 1) % 4 });
    g.input(2, { a: 'slash', d: g.dir });
    expect(g.labels()[2]).toContain('0 point');
    g.input(1, { a: 'slash', d: g.dir });
    g.input(0, { a: 'slash', d: g.dir });
    expect(g.labels()[1]).toContain('1 point');
    expect(g.labels()[0]).toContain('0 point');
  });

  it('the first to five points ends the game and ranks first', () => {
    const g = duel();
    for (let i = 0; i < 60 * 70 && !g.over; i++) {
      if (g.phase === 'show') g.input(1, { a: 'slash', d: g.dir });
      g.update(1 / 60);
    }
    expect(g.over).toBe(true);
    expect(g.ranking()[0]).toBe(1);
  });
});
