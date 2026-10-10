import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/engine';
import { credits, multiple, plural } from '../src/ui/format';
import { RoundMachine, type RoundState } from '../src/ui/stateMachine';
import { defaults, sanitize } from '../src/ui/store';

describe('round state machine', () => {
  const walk = (m: RoundMachine, path: RoundState[]) => path.forEach((s) => m.transition(s));

  it('starts idle', () => {
    const m = new RoundMachine();
    expect(m.state).toBe('idle');
    expect(m.isIdle).toBe(true);
  });

  it('plays an ordinary spin: idle, spinning, tumbling, idle', () => {
    const m = new RoundMachine();
    walk(m, ['spinning', 'tumbling', 'idle']);
    expect(m.isIdle).toBe(true);
  });

  it('plays a big win through the summary', () => {
    const m = new RoundMachine();
    walk(m, ['spinning', 'tumbling', 'summary', 'idle']);
    expect(m.isIdle).toBe(true);
  });

  it('plays a feature: intro, free spins, summary', () => {
    const m = new RoundMachine();
    walk(m, ['spinning', 'tumbling', 'freeSpinIntro', 'freeSpins']);
    expect(m.phase).toBe('spinning');
    m.phase = 'tumbling';
    walk(m, ['summary', 'idle']);
    expect(m.isIdle).toBe(true);
  });

  it('rejects illegal transitions', () => {
    const m = new RoundMachine();
    expect(() => m.transition('tumbling')).toThrow(/idle -> tumbling/);
    expect(() => m.transition('freeSpins')).toThrow();
    expect(() => m.transition('idle')).toThrow();
    m.transition('spinning');
    expect(() => m.transition('spinning')).toThrow();
    expect(() => m.transition('idle')).toThrow();
    walk(m, ['tumbling', 'freeSpinIntro']);
    expect(() => m.transition('summary')).toThrow();
    m.transition('freeSpins');
    expect(() => m.transition('idle')).toThrow();
    expect(m.can('summary')).toBe(true);
    expect(m.can('spinning')).toBe(false);
  });

  it('notifies listeners and can unsubscribe', () => {
    const m = new RoundMachine();
    const seen = vi.fn();
    const off = m.onChange(seen);
    m.transition('spinning');
    expect(seen).toHaveBeenCalledWith('spinning', 'idle');
    off();
    m.transition('tumbling');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reset returns to idle from anywhere', () => {
    const m = new RoundMachine();
    const seen = vi.fn();
    walk(m, ['spinning', 'tumbling', 'freeSpinIntro', 'freeSpins']);
    m.onChange(seen);
    m.reset();
    expect(m.isIdle).toBe(true);
    expect(seen).toHaveBeenCalledWith('idle', 'freeSpins');
    m.reset();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('saved state', () => {
  it('defaults to the starting balance and default bet, with sound off', () => {
    const d = defaults();
    expect(d.balanceCents).toBe(CONFIG.startingBalance * 100);
    expect(d.bet).toBe(CONFIG.defaultBet);
    expect(d.sound).toBe(false);
    expect(d.ante).toBe(false);
    expect(d.turbo).toBe(false);
  });

  it('keeps valid values', () => {
    const s = sanitize({ balanceCents: 12345, bet: 7.5, ante: true, turbo: true, sound: true });
    expect(s).toEqual({ balanceCents: 12345, bet: 7.5, ante: true, turbo: true, sound: true });
  });

  it('replaces anything malformed with defaults', () => {
    const d = defaults();
    expect(sanitize(null)).toEqual(d);
    expect(sanitize('nonsense')).toEqual(d);
    expect(sanitize({ balanceCents: -5, bet: 3.33, ante: 'yes', turbo: 1 })).toEqual(d);
    expect(sanitize({ balanceCents: 1.5 }).balanceCents).toBe(d.balanceCents);
    expect(sanitize({ balanceCents: 0 }).balanceCents).toBe(0);
  });
});

describe('formatting', () => {
  it('formats credits with two decimals', () => {
    expect(credits(0)).toBe('0.00');
    expect(credits(1234.5)).toBe('1,234.50');
    expect(credits(0.2)).toBe('0.20');
  });

  it('formats bet multiples', () => {
    expect(multiple(21100)).toBe('21,100x');
    expect(multiple(0.25)).toBe('0.25x');
    expect(multiple(100)).toBe('100x');
  });

  it('pluralises', () => {
    expect(plural(1, 'free spin')).toBe('1 free spin');
    expect(plural(4, 'lollipop')).toBe('4 lollipops');
  });
});
