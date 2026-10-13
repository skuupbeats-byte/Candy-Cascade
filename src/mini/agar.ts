import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, type Rng, clamp, rankSurvival, tag } from './types';

const WORLD_W = 1600;
const WORLD_H = 1000;
const PELLETS = 140;

interface Cell {
  x: number;
  y: number;
  mass: number;
  vx: number;
  vy: number;
  alive: boolean;
  diedAt: number;
}

const radius = (mass: number): number => 6 * Math.sqrt(mass);

/** Cells that eat pellets, then eat smaller cells. Moves by joystick. */
export class AgarGame implements MiniGame {
  readonly kind = 'agar' as const;
  readonly maxTime = 60;
  over = false;
  private t = 0;
  private pellets: Array<{ x: number; y: number; hue: number }> = [];
  private cells = new Map<number, Cell>();

  constructor(private players: MiniPlayer[], private rng: Rng = Math.random) {
    const n = players.length;
    players.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2;
      this.cells.set(p.id, { x: WORLD_W / 2 + Math.cos(a) * 520, y: WORLD_H / 2 + Math.sin(a) * 320, mass: 20, vx: 0, vy: 0, alive: true, diedAt: 0 });
    });
    for (let i = 0; i < PELLETS; i++) this.pellets.push(this.newPellet());
  }

  private newPellet(): { x: number; y: number; hue: number } {
    return { x: 20 + this.rng() * (WORLD_W - 40), y: 20 + this.rng() * (WORLD_H - 40), hue: Math.floor(this.rng() * 360) };
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    for (const c of this.cells.values()) {
      if (!c.alive) continue;
      const speed = 260 / Math.pow(1 + c.mass / 120, 0.5);
      c.x = clamp(c.x + c.vx * speed * dt, 0, WORLD_W);
      c.y = clamp(c.y + c.vy * speed * dt, 0, WORLD_H);
      if (c.mass > 30) c.mass -= c.mass * 0.004 * dt;
      const r = radius(c.mass);
      for (let i = 0; i < this.pellets.length; i++) {
        const p = this.pellets[i];
        if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 < r * r) {
          c.mass += 1.5;
          this.pellets[i] = this.newPellet();
        }
      }
    }
    const list = [...this.cells.entries()].filter(([, c]) => c.alive);
    for (const [ia, a] of list) {
      for (const [ib, b] of list) {
        if (ia === ib || !a.alive || !b.alive) continue;
        if (a.mass > b.mass * 1.2) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < radius(a.mass) - radius(b.mass) * 0.4) {
            a.mass += b.mass * 0.9;
            b.alive = false;
            b.diedAt = this.t;
          }
        }
      }
    }
    if ([...this.cells.values()].filter((c) => c.alive).length <= 1 || this.t >= this.maxTime) this.over = true;
  }

  input(id: number, input: MiniInput): void {
    const c = this.cells.get(id);
    if (!c || !c.alive || this.over || input.a !== 'move') return;
    const x = Number(input.x) || 0;
    const y = Number(input.y) || 0;
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    c.vx = x * k;
    c.vy = y * k;
  }

  ranking(): number[] {
    return rankSurvival(
      this.players.map((p) => p.id),
      (id) => this.cells.get(id)?.alive ?? false,
      (id) => this.cells.get(id)?.mass ?? 0,
      (id) => this.cells.get(id)?.diedAt ?? 0,
    );
  }

  labels(): Record<number, string> {
    return Object.fromEntries(this.players.map((p) => {
      const c = this.cells.get(p.id);
      return [p.id, c?.alive ? `masse ${Math.round(c.mass)}` : `avalé (${Math.round(c?.mass ?? 0)})`];
    }));
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#16081f';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    const s = Math.min(MINI_W / WORLD_W, MINI_H / WORLD_H);
    ctx.save();
    ctx.translate((MINI_W - WORLD_W * s) / 2, (MINI_H - WORLD_H * s) / 2);
    ctx.scale(s, s);
    ctx.fillStyle = '#220d2e';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= WORLD_W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_H);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_H; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
      ctx.stroke();
    }
    for (const p of this.pellets) {
      ctx.fillStyle = `hsl(${p.hue} 90% 60%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    const order = this.players.filter((p) => this.cells.get(p.id)?.alive).sort((a, b) => (this.cells.get(a.id)?.mass ?? 0) - (this.cells.get(b.id)?.mass ?? 0));
    for (const p of order) {
      const c = this.cells.get(p.id) as Cell;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius(c.mass), 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.stroke();
    }
    ctx.restore();
    for (const p of order) {
      const c = this.cells.get(p.id) as Cell;
      tag(ctx, p.name, (MINI_W - WORLD_W * s) / 2 + c.x * s, (MINI_H - WORLD_H * s) / 2 + c.y * s + 5, '#fff');
    }
  }
}
