import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, type Rng, clamp, rankSurvival, tag } from './types';

/** Everything is drawn straight in the logical screen (960 x 600): one screen, every bird on it. */
const H = MINI_H;
const GRAVITY = 1800;
const FLAP = -560;
const GAP = 210;
const PIPE_W = 76;
const SPACING = 340;
const FIRST = 900;
const R = 15;
/** The first bird sits here; the others follow a little further right so they can all be told apart. */
const BIRD_X = 150;
const BIRD_STEP = 34;
/** Birds hover until their first tap, or until this time (seconds) so nobody is stuck. */
const HOVER_S = 2.2;
/** The progress bar counts this many pipes. */
const BAR_PIPES = 30;

interface Bird {
  x: number;
  y: number;
  /** Where the bird hovers while it waits: spread out so the names do not overlap. */
  home: number;
  vy: number;
  waiting: boolean;
  alive: boolean;
  diedAt: number;
  /** Pipes passed (when it died, or now). */
  passed: number;
}

/** A race on one screen: every player flies a bird through the same pipes. The last bird still flying wins. */
export class FlappyGame implements MiniGame {
  readonly kind = 'flappy' as const;
  readonly maxTime = 70;
  over = false;
  private t = 0;
  private gaps: number[] = [];
  private birds = new Map<number, Bird>();

  constructor(private players: MiniPlayer[], rng: Rng = Math.random) {
    for (let i = 0; i < 400; i++) this.gaps.push(GAP / 2 + 60 + rng() * (H - GAP - 120));
    players.forEach((p, i) => {
      const home = H / 2 + (i - (players.length - 1) / 2) * 44;
      this.birds.set(p.id, { x: BIRD_X + i * BIRD_STEP, y: home, home, vy: 0, waiting: true, alive: true, diedAt: 0, passed: 0 });
    });
  }

  /** Distance the pipes have scrolled after `t` seconds (the speed grows with time). */
  private distAt(t: number): number {
    return 150 * t + 2.2 * t * t;
  }

  /** Pipes a bird at screen x has passed after `dist` of scrolling. */
  private passedBy(x: number, dist: number): number {
    const wx = x + dist;
    return Math.max(0, Math.min(this.gaps.length, Math.floor((wx - PIPE_W / 2 - FIRST) / SPACING) + 1));
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    const dist = this.distAt(this.t);
    for (const b of this.birds.values()) {
      if (!b.alive) continue;
      if (b.waiting && this.t >= HOVER_S) b.waiting = false;
      if (b.waiting) {
        b.y = b.home + Math.sin(this.t * 5 + b.x) * 8;
        continue;
      }
      b.vy += GRAVITY * dt;
      b.y += b.vy * dt;
      if (b.y < R) {
        b.y = R;
        b.vy = Math.max(0, b.vy);
      }
      b.passed = this.passedBy(b.x, dist);
      if (b.y > H - R || this.hitsPipe(b.x, dist, b.y)) {
        b.alive = false;
        b.diedAt = this.t;
      }
    }
    const alive = [...this.birds.values()].filter((b) => b.alive).length;
    if (alive <= 1 || this.t >= this.maxTime) this.over = true;
  }

  private hitsPipe(x: number, dist: number, y: number): boolean {
    const wx = x + dist;
    const k = Math.round((wx - FIRST) / SPACING);
    for (const i of [k - 1, k, k + 1]) {
      if (i < 0 || i >= this.gaps.length) continue;
      const px = FIRST + i * SPACING;
      if (Math.abs(wx - px) < PIPE_W / 2 + R - 3 && Math.abs(y - this.gaps[i]) > GAP / 2 - R + 3) return true;
    }
    return false;
  }

  input(id: number, input: MiniInput): void {
    const b = this.birds.get(id);
    if (!b || !b.alive || this.over || input.a !== 'tap') return;
    b.waiting = false;
    b.vy = FLAP;
  }

  ranking(): number[] {
    return rankSurvival(
      this.players.map((p) => p.id),
      (id) => this.birds.get(id)?.alive ?? false,
      (id) => this.birds.get(id)?.passed ?? 0,
      (id) => this.birds.get(id)?.diedAt ?? 0,
    );
  }

  labels(): Record<number, string> {
    return Object.fromEntries(
      this.players.map((p) => {
        const b = this.birds.get(p.id);
        const n = b?.passed ?? 0;
        const text = `${n} ${n > 1 ? 'tuyaux' : 'tuyau'}`;
        return [p.id, b?.alive ? text : `tombé · ${text}`];
      }),
    );
  }

  render(ctx: CanvasRenderingContext2D): void {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d2540');
    sky.addColorStop(1, '#1f5f8f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, MINI_W, H);
    const dist = this.distAt(this.t);

    // Faint stripes that scroll with the pipes, so the speed can be felt.
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = -((dist * 0.5) % 120); x < MINI_W; x += 120) ctx.fillRect(x, 0, 40, H);

    const first = Math.max(0, Math.floor((dist - FIRST - PIPE_W) / SPACING));
    for (let i = first; i < this.gaps.length; i++) {
      const px = FIRST + i * SPACING - dist;
      if (px - PIPE_W / 2 > MINI_W) break;
      this.pipe(ctx, px, 0, this.gaps[i] - GAP / 2, true);
      this.pipe(ctx, px, this.gaps[i] + GAP / 2, H - (this.gaps[i] + GAP / 2), false);
    }

    // Floor and ceiling lines.
    ctx.fillStyle = '#0a1b2e';
    ctx.fillRect(0, H - 6, MINI_W, 6);

    // Dead birds first, so the living ones stay on top.
    const order = [...this.players].sort((a, b) => Number(this.birds.get(a.id)?.alive) - Number(this.birds.get(b.id)?.alive));
    for (const p of order) {
      const b = this.birds.get(p.id);
      if (!b) continue;
      const y = clamp(b.y, 0, H);
      ctx.save();
      ctx.globalAlpha = b.alive ? 1 : 0.4;
      ctx.translate(b.x, y);
      ctx.rotate(b.waiting ? 0 : clamp(b.vy / 900, -0.5, 0.9));
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#12061a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(6, -4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#12061a';
      ctx.beginPath();
      ctx.arc(8, -4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffb21e';
      ctx.beginPath();
      ctx.moveTo(R - 1, 0);
      ctx.lineTo(R + 9, 3);
      ctx.lineTo(R - 1, 7);
      ctx.fill();
      ctx.restore();
      tag(ctx, p.name + (b.alive ? '' : ' ✖'), b.x, y - R - 8, p.color);
    }

    this.progress(ctx, dist);

    if (this.t < HOVER_S && !this.over) {
      tag(ctx, 'TAPE POUR VOLER ! Passe entre les tuyaux verts', MINI_W / 2, H - 56, '#ffd23f');
    }
  }

  /** One pipe: a dark outline, a light stripe and a wider cap on the side of the gap. */
  private pipe(ctx: CanvasRenderingContext2D, cx: number, y: number, h: number, capAtBottom: boolean): void {
    if (h <= 0) return;
    const x = cx - PIPE_W / 2;
    ctx.fillStyle = '#0b3d1c';
    ctx.fillRect(x - 3, y - (capAtBottom ? 3 : 0), PIPE_W + 6, h + 3);
    ctx.fillStyle = '#4be37a';
    ctx.fillRect(x, y, PIPE_W, h);
    ctx.fillStyle = '#9dffb8';
    ctx.fillRect(x + 8, y, 10, h);
    ctx.fillStyle = '#2aa653';
    ctx.fillRect(x + PIPE_W - 16, y, 16, h);
    const capH = 30;
    const cy = capAtBottom ? y + h - capH : y;
    ctx.fillStyle = '#0b3d1c';
    ctx.fillRect(x - 10, cy - 3, PIPE_W + 20, capH + 6);
    ctx.fillStyle = '#4be37a';
    ctx.fillRect(x - 7, cy, PIPE_W + 14, capH);
    ctx.fillStyle = '#9dffb8';
    ctx.fillRect(x - 2, cy, 10, capH);
  }

  /** The progress bar at the top: where each bird is on the way, so everybody can see who leads. */
  private progress(ctx: CanvasRenderingContext2D, dist: number): void {
    const x0 = 120;
    const x1 = MINI_W - 40;
    const y = H - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x0 - 8, y - 12, x1 - x0 + 16, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x0, y - 2, x1 - x0, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x1 - 2, y - 9, 4, 18);
    this.players.forEach((p) => {
      const b = this.birds.get(p.id);
      if (!b) return;
      const frac = clamp((b.alive ? this.passedBy(b.x, dist) : b.passed) / BAR_PIPES, 0, 1);
      ctx.globalAlpha = b.alive ? 1 : 0.45;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#12061a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x0 + frac * (x1 - x0), y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }
}
