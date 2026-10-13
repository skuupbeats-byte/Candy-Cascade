import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, type Rng, rankSurvival, tag } from './types';

const W = 13;
const H = 11;
const FUSE = 2.0;
const FLAME = 0.55;
const STEP = 0.16;
const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const WALL = 1;
const BLOCK = 2;

interface Pl {
  x: number;
  y: number;
  px: number;
  py: number;
  /** Progress of the walk from (px, py) to (x, y), 0 to 1. */
  walk: number;
  cd: number;
  held: number;
  alive: boolean;
  diedAt: number;
  range: number;
  maxBombs: number;
  broken: number;
}

interface Bomb {
  x: number;
  y: number;
  owner: number;
  t: number;
  range: number;
}

/** A small Bomberman: blocks to blow up, bombs with a fuse, last one standing wins. */
export class BomberGame implements MiniGame {
  readonly kind = 'bomber' as const;
  readonly maxTime = 90;
  over = false;
  private t = 0;
  private grid: number[][] = [];
  private items = new Map<string, 'range' | 'bomb'>();
  private bombs: Bomb[] = [];
  private flames = new Map<string, number>();
  private pl = new Map<number, Pl>();

  constructor(private players: MiniPlayer[], private rng: Rng = Math.random) {
    const spawns = [
      [1, 1],
      [W - 2, H - 2],
      [W - 2, 1],
      [1, H - 2],
      [(W - 1) / 2, 1],
      [(W - 1) / 2, H - 2],
    ];
    const safe = new Set<string>();
    players.forEach((p, i) => {
      const [x, y] = spawns[i % spawns.length];
      this.pl.set(p.id, { x, y, px: x, py: y, walk: 1, cd: 0, held: -1, alive: true, diedAt: 0, range: 2, maxBombs: 1, broken: 0 });
      safe.add(`${x},${y}`);
      for (const [dx, dy] of DIRS) safe.add(`${x + dx},${y + dy}`);
    });
    for (let y = 0; y < H; y++) {
      const row: number[] = [];
      for (let x = 0; x < W; x++) {
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) row.push(WALL);
        else row.push(!safe.has(`${x},${y}`) && rng() < 0.72 ? BLOCK : 0);
      }
      this.grid.push(row);
    }
  }

  private bombAt(x: number, y: number): Bomb | undefined {
    return this.bombs.find((b) => b.x === x && b.y === y);
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    for (const [k, v] of this.flames) {
      if (v - dt <= 0) this.flames.delete(k);
      else this.flames.set(k, v - dt);
    }
    for (const b of [...this.bombs]) {
      b.t += dt;
      if (this.bombs.includes(b) && b.t >= FUSE) this.explode(b);
    }
    for (const [, p] of this.pl) {
      if (!p.alive) continue;
      if (p.walk < 1) p.walk = Math.min(1, p.walk + dt / STEP);
      p.cd -= dt;
      if (p.held >= 0 && p.cd <= 0 && p.walk >= 1) {
        const [dx, dy] = DIRS[p.held];
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (this.grid[ny]?.[nx] === 0 && !this.bombAt(nx, ny)) {
          p.px = p.x;
          p.py = p.y;
          p.x = nx;
          p.y = ny;
          p.walk = 0;
          p.cd = STEP;
          const item = this.items.get(`${nx},${ny}`);
          if (item) {
            if (item === 'range') p.range++;
            else p.maxBombs++;
            this.items.delete(`${nx},${ny}`);
          }
        }
      }
      if (this.flames.has(`${p.x},${p.y}`)) this.die(p);
    }
    const alive = [...this.pl.values()].filter((p) => p.alive).length;
    if (alive <= 1 || this.t >= this.maxTime) this.over = true;
  }

  private die(p: Pl): void {
    if (!p.alive) return;
    p.alive = false;
    p.diedAt = this.t;
  }

  private explode(b: Bomb): void {
    this.bombs = this.bombs.filter((x) => x !== b);
    const owner = this.pl.get(b.owner);
    const burn = (x: number, y: number) => this.flames.set(`${x},${y}`, FLAME);
    burn(b.x, b.y);
    for (const [dx, dy] of DIRS) {
      for (let i = 1; i <= b.range; i++) {
        const x = b.x + dx * i;
        const y = b.y + dy * i;
        const cell = this.grid[y]?.[x];
        if (cell === undefined || cell === WALL) break;
        burn(x, y);
        if (cell === BLOCK) {
          this.grid[y][x] = 0;
          if (owner) owner.broken++;
          const r = this.rng();
          if (r < 0.14) this.items.set(`${x},${y}`, 'range');
          else if (r < 0.24) this.items.set(`${x},${y}`, 'bomb');
          break;
        }
        this.items.delete(`${x},${y}`);
        const other = this.bombAt(x, y);
        if (other) other.t = FUSE;
      }
    }
    for (const p of this.pl.values()) if (this.flames.has(`${p.x},${p.y}`)) this.die(p);
    for (const o of this.bombs) if (this.flames.has(`${o.x},${o.y}`)) o.t = FUSE;
  }

  input(id: number, input: MiniInput): void {
    const p = this.pl.get(id);
    if (!p || !p.alive || this.over) return;
    if (input.a === 'dir') p.held = input.d >= 0 && input.d <= 3 ? Math.floor(input.d) : -1;
    else if (input.a === 'bomb') {
      const mine = this.bombs.filter((b) => b.owner === id).length;
      if (mine < p.maxBombs && !this.bombAt(p.x, p.y)) this.bombs.push({ x: p.x, y: p.y, owner: id, t: 0, range: p.range });
    }
  }

  ranking(): number[] {
    return rankSurvival(
      this.players.map((p) => p.id),
      (id) => this.pl.get(id)?.alive ?? false,
      (id) => this.pl.get(id)?.broken ?? 0,
      (id) => this.pl.get(id)?.diedAt ?? 0,
    );
  }

  labels(): Record<number, string> {
    return Object.fromEntries(this.players.map((p) => [p.id, this.pl.get(p.id)?.alive ? 'en vie' : 'éliminé']));
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#1b0a26';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    const cs = Math.min(MINI_W / W, MINI_H / H);
    const ox = (MINI_W - cs * W) / 2;
    const oy = (MINI_H - cs * H) / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = this.grid[y][x];
        ctx.fillStyle = c === WALL ? '#5b2f6c' : c === BLOCK ? '#c98a4b' : (x + y) % 2 ? '#2a1236' : '#311640';
        ctx.fillRect(ox + x * cs, oy + y * cs, cs - 1, cs - 1);
        if (c === BLOCK) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.strokeRect(ox + x * cs + 5, oy + y * cs + 5, cs - 11, cs - 11);
        }
      }
    }
    ctx.textAlign = 'center';
    ctx.font = `${cs * 0.55}px sans-serif`;
    for (const [k, kind] of this.items) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillText(kind === 'range' ? '🔥' : '💣', ox + (x + 0.5) * cs, oy + (y + 0.72) * cs);
    }
    for (const k of this.flames.keys()) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillStyle = '#ff7a1a';
      ctx.fillRect(ox + x * cs + 2, oy + y * cs + 2, cs - 5, cs - 5);
      ctx.fillStyle = '#ffe14a';
      ctx.fillRect(ox + x * cs + 10, oy + y * cs + 10, cs - 21, cs - 21);
    }
    for (const b of this.bombs) {
      const pulse = 1 + 0.12 * Math.sin(b.t * 14);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(ox + (b.x + 0.5) * cs, oy + (b.y + 0.55) * cs, cs * 0.32 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff4d2e';
      ctx.fillRect(ox + (b.x + 0.5) * cs - 2, oy + (b.y + 0.15) * cs, 4, 8);
    }
    for (const p of this.players) {
      const s = this.pl.get(p.id);
      if (!s || !s.alive) continue;
      const k = s.walk;
      const x = s.px + (s.x - s.px) * k;
      const y = s.py + (s.y - s.py) * k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(ox + (x + 0.5) * cs, oy + (y + 0.5) * cs, cs * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(ox + (x + 0.5) * cs - 7, oy + (y + 0.5) * cs - 5, 4, 7);
      ctx.fillRect(ox + (x + 0.5) * cs + 3, oy + (y + 0.5) * cs - 5, 4, 7);
      tag(ctx, p.name, ox + (x + 0.5) * cs, oy + (y - 0.02) * cs, p.color);
    }
  }
}
