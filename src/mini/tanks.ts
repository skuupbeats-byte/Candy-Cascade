import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, type Rng, clamp, rankSurvival, tag } from './types';

/** Tanks, like the Wii Play game: bullets bounce on the walls, crates break and come back after 10 seconds. */
const COLS = 24;
const ROWS = 15;
const CELL = 40;
const TANK_R = 14;
const TANK_SPEED = 135;
const BULLET_SPEED = 330;
const BULLET_R = 4;
const MAX_BOUNCES = 2;
const MAX_BULLETS = 3;
const COOLDOWN = 0.4;
export const LIVES = 3;
/** Seconds before a destroyed tank comes back, and how long it cannot be hurt after that. */
const RESPAWN_S = 2;
const SHIELD_S = 1.6;
/** The aim joystick fires once it is pushed past this (0 to 1). */
const FIRE_PUSH = 0.7;
/** A bullet cannot hurt the tank that fired it for this long (seconds), so it does not hit its own muzzle. */
const SAFE_S = 0.15;
export const CRATE_RESPAWN_S = 10;

const EMPTY = 0;
const SOLID = 1;
const CRATE = 2;
const BROKEN = 3;

interface Tank {
  x: number;
  y: number;
  /** Where the barrel points (radians). It follows the joystick. */
  aim: number;
  /** The body turns smoothly towards the way it moves. */
  body: number;
  sx: number;
  sy: number;
  cd: number;
  /** On the field right now. A destroyed tank with lives left is not alive, until it comes back. */
  alive: boolean;
  lives: number;
  /** True once the last life is gone. */
  out: boolean;
  respawnAt: number;
  /** Cannot be hurt until this time (just after coming back). */
  shieldUntil: number;
  /** The player uses the aim joystick: the barrel no longer follows the movement. */
  twin: boolean;
  firing: boolean;
  diedAt: number;
  kills: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  age: number;
  bounces: number;
}

interface Blast {
  x: number;
  y: number;
  age: number;
}

/** Spawn cells (column, row), in seat order. */
const SPAWNS: Array<[number, number]> = [
  [2, 2],
  [21, 12],
  [21, 2],
  [2, 12],
  [11, 1],
  [12, 13],
];

export class TanksGame implements MiniGame {
  readonly kind = 'tanks' as const;
  readonly maxTime = 120;
  over = false;
  private t = 0;
  grid: number[][] = [];
  /** Broken crates: cell index -> time they come back. */
  private respawn = new Map<number, number>();
  private tanks = new Map<number, Tank>();
  private bullets: Bullet[] = [];
  private blasts: Blast[] = [];

  constructor(private players: MiniPlayer[], private rng: Rng = Math.random) {
    this.grid = this.makeLayout(players.length);
    players.forEach((p, i) => {
      const [c, r] = SPAWNS[i % SPAWNS.length];
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      const aim = Math.atan2(MINI_H / 2 - y, MINI_W / 2 - x);
      this.tanks.set(p.id, { x, y, aim, body: aim, sx: 0, sy: 0, cd: 0, alive: true, lives: LIVES, out: false, respawnAt: 0, shieldUntil: 0, twin: false, firing: false, diedAt: 0, kills: 0 });
    });
  }

  // ---------------------------------------------------------------- layout

  /** A random arena, mirrored left-right and top-bottom so it is fair, with every tank able to reach every other. */
  private makeLayout(count: number): number[][] {
    for (let attempt = 0; attempt < 30; attempt++) {
      const g = this.randomLayout();
      if (this.connected(g, count)) return g;
    }
    // Fallback: only crates and the border.
    const g = this.randomLayout();
    for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) if (g[r][c] === SOLID) g[r][c] = CRATE;
    return g;
  }

  private randomLayout(): number[][] {
    const g: number[][] = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 ? SOLID : EMPTY)));
    const set = (c: number, r: number, v: number): void => {
      for (const [cc, rr] of [
        [c, r],
        [COLS - 1 - c, r],
        [c, ROWS - 1 - r],
        [COLS - 1 - c, ROWS - 1 - r],
      ]) {
        if (cc > 0 && rr > 0 && cc < COLS - 1 && rr < ROWS - 1) g[rr][cc] = v;
      }
    };
    for (let r = 1; r <= Math.floor(ROWS / 2); r++) {
      for (let c = 1; c < COLS / 2; c++) {
        const roll = this.rng();
        if (roll < 0.115) {
          // A wall of one to three blocks, so they look like walls and not like dust.
          const horizontal = this.rng() < 0.5;
          const length = 1 + Math.floor(this.rng() * 3);
          for (let k = 0; k < length; k++) set(horizontal ? c + k : c, horizontal ? r : r + k, SOLID);
        } else if (roll < 0.235) set(c, r, CRATE);
      }
    }
    // Keep a clear zone around every spawn.
    for (const [sc, sr] of SPAWNS) for (let r = sr - 1; r <= sr + 1; r++) for (let c = sc - 1; c <= sc + 1; c++) if (r > 0 && c > 0 && r < ROWS - 1 && c < COLS - 1) g[r][c] = EMPTY;
    return g;
  }

  /** Can every spawn reach every other one (crates count as passable, they can be shot)? And is most of the arena reachable? */
  private connected(g: number[][], count: number): boolean {
    const [sc, sr] = SPAWNS[0];
    const seen = new Set<number>([sr * COLS + sc]);
    const queue: Array<[number, number]> = [[sc, sr]];
    while (queue.length) {
      const [c, r] = queue.pop() as [number, number];
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || g[nr][nc] === SOLID || seen.has(nr * COLS + nc)) continue;
        seen.add(nr * COLS + nc);
        queue.push([nc, nr]);
      }
    }
    let open = 0;
    for (const row of g) for (const v of row) if (v !== SOLID) open++;
    for (let i = 0; i < Math.min(count, SPAWNS.length); i++) if (!seen.has(SPAWNS[i][1] * COLS + SPAWNS[i][0])) return false;
    return seen.size >= open * 0.95;
  }

  private blocked(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
    const v = this.grid[r][c];
    return v === SOLID || v === CRATE;
  }

  // ----------------------------------------------------------------- rules

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    this.updateCrates();
    for (const [id, tank] of this.tanks) {
      if (tank.alive) {
        this.moveTank(tank, dt);
        if (tank.firing) this.fire(id);
      } else if (!tank.out && this.t >= tank.respawnAt) this.respawnTank(tank);
    }
    this.separateTanks();
    this.updateBullets(dt);
    for (const b of this.blasts) b.age += dt;
    this.blasts = this.blasts.filter((b) => b.age < 0.6);
    const standing = [...this.tanks.values()].filter((t) => !t.out).length;
    if (standing <= 1 || this.t >= this.maxTime) this.over = true;
  }

  /** A destroyed tank comes back at the spawn point that is farthest from the other tanks. */
  private respawnTank(t: Tank): void {
    const others = [...this.tanks.values()].filter((o) => o !== t && o.alive);
    let best = SPAWNS[0];
    let bestD = -1;
    for (const sp of SPAWNS) {
      const x = (sp[0] + 0.5) * CELL;
      const y = (sp[1] + 0.5) * CELL;
      const d = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - x, o.y - y))) : 1e9;
      if (d > bestD) {
        bestD = d;
        best = sp;
      }
    }
    t.x = (best[0] + 0.5) * CELL;
    t.y = (best[1] + 0.5) * CELL;
    t.aim = Math.atan2(MINI_H / 2 - t.y, MINI_W / 2 - t.x);
    t.body = t.aim;
    t.cd = 0.3;
    t.alive = true;
    t.shieldUntil = this.t + SHIELD_S;
  }

  private updateCrates(): void {
    for (const [key, at] of this.respawn) {
      if (this.t < at) continue;
      const c = key % COLS;
      const r = Math.floor(key / COLS);
      // A crate does not come back on top of a tank: it waits.
      const x0 = c * CELL - TANK_R;
      const y0 = r * CELL - TANK_R;
      const occupied = [...this.tanks.values()].some((t) => t.alive && t.x > x0 && t.x < x0 + CELL + TANK_R * 2 && t.y > y0 && t.y < y0 + CELL + TANK_R * 2);
      if (occupied) this.respawn.set(key, this.t + 0.4);
      else {
        this.grid[r][c] = CRATE;
        this.respawn.delete(key);
      }
    }
  }

  private hitsWall(x: number, y: number): boolean {
    const c0 = Math.floor((x - TANK_R) / CELL);
    const c1 = Math.floor((x + TANK_R) / CELL);
    const r0 = Math.floor((y - TANK_R) / CELL);
    const r1 = Math.floor((y + TANK_R) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.blocked(c, r)) continue;
        const nx = clamp(x, c * CELL, (c + 1) * CELL);
        const ny = clamp(y, r * CELL, (r + 1) * CELL);
        if ((x - nx) ** 2 + (y - ny) ** 2 < TANK_R * TANK_R) return true;
      }
    }
    return false;
  }

  private moveTank(t: Tank, dt: number): void {
    t.cd = Math.max(0, t.cd - dt);
    const len = Math.hypot(t.sx, t.sy);
    if (len < 0.12) return;
    const k = Math.min(1, len);
    if (len > 0.25) {
      const heading = Math.atan2(t.sy, t.sx);
      if (!t.twin) t.aim = heading;
      let diff = heading - t.body;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      t.body += clamp(diff, -9 * dt, 9 * dt);
    }
    const vx = (t.sx / len) * TANK_SPEED * k * dt;
    const vy = (t.sy / len) * TANK_SPEED * k * dt;
    if (!this.hitsWall(t.x + vx, t.y)) t.x += vx;
    if (!this.hitsWall(t.x, t.y + vy)) t.y += vy;
  }

  /** Two tanks cannot drive through each other. */
  private separateTanks(): void {
    const list = [...this.tanks.values()].filter((t) => t.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d >= TANK_R * 2 || d === 0) continue;
        const push = (TANK_R * 2 - d) / 2;
        const nx = (a.x - b.x) / d;
        const ny = (a.y - b.y) / d;
        if (!this.hitsWall(a.x + nx * push, a.y + ny * push)) {
          a.x += nx * push;
          a.y += ny * push;
        }
        if (!this.hitsWall(b.x - nx * push, b.y - ny * push)) {
          b.x -= nx * push;
          b.y -= ny * push;
        }
      }
    }
  }

  private fire(id: number): void {
    const t = this.tanks.get(id);
    if (!t || !t.alive || t.cd > 0 || this.over) return;
    if (this.bullets.filter((b) => b.owner === id).length >= MAX_BULLETS) return;
    t.cd = COOLDOWN;
    const x = t.x + Math.cos(t.aim) * (TANK_R + 6);
    const y = t.y + Math.sin(t.aim) * (TANK_R + 6);
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (this.blocked(c, r)) {
      // Firing into a wall right in front of the barrel: a crate breaks, a wall stops the shot.
      if (this.grid[r]?.[c] === CRATE) this.breakCrate(c, r);
      return;
    }
    this.bullets.push({ x, y, vx: Math.cos(t.aim) * BULLET_SPEED, vy: Math.sin(t.aim) * BULLET_SPEED, owner: id, age: 0, bounces: MAX_BOUNCES });
  }

  private breakCrate(c: number, r: number): void {
    this.grid[r][c] = BROKEN;
    this.respawn.set(r * COLS + c, this.t + CRATE_RESPAWN_S);
  }

  private kill(victim: Tank, ownerId: number, victimId: number): void {
    victim.alive = false;
    victim.lives--;
    victim.diedAt = this.t;
    victim.respawnAt = this.t + RESPAWN_S;
    if (victim.lives <= 0) victim.out = true;
    victim.sx = 0;
    victim.sy = 0;
    victim.firing = false;
    this.blasts.push({ x: victim.x, y: victim.y, age: 0 });
    if (ownerId !== victimId) {
      const owner = this.tanks.get(ownerId);
      if (owner) owner.kills++;
    }
  }

  private updateBullets(dt: number): void {
    const dead = new Set<Bullet>();
    for (const b of this.bullets) {
      b.age += dt;
      // Small steps, so a fast bullet cannot jump over a wall.
      const steps = Math.max(1, Math.ceil((BULLET_SPEED * dt) / 5));
      for (let s = 0; s < steps && !dead.has(b); s++) {
        const nx = b.x + (b.vx * dt) / steps;
        const ny = b.y + (b.vy * dt) / steps;
        const c = Math.floor(nx / CELL);
        const r = Math.floor(ny / CELL);
        if (this.blocked(c, r)) {
          if (this.grid[r]?.[c] === CRATE) {
            this.breakCrate(c, r);
            dead.add(b);
            break;
          }
          // Bounce: find which side was hit.
          const hitX = this.blocked(Math.floor(nx / CELL), Math.floor(b.y / CELL));
          const hitY = this.blocked(Math.floor(b.x / CELL), Math.floor(ny / CELL));
          if (hitX || !hitY) b.vx = -b.vx;
          if (hitY || !hitX) b.vy = -b.vy;
          b.bounces--;
          if (b.bounces < 0) dead.add(b);
          continue;
        }
        b.x = nx;
        b.y = ny;
        for (const [id, t] of this.tanks) {
          if (!t.alive || this.t < t.shieldUntil || (id === b.owner && b.age < SAFE_S)) continue;
          if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 < (TANK_R + BULLET_R) ** 2) {
            this.kill(t, b.owner, id);
            dead.add(b);
            break;
          }
        }
      }
    }
    // Two bullets that meet cancel each other.
    for (let i = 0; i < this.bullets.length; i++) {
      for (let j = i + 1; j < this.bullets.length; j++) {
        const a = this.bullets[i];
        const c = this.bullets[j];
        if (!dead.has(a) && !dead.has(c) && (a.x - c.x) ** 2 + (a.y - c.y) ** 2 < (BULLET_R * 2) ** 2) {
          dead.add(a);
          dead.add(c);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !dead.has(b) && b.age < 8);
  }

  input(id: number, input: MiniInput): void {
    const t = this.tanks.get(id);
    if (!t || t.out || this.over) return;
    if (input.a === 'aim') {
      // The right joystick: it points the barrel, and it shoots when pushed all the way.
      const x = Number(input.x) || 0;
      const y = Number(input.y) || 0;
      const len = Math.hypot(x, y);
      t.twin = true;
      if (len > 0.2) t.aim = Math.atan2(y, x);
      t.firing = len >= FIRE_PUSH;
      return;
    }
    if (!t.alive) return;
    if (input.a === 'move') {
      const x = Number(input.x) || 0;
      const y = Number(input.y) || 0;
      const len = Math.hypot(x, y);
      const k = len > 1 ? 1 / len : 1;
      t.sx = x * k;
      t.sy = y * k;
    } else if (input.a === 'fire' || input.a === 'tap') this.fire(id);
  }

  ranking(): number[] {
    return rankSurvival(
      this.players.map((p) => p.id),
      (id) => !(this.tanks.get(id)?.out ?? true),
      (id) => (this.tanks.get(id)?.lives ?? 0) * 100 + (this.tanks.get(id)?.kills ?? 0),
      (id) => this.tanks.get(id)?.diedAt ?? 0,
    );
  }

  labels(): Record<number, string> {
    return Object.fromEntries(
      this.players.map((p) => {
        const t = this.tanks.get(p.id);
        const k = t?.kills ?? 0;
        const frags = `${k} ${k > 1 ? 'frags' : 'frag'}`;
        return [p.id, t?.out ? `éliminé · ${frags}` : `${'♥'.repeat(t?.lives ?? 0)} · ${frags}`];
      }),
    );
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2b2118';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CELL;
        const y = r * CELL;
        const v = this.grid[r][c];
        if (v === SOLID) {
          ctx.fillStyle = '#4a4a5c';
          ctx.fillRect(x, y, CELL, CELL);
          ctx.fillStyle = '#6c6c84';
          ctx.fillRect(x, y, CELL, 5);
          ctx.fillRect(x, y, 5, CELL);
          ctx.fillStyle = '#2f2f3c';
          ctx.fillRect(x, y + CELL - 5, CELL, 5);
          ctx.fillRect(x + CELL - 5, y, 5, CELL);
        } else {
          ctx.fillStyle = (r + c) % 2 ? '#d9b97f' : '#cfae72';
          ctx.fillRect(x, y, CELL, CELL);
          if (v === CRATE) {
            ctx.fillStyle = '#8a5a2b';
            ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
            ctx.strokeStyle = '#4d2f12';
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
            ctx.beginPath();
            ctx.moveTo(x + 6, y + 6);
            ctx.lineTo(x + CELL - 6, y + CELL - 6);
            ctx.moveTo(x + CELL - 6, y + 6);
            ctx.lineTo(x + 6, y + CELL - 6);
            ctx.stroke();
          } else if (v === BROKEN) {
            // A faint outline shows where the crate will come back, and how soon.
            const left = (this.respawn.get(r * COLS + c) ?? this.t) - this.t;
            const k = clamp(1 - left / CRATE_RESPAWN_S, 0, 1);
            ctx.strokeStyle = `rgba(77,47,18,${0.25 + 0.5 * k})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 4]);
            ctx.strokeRect(x + 5, y + 5, CELL - 10, CELL - 10);
            ctx.setLineDash([]);
            ctx.fillStyle = `rgba(138,90,43,${0.55 * k})`;
            ctx.fillRect(x + 5, y + 5, CELL - 10, CELL - 10);
          }
        }
      }
    }

    for (const b of this.blasts) {
      ctx.strokeStyle = `rgba(255,160,40,${1 - b.age / 0.6})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 10 + b.age * 70, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const p of this.players) {
      const t = this.tanks.get(p.id);
      if (!t) continue;
      if (!t.alive) {
        if (t.out) {
          ctx.fillStyle = 'rgba(30,20,10,0.55)';
          ctx.beginPath();
          ctx.arc(t.x, t.y, TANK_R, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      const blink = this.t < t.shieldUntil && Math.floor(this.t * 10) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = blink ? 0.35 : 1;
      ctx.translate(t.x, t.y);
      ctx.rotate(t.body);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(-TANK_R - 1, -TANK_R + 1, TANK_R * 2 + 2, 7);
      ctx.fillRect(-TANK_R - 1, TANK_R - 8, TANK_R * 2 + 2, 7);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#12061a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-TANK_R + 1, -TANK_R + 4, TANK_R * 2 - 2, TANK_R * 2 - 8, 5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.aim);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(2, -3.5, TANK_R + 10, 7);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#12061a';
      ctx.stroke();
      ctx.restore();
      if (this.t < t.shieldUntil) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(t.x, t.y, TANK_R + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      tag(ctx, `${p.name} ${'♥'.repeat(t.lives)}`, t.x, t.y - TANK_R - 8, p.color);
    }

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#12061a';
    ctx.lineWidth = 2;
    for (const b of this.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_R + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
