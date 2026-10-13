/**
 * The game controller. It owns the balance and settings, asks the engine for
 * a complete round, and then plays that result back through the scene while
 * moving the round state machine along.
 */
import { CONFIG, type Mode, type RoundResult, type SpinResult, type SymbolWin, randomSeed, roundCost, spin } from '../engine';
import { BATTLE } from '../battle/logic';
import { credits, isPointsMode, multiple, plural, setPointsMode } from './format';
import { Hud } from './hud';
import type { Scene } from './scene';
import { Sound } from './sound';
import { IconEditor } from './icons';
import { setupVolume } from './volume';
import { RoundMachine } from './stateMachine';
import { type Saved, load, save } from './store';
import { ease } from './tween';

const MINT = 0x58e0c0;
const TURBO_SPEED = 2.6;
/** Normal playback speed: a bit slower than the animations were first made, so free spins and battle spins are easier to follow. */
const BASE_SPEED = 0.7;
const IDLE_HINT = 'Press Spin or the spacebar to play';

/** Big-win sequence tiers, by round win as a multiple of the bet. */
const WIN_TIERS = [
  { from: 200, title: 'Colossal win', countMs: 3600 },
  { from: 60, title: 'Huge win', countMs: 2600 },
  { from: 20, title: 'Big win', countMs: 1700 },
];

export class Game {
  readonly machine = new RoundMachine();
  private hud: Hud;
  private sound = new Sound();
  private saved: Saved;
  /** Balance on screen. Trails the saved balance while a round's win is still being revealed. */
  private shownBalanceCents: number;
  private autoplayOn = false;
  private autoplayLeft = 0;
  private lastSeed: number | null = null;
  private winShown = 0;
  private winGeneration = 0;
  private symbolImages = new Map<number, Promise<string>>();
  /** Rounds played since the page loaded (handy for tests). */
  roundsPlayed = 0;
  /** In Battle mode, what the spacebar does. While set, the classic spin is off. */
  battleKey: (() => void) | null = null;

  constructor(private scene: Scene) {
    this.saved = load();
    this.shownBalanceCents = this.saved.balanceCents;
    this.sound.setEnabled(this.saved.sound);
    setupVolume(this.sound);
    const symbolIds = [...CONFIG.symbols.map((s) => s.id), 'scatter', 'bomb'];
    const icons = new IconEditor(this.scene, symbolIds, () => this.symbolImages.clear());
    void icons.applySaved();
    this.scene.anim.speed = this.saved.turbo ? TURBO_SPEED : BASE_SPEED;
    this.scene.grid.onColumnLand = (col) => this.sound.land(col);

    this.hud = new Hud({
      spin: () => void this.playOne(false),
      betStep: (direction) => this.stepBet(direction),
      toggleAnte: () => this.update(() => (this.saved.ante = !this.saved.ante)),
      requestBuy: () => this.requestBuy(),
      buy: () => void this.playOne(true),
      autoplay: (spins) => void this.startAutoplay(spins),
      stopAutoplay: () => this.stopAutoplay(),
      toggleTurbo: () => {
        this.update(() => (this.saved.turbo = !this.saved.turbo));
        this.scene.anim.speed = this.saved.turbo ? TURBO_SPEED : BASE_SPEED;
      },
      toggleSound: () => {
        this.update(() => (this.saved.sound = !this.saved.sound));
        this.sound.setEnabled(this.saved.sound);
        // Turning sound on between rounds starts the background music right away.
        if (this.saved.sound && this.machine.isIdle) this.sound.playMusic('base');
      },
      resetBalance: () => {
        if (!this.machine.isIdle) return;
        this.saved.balanceCents = Math.round(CONFIG.startingBalance * 100);
        this.shownBalanceCents = this.saved.balanceCents;
        save(this.saved);
        this.hud.setMessage(`Balance reset to ${credits(CONFIG.startingBalance)}`);
        this.render();
      },
      paytableInfo: () => ({ bet: this.saved.bet, lastSeed: this.lastSeed }),
      symbolImage: (code) => this.symbolImage(code),
    });

    this.machine.onChange(() => this.render());
    document.addEventListener('keydown', (event) => this.onKey(event));

    // Start on a settled board (a finished spin never shows a win).
    this.scene.grid.setGrid(spin(CONFIG, 1, 'base', randomSeed()).baseSpin.finalGrid);
    this.hud.setWin(0);
    this.hud.setMessage(IDLE_HINT);
    this.render();
  }

  get state(): string {
    return this.machine.state;
  }

  get balance(): number {
    return this.saved.balanceCents / 100;
  }

  get autoplaying(): boolean {
    return this.autoplayOn;
  }

  /** Symbol pictures for the paytable, made the first time each one is asked for. */
  private symbolImage(code: number): Promise<string> {
    let image = this.symbolImages.get(code);
    if (!image) {
      image = this.scene.symbolImage(code);
      this.symbolImages.set(code, image);
    }
    return image;
  }

  private render(): void {
    this.hud.render({
      balance: this.shownBalanceCents / 100,
      bet: this.saved.bet,
      ante: this.saved.ante,
      turbo: this.saved.turbo,
      sound: this.saved.sound,
      ready: this.machine.isIdle,
      autoplayOn: this.autoplayOn,
      autoplayLeft: this.autoplayLeft,
    });
  }

  private update(change: () => void): void {
    change();
    save(this.saved);
    this.render();
  }

  private stepBet(direction: -1 | 1): void {
    if (!this.machine.isIdle || this.autoplayOn) return;
    const bets = CONFIG.bets;
    const index = Math.max(0, Math.min(bets.length - 1, bets.indexOf(this.saved.bet) + direction));
    this.update(() => (this.saved.bet = bets[index]));
  }

  private onKey(event: KeyboardEvent): void {
    if (event.code !== 'Space' || event.repeat || this.hud.dialogOpen || document.querySelector('dialog[open]')) return;
    const target = event.target;
    // A focused button keeps its normal spacebar behaviour.
    if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    event.preventDefault();
    if (this.scene.bannerOpen) this.scene.dismissBanner();
    else if (this.battleKey) this.battleKey();
    else if (!this.autoplayOn) void this.playOne(false);
  }

  // ------------------------------------------------------------ battle mode

  /** True when no round is being played. */
  get isIdle(): boolean {
    return this.machine.isIdle;
  }

  /** Show or hide the Battle layout (players on top, battle buttons instead of the classic controls). */
  setBattleLook(on: boolean): void {
    document.getElementById('app')?.classList.toggle('mode-battle', on);
    setPointsMode(on);
    this.hud.setWin(0);
  }

  /** Write a line in the status area under the board. */
  say(text: string): void {
    this.hud.setMessage(text);
  }

  /** The sound of a hit landing on a player. */
  hitSound(): void {
    this.sound.bomb();
  }

  /**
   * One spin for a battle: a base round at a bet of 1 (or a bought free spins
   * round), played back in full without touching the classic balance.
   */
  /** Start the background music again if it stopped (after a mini game, say). */
  resumeMusic(): void {
    if (this.saved.sound) this.sound.playMusic('base');
  }

  async playBattleSpin(buy = false): Promise<RoundResult | null> {
    if (!this.machine.isIdle) return null;
    const seed = randomSeed();
    const result = spin(CONFIG, 1, buy ? 'buy' : 'base', seed);
    this.lastSeed = seed;
    await this.present(result);
    this.hud.setMessage('');
    // Battle: say clearly how many points this spin gave.
    const gained = Math.round(result.totalWin * BATTLE.pointsPerBet);
    if (gained > 0) await this.scene.floatText(`+${gained.toLocaleString('en-US')} points !`, undefined, undefined, undefined, 110);
    else await this.scene.floatText('Aucun point', undefined, undefined, 0xcdb2d8, 64);
    return result;
  }

  private requestBuy(): void {
    if (!this.machine.isIdle || this.autoplayOn || this.saved.ante) return;
    const cost = roundCost(CONFIG, this.saved.bet, 'buy');
    if (this.saved.balanceCents < Math.round(cost * 100)) {
      this.hud.setMessage(`Buying free spins costs ${credits(cost)}. Lower the bet or reset your balance.`, true);
      return;
    }
    this.hud.confirmBuy(cost, this.saved.bet);
  }

  // --------------------------------------------------------------- autoplay

  private async startAutoplay(spins: number): Promise<void> {
    if (!this.machine.isIdle || this.autoplayOn) return;
    this.autoplayOn = true;
    this.autoplayLeft = spins;
    while (this.autoplayLeft > 0) {
      this.autoplayLeft--;
      this.render();
      const played = await this.playOne(false);
      if (!played) break;
      if (this.autoplayLeft > 0) await this.scene.anim.wait(260);
    }
    this.autoplayOn = false;
    this.autoplayLeft = 0;
    this.render();
  }

  private stopAutoplay(): void {
    this.autoplayLeft = 0;
    this.render();
  }

  // ------------------------------------------------------------- one round

  /** Charge the stake, get a result from the engine and play it back. Returns false if no round was played. */
  private async playOne(buy: boolean): Promise<boolean> {
    if (!this.machine.isIdle) return false;
    const mode: Mode = buy ? 'buy' : this.saved.ante ? 'ante' : 'base';
    if (buy && this.saved.ante) return false;
    const bet = this.saved.bet;
    const cost = roundCost(CONFIG, bet, mode);
    const costCents = Math.round(cost * 100);
    if (this.saved.balanceCents < costCents) {
      this.hud.setMessage(`Not enough credits for a ${credits(cost)} stake. Lower the bet or reset your balance.`, true);
      return false;
    }

    const seed = randomSeed();
    const result = spin(CONFIG, bet, mode, seed);
    this.lastSeed = seed;
    // The outcome is already decided, so save the final balance now: closing the tab mid-animation loses nothing.
    this.shownBalanceCents = this.saved.balanceCents - costCents;
    this.saved.balanceCents = this.shownBalanceCents + Math.round(result.payout * 100);
    save(this.saved);

    await this.present(result);
    this.shownBalanceCents = this.saved.balanceCents;
    this.render();
    return true;
  }

  /**
   * Play back the round for a given seed without touching the balance.
   * For development: `__game.replay(12345, 'buy')` in the browser console.
   */
  async replay(seed: number, mode: Mode = 'base', bet = this.saved.bet): Promise<RoundResult | null> {
    if (!this.machine.isIdle) return null;
    const result = spin(CONFIG, bet, mode, seed);
    await this.present(result);
    return result;
  }

  private async present(result: RoundResult): Promise<void> {
    try {
      await this.playRound(result);
    } catch (err) {
      // Never leave the game stuck: show the final board and carry on.
      console.error('Playback failed', err);
      const last = result.freeSpins[result.freeSpins.length - 1] ?? result.baseSpin;
      this.scene.grid.setGrid(last.finalGrid);
      this.hud.setFreeSpins(null);
      this.setWinNow(result.payout);
      this.machine.reset();
      this.sound.playMusic('base');
    }
    this.roundsPlayed++;
  }

  private async playRound(result: RoundResult): Promise<void> {
    const { scene, hud, machine } = this;
    const { anim, grid } = scene;
    const bet = result.bet;
    const cap = CONFIG.maxWinMultiplier;

    this.setWinNow(0);
    hud.setMessage(result.mode === 'buy' ? 'Free spins bought' : '');
    machine.transition('spinning');
    // Background music for normal play. This runs inside the click or key press, which the browser needs to allow audio.
    this.sound.playMusic('base');
    this.sound.spin();
    await grid.dropIn(result.baseSpin.initialGrid);
    machine.transition('tumbling');
    await this.playSpin(result.baseSpin, bet);

    const feature = result.triggered && result.freeSpins.length > 0;
    if (feature) {
      machine.transition('freeSpinIntro');
      // Entering the free spins: the bonus music takes over from the background music.
      this.sound.playMusic('bonus');
      const awarded = result.baseSpin.freeSpinsAwarded;
      await scene.showBanner({
        title: 'Free spins',
        lines: [`${plural(result.baseSpin.scatterCount, 'lollipop')} landed`, `${awarded} free spins with multiplier bombs`],
        holdMs: 3400,
        color: MINT,
        symbolCode: CONFIG.symbols.length, // the lollipop (or the picture chosen for it) spins, grows and rains down
      });

      machine.transition('freeSpins');
      let left = awarded;
      let total = Math.min(cap, result.baseSpin.win);
      hud.setFreeSpins({ left, total: total * bet });
      for (let i = 0; i < result.freeSpins.length; i++) {
        const fs = result.freeSpins[i];
        left--;
        machine.phase = 'spinning';
        hud.setFreeSpins({ left, total: total * bet });
        hud.setMessage(`Free spin ${i + 1}`);
        this.setWinNow(0);
        this.sound.spin();
        await grid.dropIn(fs.initialGrid);
        machine.phase = 'tumbling';
        await this.playSpin(fs, bet);
        total = Math.min(cap, total + fs.win);
        const isLast = i === result.freeSpins.length - 1;
        if (fs.freeSpinsAwarded > 0 && !(isLast && result.capped)) {
          left += fs.freeSpinsAwarded;
          hud.setMessage(`${plural(fs.scatterCount, 'lollipop')}: ${fs.freeSpinsAwarded} more free spins`);
          hud.setFreeSpins({ left, total: total * bet });
          await scene.floatText(`+${fs.freeSpinsAwarded} free spins`, undefined, undefined, MINT, 72);
        }
        hud.setFreeSpins({ left, total: total * bet });
        await anim.wait(260);
      }
    }

    const tier = WIN_TIERS.find((t) => result.totalWin >= t.from);
    if (feature || tier || result.capped) {
      machine.transition('summary');
      if (tier || result.capped) this.sound.bigWin();
      const lines = [`${multiple(result.totalWin)} your bet`];
      if (feature) lines.push(`from ${plural(result.freeSpins.length, 'free spin')}`);
      if (result.capped) lines.push('The round ends at the max win');
      await scene.showBanner({
        title: result.capped ? 'Max win' : tier ? tier.title : 'Free spins over',
        lines,
        amount: { to: result.payout, format: credits, durationMs: tier ? tier.countMs : 1200 },
        confetti: Boolean(tier) || result.capped,
        holdMs: tier ? 2200 : 1700,
      });
      machine.transition('idle');
    } else {
      machine.transition('idle');
    }

    // The feature is over: back to the background music.
    if (feature) this.sound.playMusic('base');

    hud.setFreeSpins(null);
    this.setWinNow(result.payout);
    if (result.payout > 0) hud.setMessage(`You won ${credits(result.payout)}`);
    else if (!this.autoplayOn) hud.setMessage(IDLE_HINT);
    else hud.setMessage('');
  }

  /** Play one spin's tumbles, scatter pay and bombs. The grid must already show `initialGrid`. */
  private async playSpin(s: SpinResult, bet: number): Promise<void> {
    const { scene, hud } = this;
    const { anim, grid } = scene;
    let x = 0;

    for (let n = 0; n < s.steps.length; n++) {
      const step = s.steps[n];
      x += step.stepWin;
      this.sound.win(n);
      hud.setMessage(describeWins(step.wins));
      const cx = step.removed.reduce((sum, p) => sum + grid.cellX(p), 0) / step.removed.length;
      const cy = step.removed.reduce((sum, p) => sum + grid.cellY(p), 0) / step.removed.length;
      void scene.floatText(`+${credits(step.stepWin * bet)}`, cx, cy, undefined, isPointsMode() ? 96 : 64);
      void this.countWin(x * bet, 400);
      await grid.highlight(step.removed);
      // The fruits break: play the "supprime" sound, on every tumble.
      this.sound.supprime();
      await grid.pop(step.removed);
      await grid.tumble(step.removed, step.gridAfter);
      await anim.wait(90);
    }

    if (s.scatterWin > 0 || s.freeSpinsAwarded > 0) {
      this.sound.scatter();
      if (s.scatterWin > 0) {
        x += s.scatterWin;
        hud.setMessage(`${plural(s.scatterCount, 'lollipop')} pay ${multiple(s.scatterWin)} your bet`);
        void scene.floatText(`+${credits(s.scatterWin * bet)}`);
        void this.countWin(x * bet, 400);
      }
      await grid.pulse(s.scatterPositions);
    }

    if (s.bombs.length > 0) {
      if (x > 0) {
        const sum = await scene.collectBombs(s.bombs, () => this.sound.bomb());
        hud.setMessage(
          s.bombs.length > 1
            ? `Bombs add up to x${sum}: ${credits(x * bet)} becomes ${credits(s.win * bet)}`
            : `x${sum} bomb: ${credits(x * bet)} becomes ${credits(s.win * bet)}`,
        );
        void scene.floatText(`x${sum}`, undefined, undefined, undefined, 96);
        await this.countWin(s.win * bet, 700);
        await anim.wait(250);
        await scene.hideMultiplier();
      } else {
        hud.setMessage(s.bombs.length > 1 ? 'No win this spin, so the bombs have nothing to multiply' : 'No win this spin, so the bomb has nothing to multiply');
        await anim.wait(450);
      }
    }
  }

  private setWinNow(value: number): void {
    this.winGeneration++;
    this.winShown = value;
    this.hud.setWin(value);
  }

  /** Count the win display up to `target`. A newer call takes over from an older one. */
  private countWin(target: number, durationMs: number): Promise<void> {
    const generation = ++this.winGeneration;
    const from = this.winShown;
    return this.scene.anim
      .tween(durationMs, (t) => {
        if (generation !== this.winGeneration) return;
        this.winShown = from + (target - from) * t;
        this.hud.setWin(this.winShown);
      }, ease.outQuad)
      .then(() => {
        if (generation === this.winGeneration) this.setWinNow(target);
      });
  }
}

function describeWins(wins: readonly SymbolWin[]): string {
  return wins
    .map((w) => (isPointsMode() ? `${w.count} x ${CONFIG.symbols[w.symbol].name} = +${credits(w.pay)}` : `${w.count} x ${CONFIG.symbols[w.symbol].name} pays ${multiple(w.pay)}`))
    .join(', ');
}
