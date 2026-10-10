/** The PixiJS scene: board frame, grid, and the overlays drawn on top of it. */
import { Application, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { BombHit, GameConfig } from '../engine';
import { CELL_W, DISPLAY_FONT, GridView } from './gridView';
import { createDotTexture, createSymbolTextures } from './symbolArt';
import { Animator, ease } from './tween';

const FRAME = 22;
const MARGIN = 6;
const TOP_ROOM = 12;

const INK = 0x1c0a24;
const LEMON = 0xffd84a;
const CREAM = 0xfff4e6;
const PINK = 0xff5fa2;
const MINT = 0x58e0c0;
const CONFETTI = [PINK, LEMON, MINT, 0x9a4dff, 0xffffff, 0x2e9bff];

export interface BannerOptions {
  title: string;
  lines?: string[];
  /** A number that counts up under the title. */
  amount?: { to: number; format: (value: number) => string; durationMs: number };
  confetti?: boolean;
  /** How long the banner stays once everything is shown. A tap or the spacebar closes it sooner. */
  holdMs: number;
  color?: number;
}

interface Flake {
  sprite: Sprite;
  vx: number;
  vy: number;
  spin: number;
}

export class Scene {
  readonly anim: Animator;
  readonly grid: GridView;
  private root = new Container();
  private overlay = new Container();
  private badge = new Container();
  private badgeText: Text;
  private badgeSum = 0;
  private banner: Container | null = null;
  private bannerSkip = false;
  private flakes: Flake[] = [];
  private textures: Texture[];
  private dot: Texture;
  private boardW: number;
  private boardH: number;

  static async create(host: HTMLElement, config: GameConfig): Promise<Scene> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    });
    host.appendChild(app.canvas);
    return new Scene(app, host, config);
  }

  private constructor(
    private app: Application,
    host: HTMLElement,
    config: GameConfig,
  ) {
    this.anim = new Animator(app.ticker);
    const ids = [...config.symbols.map((s) => s.id), 'scatter', 'bomb'];
    this.textures = createSymbolTextures(app.renderer, ids);
    this.dot = createDotTexture(app.renderer);
    this.grid = new GridView(this.anim, this.textures, this.dot, config);
    this.boardW = this.grid.boardWidth;
    this.boardH = this.grid.boardHeight;

    this.root.addChild(this.buildFrame(config), this.grid, this.overlay);
    app.stage.addChild(this.root);

    this.badgeText = new Text({
      text: 'x0',
      style: { fontFamily: DISPLAY_FONT, fontSize: 44, fill: INK },
    });
    this.badgeText.anchor.set(0.5);
    this.badge.addChild(new Graphics().roundRect(-78, -32, 156, 64, 32).fill(LEMON).stroke({ width: 5, color: INK }), this.badgeText);
    this.badge.position.set(this.boardW / 2, 4);
    this.badge.visible = false;
    this.overlay.addChild(this.badge);

    app.ticker.add((t) => this.updateConfetti(t.deltaMS));
    app.renderer.on('resize', () => this.layout());
    new ResizeObserver(() => app.resize()).observe(host);
    this.layout();
  }

  private buildFrame(config: GameConfig): Container {
    const frame = new Container();
    const w = this.boardW;
    const h = this.boardH;
    const outer = { x: -FRAME, y: -FRAME, w: w + FRAME * 2, h: h + FRAME * 2, r: 40 };

    // Candy-cane border: diagonal stripes clipped to the outer rounded rectangle.
    const stripes = new Graphics().roundRect(outer.x, outer.y, outer.w, outer.h, outer.r).fill(CREAM);
    for (let x = outer.x - outer.h; x < outer.x + outer.w; x += 56) {
      stripes.poly([x, outer.y + outer.h, x + 28, outer.y + outer.h, x + 28 + outer.h, outer.y, x + outer.h, outer.y]).fill(PINK);
    }
    const clip = new Graphics().roundRect(outer.x, outer.y, outer.w, outer.h, outer.r).fill(0xffffff);
    stripes.mask = clip;
    frame.addChild(clip, stripes);
    frame.addChild(new Graphics().roundRect(outer.x, outer.y, outer.w, outer.h, outer.r).stroke({ width: 4, color: INK, alpha: 0.55 }));

    // The tray the symbols sit in, with a faint band behind every other column.
    const tray = new Graphics().roundRect(-4, -4, w + 8, h + 8, 20).fill(0x24102e).stroke({ width: 4, color: INK });
    for (let col = 0; col < config.cols; col += 2) {
      tray.rect(col * CELL_W, 0, CELL_W, h).fill({ color: 0xffffff, alpha: 0.035 });
    }
    frame.addChild(tray);
    return frame;
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    const totalW = this.boardW + (FRAME + MARGIN) * 2;
    const totalH = this.boardH + (FRAME + MARGIN) * 2 + TOP_ROOM;
    const scale = Math.max(0.05, Math.min(width / totalW, height / totalH));
    this.root.scale.set(scale);
    this.root.position.set((width - this.boardW * scale) / 2, (height - (this.boardH - TOP_ROOM) * scale) / 2);
  }

  /** A PNG data URL of a symbol, for the paytable. */
  async symbolImage(code: number): Promise<string> {
    const sprite = new Sprite(this.textures[code]);
    const url = await this.app.renderer.extract.base64({ target: sprite });
    sprite.destroy();
    return url;
  }

  // ------------------------------------------------------------------ text

  /** Text that pops up, drifts upward and fades: step wins, "+5 free spins". */
  floatText(text: string, x = this.boardW / 2, y = this.boardH / 2, color = LEMON, size = 64): Promise<void> {
    const label = new Text({
      text,
      style: { fontFamily: DISPLAY_FONT, fontSize: size, fill: color, stroke: { color: INK, width: 10, join: 'round' } },
    });
    label.anchor.set(0.5);
    const half = label.width / 2 + 12;
    label.position.set(Math.max(half, Math.min(this.boardW - half, x)), y);
    this.overlay.addChild(label);
    return this.anim
      .tween(950, (t) => {
        label.scale.set(t < 0.18 ? ease.outBack(t / 0.18) : 1);
        label.y = y - 70 * ease.outCubic(t);
        label.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      })
      .then(() => label.destroy());
  }

  // ------------------------------------------------------- multiplier badge

  /**
   * Each bomb goes off in turn and its value flies to the multiplier badge,
   * which shows the running sum. Resolves with the total.
   */
  async collectBombs(bombs: readonly BombHit[], onBomb: () => void = () => {}): Promise<number> {
    this.badgeSum = 0;
    this.badgeText.text = 'x0';
    this.badge.visible = true;
    this.badge.alpha = 1;
    this.overlay.addChild(this.badge);
    await this.anim.tween(220, (t) => this.badge.scale.set(t), ease.outBack);

    for (const bomb of bombs) {
      onBomb();
      const fromX = this.grid.cellX(bomb.position);
      const fromY = this.grid.cellY(bomb.position);
      const flyer = new Text({
        text: `x${bomb.value}`,
        style: { fontFamily: DISPLAY_FONT, fontSize: 52, fill: LEMON, stroke: { color: INK, width: 8, join: 'round' } },
      });
      flyer.anchor.set(0.5);
      flyer.position.set(fromX, fromY);
      this.overlay.addChild(flyer);
      void this.grid.detonate(bomb.position);
      await this.anim.tween(180, (t) => flyer.scale.set(0.6 + 0.9 * t), ease.outBack);
      await this.anim.tween(340, (t) => {
        flyer.position.set(fromX + (this.badge.x - fromX) * t, fromY + (this.badge.y - fromY) * t - 60 * Math.sin(t * Math.PI));
        flyer.scale.set(1.5 - 0.7 * t);
      }, ease.inOutQuad);
      flyer.destroy();
      this.badgeSum += bomb.value;
      this.badgeText.text = `x${this.badgeSum}`;
      await this.anim.tween(200, (t) => this.badge.scale.set(1 + 0.25 * t), ease.pulse);
    }
    await this.anim.wait(250);
    return this.badgeSum;
  }

  async hideMultiplier(): Promise<void> {
    if (!this.badge.visible) return;
    await this.anim.tween(200, (t) => (this.badge.alpha = 1 - t));
    this.badge.visible = false;
  }

  // ---------------------------------------------------------------- banner

  get bannerOpen(): boolean {
    return this.banner !== null;
  }

  /** Close the open banner early (tap or spacebar). */
  dismissBanner(): void {
    this.bannerSkip = true;
  }

  /** A full-board announcement: free spins won, feature summary, big win. */
  async showBanner(options: BannerOptions): Promise<void> {
    const w = this.boardW;
    const h = this.boardH;
    const color = options.color ?? LEMON;
    const banner = new Container();
    const dim = new Graphics().roundRect(-4, -4, w + 8, h + 8, 20).fill({ color: INK, alpha: 0.82 });
    dim.eventMode = 'static';
    dim.cursor = 'pointer';
    dim.on('pointertap', () => this.dismissBanner());
    banner.addChild(dim);

    const content = new Container();
    content.position.set(w / 2, h / 2);
    banner.addChild(content);

    const title = new Text({
      text: options.title,
      style: { fontFamily: DISPLAY_FONT, fontSize: 92, fill: color, stroke: { color: INK, width: 12, join: 'round' }, align: 'center' },
    });
    title.anchor.set(0.5);
    if (title.width > w * 0.88) title.scale.set((w * 0.88) / title.width);

    let amount: Text | null = null;
    if (options.amount) {
      amount = new Text({
        text: options.amount.format(0),
        style: { fontFamily: DISPLAY_FONT, fontSize: 112, fill: CREAM, stroke: { color: INK, width: 12, join: 'round' } },
      });
      amount.anchor.set(0.5);
    }
    const lines = (options.lines ?? []).map((text) => {
      const line = new Text({ text, style: { fontFamily: DISPLAY_FONT, fontSize: 36, fill: CREAM, align: 'center' } });
      line.anchor.set(0.5);
      if (line.width > w * 0.9) line.scale.set((w * 0.9) / line.width);
      return line;
    });

    // Stack the pieces vertically around the centre of the board.
    const pieces: Array<[Text, number]> = [[title, 110]];
    if (amount) pieces.push([amount, 130]);
    for (const line of lines) pieces.push([line, 52]);
    const total = pieces.reduce((sum, [, height]) => sum + height, 0);
    let y = -total / 2;
    for (const [piece, height] of pieces) {
      piece.y = y + height / 2;
      y += height;
      content.addChild(piece);
    }

    this.banner = banner;
    this.bannerSkip = false;
    this.overlay.addChild(banner);
    if (options.confetti) this.startConfetti(banner);

    banner.alpha = 0;
    await this.anim.tween(260, (t) => {
      banner.alpha = Math.min(1, t * 1.6);
      content.scale.set(0.6 + 0.4 * ease.outBack(t));
    });

    if (amount && options.amount) {
      const { to, format, durationMs } = options.amount;
      let elapsed = 0;
      const fit = () => {
        amount.scale.set(1);
        if (amount.width > w * 0.9) amount.scale.set((w * 0.9) / amount.width);
      };
      while (elapsed < durationMs && !this.bannerSkip) {
        await this.anim.wait(30);
        elapsed += 30;
        amount.text = format(to * ease.outCubic(Math.min(1, elapsed / durationMs)));
        fit();
      }
      amount.text = format(to);
      fit();
      await this.anim.tween(220, (t) => amount.scale.set(amount.scale.x * (1 + 0.012 * t)), ease.pulse);
    }

    // Hold until the time is up or the player taps.
    let held = this.bannerSkip ? options.holdMs - 350 : 0;
    this.bannerSkip = false;
    while (held < options.holdMs && !this.bannerSkip) {
      await this.anim.wait(40);
      held += 40;
    }

    await this.anim.tween(180, (t) => (banner.alpha = 1 - t));
    this.stopConfetti();
    this.banner = null;
    banner.destroy({ children: true });
  }

  private startConfetti(parent: Container): void {
    for (let i = 0; i < 90; i++) {
      const sprite = new Sprite(this.dot);
      sprite.anchor.set(0.5);
      sprite.tint = CONFETTI[i % CONFETTI.length];
      sprite.scale.set(0.5 + Math.random() * 0.5, 0.9 + Math.random() * 0.9);
      sprite.position.set(Math.random() * this.boardW, -Math.random() * this.boardH);
      sprite.rotation = Math.random() * Math.PI;
      parent.addChildAt(sprite, 1);
      this.flakes.push({ sprite, vx: (Math.random() - 0.5) * 0.08, vy: 0.16 + Math.random() * 0.22, spin: (Math.random() - 0.5) * 0.012 });
    }
  }

  private stopConfetti(): void {
    this.flakes = [];
  }

  private updateConfetti(deltaMs: number): void {
    if (this.flakes.length === 0) return;
    const dt = Math.min(deltaMs, 100);
    for (const flake of this.flakes) {
      const s = flake.sprite;
      s.x += flake.vx * dt;
      s.y += flake.vy * dt;
      s.rotation += flake.spin * dt;
      if (s.y > this.boardH + 20) {
        s.y = -20;
        s.x = Math.random() * this.boardW;
      }
    }
  }
}
