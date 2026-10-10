/** A tiny promise-based tween runner driven by the Pixi ticker. */
import type { Ticker } from 'pixi.js';

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  outBack: (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
  /** Falls, then settles with one small bounce: used for landing symbols. */
  land: (t: number) => {
    const split = 0.72;
    if (t < split) return (t / split) ** 2;
    const u = (t - split) / (1 - split);
    return 1 - 0.07 * Math.sin(u * Math.PI);
  },
  /** 0 -> 1 -> 0, for pulses. */
  pulse: (t: number) => Math.sin(t * Math.PI),
} satisfies Record<string, Ease>;

interface Item {
  elapsed: number;
  delay: number;
  duration: number;
  update: (t: number) => void;
  easing: Ease;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class Animator {
  /** Playback speed. Turbo mode raises this. */
  speed = 1;
  private items = new Set<Item>();

  constructor(ticker: Ticker) {
    ticker.add((t) => this.update(t.deltaMS));
  }

  /** Run `update(easedProgress)` from 0 to 1 over `duration` ms, after an optional delay. */
  tween(duration: number, update: (t: number) => void, easing: Ease = ease.linear, delay = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      this.items.add({ elapsed: 0, delay, duration: Math.max(1, duration), update, easing, resolve, reject });
    });
  }

  wait(ms: number): Promise<void> {
    return this.tween(ms, () => {});
  }

  private update(deltaMs: number): void {
    // A background tab can deliver one huge frame; keep it from skipping whole animations.
    const dt = Math.min(deltaMs, 100) * this.speed;
    for (const item of [...this.items]) {
      item.elapsed += dt;
      const t = (item.elapsed - item.delay) / item.duration;
      if (t < 0) continue;
      try {
        item.update(item.easing(Math.min(1, t)));
      } catch (err) {
        this.items.delete(item);
        item.reject(err);
        continue;
      }
      if (t >= 1) {
        this.items.delete(item);
        item.resolve();
      }
    }
  }
}
