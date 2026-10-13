/** Saved game state: play-money balance and preferences, kept in localStorage. */
import { CONFIG } from '../engine';

const KEY = 'candy-cascade:v1';

export interface Saved {
  /** Balance in cents, to keep the arithmetic exact. */
  balanceCents: number;
  bet: number;
  ante: boolean;
  turbo: boolean;
  sound: boolean;
}

export function defaults(): Saved {
  return {
    balanceCents: Math.round(CONFIG.startingBalance * 100),
    bet: CONFIG.defaultBet,
    ante: false,
    turbo: false,
    // On by default now that the game has its own music (it still only starts after the first click).
    sound: true,
  };
}

/** Merge whatever was stored with the defaults, discarding anything malformed. */
export function sanitize(raw: unknown): Saved {
  const d = defaults();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Partial<Record<keyof Saved, unknown>>;
  const balance = r.balanceCents;
  return {
    balanceCents: typeof balance === 'number' && Number.isSafeInteger(balance) && balance >= 0 ? balance : d.balanceCents,
    bet: typeof r.bet === 'number' && CONFIG.bets.includes(r.bet) ? r.bet : d.bet,
    ante: typeof r.ante === 'boolean' ? r.ante : d.ante,
    turbo: typeof r.turbo === 'boolean' ? r.turbo : d.turbo,
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
  };
}

export function load(): Saved {
  try {
    const text = localStorage.getItem(KEY);
    return sanitize(text ? JSON.parse(text) : null);
  } catch {
    return defaults();
  }
}

export function save(state: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private windows); the game still works for the session.
  }
}
