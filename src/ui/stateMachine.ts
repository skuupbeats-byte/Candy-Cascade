/**
 * The round's state machine. It has no rendering in it: the game controller
 * moves it along as playback progresses, and the HUD listens to decide which
 * controls are available.
 *
 *   idle -> spinning -> tumbling -> idle                      (ordinary spin)
 *                                -> summary -> idle            (big win)
 *                                -> freeSpinIntro -> freeSpins -> summary -> idle
 *
 * While in `freeSpins` the individual free spins are tracked by `phase`
 * (spinning or tumbling), so the top-level state stays put for the feature.
 */
export type RoundState = 'idle' | 'spinning' | 'tumbling' | 'freeSpinIntro' | 'freeSpins' | 'summary';
export type SpinPhase = 'spinning' | 'tumbling';

const TRANSITIONS: Record<RoundState, readonly RoundState[]> = {
  idle: ['spinning'],
  spinning: ['tumbling'],
  tumbling: ['idle', 'summary', 'freeSpinIntro'],
  freeSpinIntro: ['freeSpins'],
  freeSpins: ['summary'],
  summary: ['idle'],
};

export type StateListener = (state: RoundState, previous: RoundState) => void;

export class RoundMachine {
  private current: RoundState = 'idle';
  private listeners = new Set<StateListener>();
  /** What the current free spin is doing; only meaningful in `freeSpins`. */
  phase: SpinPhase = 'spinning';

  get state(): RoundState {
    return this.current;
  }

  get isIdle(): boolean {
    return this.current === 'idle';
  }

  can(to: RoundState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  transition(to: RoundState): void {
    if (!this.can(to)) throw new Error(`Illegal round transition: ${this.current} -> ${to}`);
    const previous = this.current;
    this.current = to;
    if (to === 'freeSpins') this.phase = 'spinning';
    for (const listener of this.listeners) listener(to, previous);
  }

  /** Recover from an unexpected error: go straight back to idle. */
  reset(): void {
    const previous = this.current;
    this.current = 'idle';
    this.phase = 'spinning';
    if (previous !== 'idle') for (const listener of this.listeners) listener('idle', previous);
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
