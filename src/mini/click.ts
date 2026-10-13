import { MINI_H, MINI_W, type MiniGame, type MiniInput, type MiniPlayer, tag } from './types';

/** Tap as fast as you can for 5 seconds. */
export class ClickGame implements MiniGame {
  readonly kind = 'click' as const;
  readonly maxTime = 5;
  over = false;
  private t = 0;
  private count = new Map<number, number>();
  private last = new Map<number, number>();

  constructor(private players: MiniPlayer[]) {
    for (const p of players) this.count.set(p.id, 0);
  }

  update(dt: number): void {
    if (this.over) return;
    this.t += dt;
    if (this.t >= this.maxTime) this.over = true;
  }

  input(id: number, input: MiniInput): void {
    if (this.over || input.a !== 'tap' || !this.count.has(id)) return;
    this.count.set(id, (this.count.get(id) ?? 0) + 1);
    this.last.set(id, this.t);
  }

  ranking(): number[] {
    return this.players
      .map((p) => p.id)
      .sort((a, b) => (this.count.get(b) ?? 0) - (this.count.get(a) ?? 0) || (this.last.get(a) ?? 0) - (this.last.get(b) ?? 0) || a - b);
  }

  labels(): Record<number, string> {
    return Object.fromEntries(
      this.players.map((p) => {
        const n = this.count.get(p.id) ?? 0;
        return [p.id, `${n} ${n > 1 ? 'clics' : 'clic'}`];
      }),
    );
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#1b0a26';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    const n = this.players.length;
    const max = Math.max(10, ...this.count.values());
    const rowH = Math.min(80, (MINI_H - 140) / n);
    this.players.forEach((p, i) => {
      const y = 90 + i * (rowH + 8);
      const c = this.count.get(p.id) ?? 0;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(40, y, MINI_W - 80, rowH);
      ctx.fillStyle = p.color;
      ctx.fillRect(40, y, ((MINI_W - 80) * c) / max, rowH);
      ctx.font = '700 26px Nunito, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, 56, y + rowH / 2 + 9);
      ctx.textAlign = 'right';
      ctx.font = '400 40px "Lilita One", sans-serif';
      ctx.fillText(`${c} ${c > 1 ? 'clics' : 'clic'}`, MINI_W - 56, y + rowH / 2 + 14);
    });
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(0, 0, (MINI_W * Math.max(0, this.maxTime - this.t)) / this.maxTime, 14);
    tag(ctx, this.t === 0 ? 'PRÊTS ? TAPE SUR TON TÉLÉPHONE !' : 'TAPE TAPE TAPE !', MINI_W / 2, 56, '#ffd23f');
  }
}
