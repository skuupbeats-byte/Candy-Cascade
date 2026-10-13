import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, type Rng, clamp, rankSurvival, tag } from './types';

/** Snake in full 2D, like Agar: the joystick points anywhere and the snake turns smoothly towards it. */
const WORLD_W = 1600;
const WORLD_H = 1000;
const SPEED = 190;
const TURN = 4.4;
/** Distance between two body segments. */
const SEG = 11;
const R = 9;
const START_LEN = 14;
const FOOD = 70;
const GROW = 3;

interface Sn {
  x: number;
  y: number;
  angle: number;
  /** The joystick vector: where the finger points. (0, 0) when released: the snake keeps its course. */
  sx: number;
  sy: number;
  /** Body points behind the head, newest first. */
  trail: Array<[number, number]>;
  len: number;
  alive: boolean;
  diedAt: number;
}

interface Food {
  x: number;
  y: number;
  hue: number;
  value: number;
}

/** Several snakes on one board. Hit a wall or another snake's body and you are out. */
export class SnakeGame implements MiniGame {
  readonly kind = 'snake' as const;
  readonly maxTime = 70;
  over = false;
  private t = 0;
  private food: Food[] = [];
  private sn = new Map<number, Sn>();

  constructor(private players: MiniPlayer[], private rng: Rng = Math.random) {
    const n = players.length;
    players.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2;
      const x = WORLD_W / 2 + Math.cos(a) * 560;
      const y = WORLD_H / 2 + Math.sin(a) * 340;
      const angle = Math.atan2(WORLD_H / 2 - y, WORLD_W / 2 - x);
      const trail: Array<[number, number]> = [];
      for (let k = 1; k <= START_LEN; k++) trail.push([x - Math.cos(angle) * SEG * k, y - Math.sin(angle) * SEG * k]);
      this.sn.set(p.id, { x, y, angle, sx: 0, sy: 0, trail, len: START_LEN, alive: true, diedAt: 0 });
    });
    while (this.food.length < FOOD) this.food.push(this.newFood());
  }

  private newFood(value = 1): Food {
    return { x: 30 + this.rng() * (WORLD_W - 60), y: 30 + this.rng() * (WORLD_H - 60), hue: Math.floor(this.rng() * 360), value };
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    for (const s of this.sn.values()) {
      if (!s.alive) continue;
      if (Math.hypot(s.sx, s.sy) > 0.2) {
        const target = Math.atan2(s.sy, s.sx);
        let diff = target - s.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        s.angle += clamp(diff, -TURN * dt, TURN * dt);
      }
      s.x += Math.cos(s.angle) * SPEED * dt;
      s.y += Math.sin(s.angle) * SPEED * dt;
      const last = s.trail[0];
      if (!last || Math.hypot(s.x - last[0], s.y - last[1]) >= SEG) s.trail.unshift([s.x, s.y]);
      const keep = Math.round(s.len);
      if (s.trail.length > keep) s.trail.length = keep;
      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i];
        if ((f.x - s.x) ** 2 + (f.y - s.y) ** 2 < (R + 8) ** 2) {
          s.len += GROW * f.value * 0.5 + 0.5;
          this.food.splice(i, 1);
        }
      }
    }
    // Everybody moves first, then the deaths are decided together: two heads meeting both die.
    const dead: Sn[] = [];
    for (const [id, s] of this.sn) {
      if (!s.alive) continue;
      let out = s.x < R || s.y < R || s.x > WORLD_W - R || s.y > WORLD_H - R;
      for (const [oid, o] of this.sn) {
        if (out) break;
        if (oid === id || !o.alive) continue;
        if (Math.hypot(s.x - o.x, s.y - o.y) < R * 2 - 2) out = true;
        else if (o.trail.some(([bx, by], k) => k > 0 && Math.hypot(s.x - bx, s.y - by) < R * 2 - 4)) out = true;
      }
      if (out) dead.push(s);
    }
    for (const s of dead) {
      s.alive = false;
      s.diedAt = this.t;
      // A fallen snake leaves food behind.
      s.trail.forEach(([x, y], k) => {
        if (k % 3 === 0) this.food.push({ x: clamp(x, 20, WORLD_W - 20), y: clamp(y, 20, WORLD_H - 20), hue: Math.floor(this.rng() * 360), value: 2 });
      });
    }
    while (this.food.length < FOOD) this.food.push(this.newFood());
    const alive = [...this.sn.values()].filter((s) => s.alive).length;
    if (alive <= 1 || this.t >= this.maxTime) this.over = true;
  }

  input(id: number, input: MiniInput): void {
    const s = this.sn.get(id);
    if (!s || !s.alive || this.over) return;
    if (input.a === 'move') {
      const x = Number(input.x) || 0;
      const y = Number(input.y) || 0;
      const len = Math.hypot(x, y);
      const k = len > 1 ? 1 / len : 1;
      s.sx = x * k;
      s.sy = y * k;
    } else if (input.a === 'dir' && input.d >= 0 && input.d <= 3) {
      // A direction pad still works: it points the snake that way.
      const v = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][Math.floor(input.d)];
      s.sx = v[0];
      s.sy = v[1];
    }
  }

  ranking(): number[] {
    return rankSurvival(
      this.players.map((p) => p.id),
      (id) => this.sn.get(id)?.alive ?? false,
      (id) => this.sn.get(id)?.len ?? 0,
      (id) => this.sn.get(id)?.diedAt ?? 0,
    );
  }

  labels(): Record<number, string> {
    return Object.fromEntries(
      this.players.map((p) => {
        const s = this.sn.get(p.id);
        const n = Math.round(s?.len ?? 0);
        return [p.id, s?.alive ? `longueur ${n}` : `éliminé (${n})`];
      }),
    );
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#16081f';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    const k = Math.min(MINI_W / WORLD_W, MINI_H / WORLD_H);
    const ox = (MINI_W - WORLD_W * k) / 2;
    const oy = (MINI_H - WORLD_H * k) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
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
    ctx.strokeStyle = '#ff5c8a';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
    for (const f of this.food) {
      ctx.fillStyle = `hsl(${f.hue} 90% 60%)`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.value > 1 ? 9 : 7, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.players) {
      const s = this.sn.get(p.id);
      if (!s || !s.alive) continue;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 3;
      for (let i = s.trail.length - 1; i >= 0; i--) {
        ctx.beginPath();
        ctx.arc(s.trail[i][0], s.trail[i][1], R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, R + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(s.angle + side * 0.7) * 6, s.y + Math.sin(s.angle + side * 0.7) * 6, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    for (const p of this.players) {
      const s = this.sn.get(p.id);
      if (s?.alive) tag(ctx, p.name, ox + s.x * k, oy + s.y * k - 18 * k - 4, p.color);
    }
  }
}
