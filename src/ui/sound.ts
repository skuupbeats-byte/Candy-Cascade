/** Optional sound effects, synthesised with WebAudio so there are no audio files to load. Off by default. */
type Wave = OscillatorType;

export class Sound {
  enabled = false;
  private ctx: AudioContext | null = null;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.context()?.resume().catch(() => {});
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, wave: Wave = 'sine', gain = 0.08, delay = 0, slideTo?: number): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  spin(): void {
    this.tone(220, 0.18, 'triangle', 0.06, 0, 440);
  }

  land(column: number): void {
    this.tone(150 + column * 14, 0.07, 'sine', 0.05);
  }

  win(step: number): void {
    const base = 523 * 2 ** (Math.min(step, 8) / 12);
    this.tone(base, 0.14, 'triangle', 0.08);
    this.tone(base * 1.5, 0.2, 'triangle', 0.06, 0.08);
  }

  pop(): void {
    this.tone(700, 0.09, 'square', 0.03, 0, 240);
  }

  scatter(): void {
    [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, i * 0.09));
  }

  bomb(): void {
    this.tone(180, 0.3, 'sawtooth', 0.06, 0, 60);
    this.tone(880, 0.25, 'triangle', 0.05, 0.05, 1760);
  }

  bigWin(): void {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.08, i * 0.11));
  }
}
