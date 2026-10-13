import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, type Rng, tag } from './types';

/** Duel de sabres: an arrow flashes after a random wait, and the first one to strike that way scores. A false start locks you out of the round. */
const WIN_POINTS = 5;
const WAIT_MIN = 1.2;
const WAIT_MAX = 3.2;
/** If nobody strikes right, the round ends after this long (seconds). */
const SHOW_MAX = 3;
const RESULT_S = 1.4;

const ARROWS = ['▲', '▶', '▼', '◀'];
const NAMES = ['en haut', 'à droite', 'en bas', 'à gauche'];

type Phase = 'wait' | 'show' | 'result';

interface Duelist {
  points: number;
  /** Total reaction time of the points won (seconds), to settle ties. */
  total: number;
  locked: boolean;
  /** Set when the player struck wrong or too early this round. */
  fault: boolean;
}

export class SabreGame implements MiniGame {
  readonly kind = 'sabre' as const;
  readonly maxTime = 75;
  over = false;
  private t = 0;
  private phase: Phase = 'wait';
  private phaseT = 0;
  private waitFor: number;
  private dir = 0;
  private round = 1;
  private message = 'Prépare ta lame…';
  private winner = -1;
  private d = new Map<number, Duelist>();

  constructor(private players: MiniPlayer[], private rng: Rng = Math.random) {
    for (const p of players) this.d.set(p.id, { points: 0, total: 0, locked: false, fault: false });
    this.waitFor = this.nextWait();
  }

  private nextWait(): number {
    return WAIT_MIN + this.rng() * (WAIT_MAX - WAIT_MIN);
  }

  private name(id: number): string {
    return this.players.find((p) => p.id === id)?.name ?? '?';
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    this.phaseT += dt;
    if (this.phase === 'wait' && this.phaseT >= this.waitFor) {
      this.phase = 'show';
      this.phaseT = 0;
      this.dir = Math.floor(this.rng() * 4);
      this.message = '';
    } else if (this.phase === 'show' && this.phaseT >= SHOW_MAX) {
      this.endRound(-1);
    } else if (this.phase === 'result' && this.phaseT >= RESULT_S) {
      if ([...this.d.values()].some((x) => x.points >= WIN_POINTS)) this.over = true;
      else this.newRound();
    }
    if (this.t >= this.maxTime) this.over = true;
  }

  private newRound(): void {
    this.round++;
    this.phase = 'wait';
    this.phaseT = 0;
    this.waitFor = this.nextWait();
    this.winner = -1;
    this.message = 'Prépare ta lame…';
    for (const x of this.d.values()) {
      x.locked = false;
      x.fault = false;
    }
  }

  private endRound(winner: number): void {
    this.phase = 'result';
    this.phaseT = 0;
    this.winner = winner;
    this.message = winner >= 0 ? `${this.name(winner)} pare ${NAMES[this.dir]} en ${this.phaseTime.toFixed(2)} s` : 'Personne n’a paré à temps';
  }

  /** Reaction time of the winning strike, kept for the message. */
  private phaseTime = 0;

  input(id: number, input: MiniInput): void {
    const x = this.d.get(id);
    if (!x || this.over || input.a !== 'slash' || x.locked || this.phase === 'result') return;
    const dir = Math.floor(Number(input.d));
    if (!(dir >= 0 && dir <= 3)) return;
    if (this.phase === 'wait') {
      // Too early: locked out of this round.
      x.locked = true;
      x.fault = true;
      return;
    }
    if (dir !== this.dir) {
      x.locked = true;
      x.fault = true;
      return;
    }
    this.phaseTime = this.phaseT;
    x.points++;
    x.total += this.phaseT;
    this.endRound(id);
  }

  ranking(): number[] {
    return this.players
      .map((p) => p.id)
      .sort((a, b) => {
        const da = this.d.get(a) as Duelist;
        const db = this.d.get(b) as Duelist;
        const avgA = da.points ? da.total / da.points : 99;
        const avgB = db.points ? db.total / db.points : 99;
        return db.points - da.points || avgA - avgB || a - b;
      });
  }

  labels(): Record<number, string> {
    return Object.fromEntries(
      this.players.map((p) => {
        const x = this.d.get(p.id) as Duelist;
        const avg = x.points ? ` · ${Math.round((x.total / x.points) * 1000)} ms` : '';
        return [p.id, `${x.points} ${x.points > 1 ? 'points' : 'point'}${avg}`];
      }),
    );
  }

  render(ctx: CanvasRenderingContext2D): void {
    const flash = this.phase === 'show';
    ctx.fillStyle = flash ? '#3a0f1c' : '#14091f';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    ctx.textAlign = 'center';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(18,6,26,0.9)';

    ctx.font = '700 22px Nunito, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`Manche ${this.round} · premier à ${WIN_POINTS} points`, MINI_W / 2, 72);

    if (this.phase === 'wait') {
      ctx.font = '400 78px "Lilita One", sans-serif';
      ctx.fillStyle = '#9aa3ff';
      ctx.strokeText(this.message, MINI_W / 2, 270);
      ctx.fillText(this.message, MINI_W / 2, 270);
      ctx.font = '700 26px Nunito, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('Ne bouge pas : un coup trop tôt te bloque pour la manche.', MINI_W / 2, 330);
    } else if (this.phase === 'show') {
      ctx.font = '400 240px "Lilita One", sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.strokeText(ARROWS[this.dir], MINI_W / 2, 330);
      ctx.fillText(ARROWS[this.dir], MINI_W / 2, 330);
      ctx.font = '400 54px "Lilita One", sans-serif';
      ctx.fillStyle = '#ff5c8a';
      ctx.fillText(`PARE ${NAMES[this.dir].toUpperCase()} !`, MINI_W / 2, 410);
    } else {
      ctx.font = '400 54px "Lilita One", sans-serif';
      ctx.fillStyle = this.winner >= 0 ? '#3ecf8e' : '#ff9a3c';
      ctx.strokeText(this.message, MINI_W / 2, 290);
      ctx.fillText(this.message, MINI_W / 2, 290);
    }

    // The score of every player, with a false-start mark for this round.
    const n = this.players.length;
    const w = Math.min(150, (MINI_W - 40) / n);
    this.players.forEach((p, i) => {
      const x = this.d.get(p.id) as Duelist;
      const cx = MINI_W / 2 - ((n - 1) * w) / 2 + i * w;
      ctx.fillStyle = x.fault ? 'rgba(255,255,255,0.25)' : p.color;
      ctx.beginPath();
      ctx.arc(cx, 480, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#12061a';
      ctx.font = '400 30px "Lilita One", sans-serif';
      ctx.fillText(String(x.points), cx, 491);
      tag(ctx, p.name + (x.fault ? ' ✖' : ''), cx, 530, p.color);
      for (let k = 0; k < WIN_POINTS; k++) {
        ctx.fillStyle = k < x.points ? p.color : 'rgba(255,255,255,0.2)';
        ctx.fillRect(cx - (WIN_POINTS * 12) / 2 + k * 12, 545, 9, 9);
      }
    });
  }
}
