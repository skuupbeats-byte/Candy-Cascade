import { describe, expect, it } from 'vitest';
import { GravityFilter, SWING_THRESHOLD, swingDirection } from '../src/controller/gesture';

describe('sword gestures', () => {
  it('ignores weak movements', () => {
    expect(swingDirection(2, 3)).toBeNull();
    expect(swingDirection(0, SWING_THRESHOLD - 1)).toBeNull();
    expect(swingDirection(Number.NaN, 30)).toBeNull();
  });
  it('reads the four directions from the strongest axis', () => {
    expect(swingDirection(1, 20)).toBe(0);
    expect(swingDirection(20, -3)).toBe(1);
    expect(swingDirection(-2, -20)).toBe(2);
    expect(swingDirection(-20, 4)).toBe(3);
  });
  it('can turn the directions around', () => {
    expect(swingDirection(1, 20, true)).toBe(2);
    expect(swingDirection(20, 0, true)).toBe(3);
  });
  it('takes gravity out, so a phone at rest does not strike', () => {
    const f = new GravityFilter();
    let last: [number, number] = [0, 0];
    for (let i = 0; i < 100; i++) last = f.remove(0.3, 9.8);
    expect(Math.hypot(last[0], last[1])).toBeLessThan(0.5);
    // A sudden push up shows clearly.
    const [, y] = f.remove(0.3, 9.8 + 18);
    expect(y).toBeGreaterThan(SWING_THRESHOLD);
  });
});
