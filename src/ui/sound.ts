/**
 * Sound: three of Louis's own audio files (public/audio) plus a few small synthesised effects.
 *
 *   fond.mp3        background music while playing (loops)
 *   supprime.mp3    played every time symbols are cleared (each tumble)
 *   free-spins.mp3  music for the free spins feature (loops, replaces the background music)
 *
 * Browsers only allow audio after a click or key press, so the music starts with the first spin.
 */
type Wave = OscillatorType;

const AUDIO_DIR = `${import.meta.env.BASE_URL}audio/`;
const MUSIC_FILES = { base: 'fond.mp3', bonus: 'free-spins.mp3' } as const;
const SUPPRIME_FILE = 'supprime.mp3';
const DEFAULT_MUSIC_VOLUME = 0.45;
/** The "supprime" voice and the other effects: 1 is the normal level, up to MAX_BOOST times louder. */
const DEFAULT_BOOST = 1;
export const MAX_BOOST = 2;
const VOLUME_KEY = 'candy-cascade.volume.v2';
const SUPPRIME_BASE = 0.9;

function clamp(v: unknown, fallback: number, max = 1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
}

export type MusicTrack = keyof typeof MUSIC_FILES;

export class Sound {
  enabled = false;
  private ctx: AudioContext | null = null;
  private tracks: Partial<Record<MusicTrack, HTMLAudioElement>> = {};
  /** The track that should be playing, even while sound is off or the browser is still blocking audio. */
  private wanted: MusicTrack | null = null;
  private supprimeBuffer: AudioBuffer | null = null;
  private supprimeLoading = false;
  /** Two volume knobs after the music: the "supprime" voice and the other effects. A limiter keeps loud settings from crackling. */
  private voiceBus: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private musicVolume = DEFAULT_MUSIC_VOLUME;
  private voiceVolume = DEFAULT_BOOST;
  private fxVolume = DEFAULT_BOOST;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? 'null') as { music?: unknown; voice?: unknown; fx?: unknown } | null;
      this.musicVolume = clamp(saved?.music, DEFAULT_MUSIC_VOLUME);
      this.voiceVolume = clamp(saved?.voice, DEFAULT_BOOST, MAX_BOOST);
      this.fxVolume = clamp(saved?.fx, DEFAULT_BOOST, MAX_BOOST);
    } catch {
      // storage can be unavailable or hold junk: keep the defaults
    }
    // Music that stopped by itself (a refused play(), a mini game) starts again within a couple of seconds,
    // and at the first touch or key press, which is when the browser allows it.
    window.setInterval(() => this.resumeWanted(), 2500);
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => this.resumeWanted(), { passive: true });
    // Don't keep playing music in a background tab.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseAll();
      else this.resumeWanted();
    });
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  getVoiceVolume(): number {
    return this.voiceVolume;
  }

  getFxVolume(): number {
    return this.fxVolume;
  }

  /** 0 to 1. Applies at once, even to the music that is playing. */
  setMusicVolume(v: number): void {
    this.musicVolume = clamp(v, DEFAULT_MUSIC_VOLUME);
    for (const el of Object.values(this.tracks)) if (el) el.volume = this.musicVolume;
    this.saveVolumes();
  }

  /** 0 to MAX_BOOST: the "supprime" voice. */
  setVoiceVolume(v: number): void {
    this.voiceVolume = clamp(v, DEFAULT_BOOST, MAX_BOOST);
    if (this.voiceBus) this.voiceBus.gain.value = this.voiceVolume;
    this.saveVolumes();
  }

  /** 0 to MAX_BOOST: the small synthesised effects. */
  setFxVolume(v: number): void {
    this.fxVolume = clamp(v, DEFAULT_BOOST, MAX_BOOST);
    if (this.fxBus) this.fxBus.gain.value = this.fxVolume;
    this.saveVolumes();
  }

  private saveVolumes(): void {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ music: this.musicVolume, voice: this.voiceVolume, fx: this.fxVolume }));
    } catch {
      // not saved, still applied for this visit
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.context()?.resume().catch(() => {});
      void this.loadSupprime();
      this.resumeWanted();
    } else {
      this.pauseAll();
    }
  }

  // ------------------------------------------------------------------ music

  /** Switch to a music track. The background music resumes where it stopped; the bonus music starts over. */
  playMusic(track: MusicTrack): void {
    const changed = this.wanted !== track;
    this.wanted = track;
    if (!this.enabled) return;
    if (changed) {
      this.pauseAll();
      if (track === 'bonus') this.track('bonus').currentTime = 0;
    }
    this.resumeWanted();
  }

  private track(name: MusicTrack): HTMLAudioElement {
    let el = this.tracks[name];
    if (!el) {
      el = new Audio(AUDIO_DIR + MUSIC_FILES[name]);
      el.loop = true;
      el.volume = this.musicVolume;
      el.preload = 'auto';
      this.tracks[name] = el;
    }
    return el;
  }

  private resumeWanted(): void {
    if (!this.enabled || !this.wanted || document.hidden) return;
    const el = this.track(this.wanted);
    // play() is refused until the player has interacted with the page; the next spin tries again.
    if (el.paused) el.play().catch(() => {});
  }

  private pauseAll(): void {
    for (const el of Object.values(this.tracks)) el?.pause();
  }

  // ---------------------------------------------------- the "supprime" sound

  /** Played every time symbols are cleared. Overlaps cleanly if the next tumble comes before it ends. */
  supprime(): void {
    if (!this.enabled) return;
    const ctx = this.context();
    const buffer = this.supprimeBuffer;
    if (!ctx || !buffer) {
      void this.loadSupprime();
      return;
    }
    const source = ctx.createBufferSource();
    const amp = ctx.createGain();
    source.buffer = buffer;
    amp.gain.value = SUPPRIME_BASE;
    source.connect(amp).connect(this.output(ctx, 'voice'));
    source.start();
  }

  private async loadSupprime(): Promise<void> {
    if (this.supprimeBuffer || this.supprimeLoading) return;
    const ctx = this.context();
    if (!ctx) return;
    this.supprimeLoading = true;
    try {
      const response = await fetch(AUDIO_DIR + SUPPRIME_FILE);
      this.supprimeBuffer = await ctx.decodeAudioData(await response.arrayBuffer());
    } catch (err) {
      console.error('Could not load the supprime sound', err);
    } finally {
      this.supprimeLoading = false;
    }
  }

  // ------------------------------------------------------ synthesised effects

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Where a sound plugs in: its own gain node (one slider each), then a shared limiter. */
  private output(ctx: AudioContext, kind: 'voice' | 'fx'): AudioNode {
    if (!this.voiceBus || !this.fxBus) {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      limiter.connect(ctx.destination);
      this.voiceBus = ctx.createGain();
      this.voiceBus.gain.value = this.voiceVolume;
      this.voiceBus.connect(limiter);
      this.fxBus = ctx.createGain();
      this.fxBus.gain.value = this.fxVolume;
      this.fxBus.connect(limiter);
    }
    return kind === 'voice' ? this.voiceBus : this.fxBus;
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
    osc.connect(amp).connect(this.output(ctx, 'fx'));
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
