/** Turning the phone's motion into a sword strike. Pure functions, so they can be tested. */

/** Acceleration (m/s², gravity removed) a swing must reach to count. A phone at rest or carried gently stays well below it. */
export const SWING_THRESHOLD = 11;
/** Minimum time between two strikes (milliseconds): the stop at the end of a swing must not count as a second strike. */
export const SWING_COOLDOWN_MS = 500;

/**
 * The way of a swing, from the acceleration of the phone held upright with the screen facing you:
 * 0 up, 1 right, 2 down, 3 left, or null when the movement is too weak.
 * `invert` turns the directions around for phones whose sensor axes are reversed.
 */
export function swingDirection(ax: number, ay: number, invert = false, threshold = SWING_THRESHOLD): number | null {
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || Math.hypot(ax, ay) < threshold) return null;
  const d = Math.abs(ay) >= Math.abs(ax) ? (ay > 0 ? 0 : 2) : ax > 0 ? 1 : 3;
  return invert ? (d + 2) % 4 : d;
}

/** Takes gravity out of an acceleration that includes it (for phones that give nothing else), with a slow low-pass filter. */
export class GravityFilter {
  private g: [number, number] | null = null;

  remove(x: number, y: number): [number, number] {
    this.g = this.g ? [this.g[0] * 0.92 + x * 0.08, this.g[1] * 0.92 + y * 0.08] : [x, y];
    return [x - this.g[0], y - this.g[1]];
  }
}
