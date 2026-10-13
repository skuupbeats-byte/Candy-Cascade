/** The 6 x 5 board: symbol sprites and the animations that play an engine result back. */
import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { GameConfig, GridSnapshot } from '../engine';
import { ART_SIZE, SYMBOL_COLORS } from './symbolArt';
import { type Animator, ease } from './tween';

export const CELL_W = 128;
export const CELL_H = 112;
const SYMBOL_SCALE = 104 / ART_SIZE;
/** The lollipop (scatter) is drawn bigger than the others so it stands out. */
const SCATTER_SCALE = 2;
/** The big scatter is pushed down a little so it does not poke out of the top row, and the board mask lets it spill out at the sides and the bottom. */
const SCATTER_DROP = 24;
const SPILL = 36;
export const DISPLAY_FONT = '"Lilita One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';

class SymbolView extends Container {
  private sprite: Sprite;
  private valueLabel: Text;
  code = -1;
  bombValue = 0;

  constructor(
    private textures: Texture[],
    private scatterCode: number,
  ) {
    super();
    this.sprite = new Sprite();
    this.sprite.anchor.set(0.5);
    this.sprite.scale.set(SYMBOL_SCALE);
    this.valueLabel = new Text({
      text: '',
      style: { fontFamily: DISPLAY_FONT, fontSize: 34, fill: 0xffd84a, stroke: { color: 0x1c0a24, width: 6, join: 'round' } },
    });
    this.valueLabel.anchor.set(0.5);
    this.valueLabel.position.set(0, 6);
    this.valueLabel.visible = false;
    this.addChild(this.sprite, this.valueLabel);
  }

  /** Pick up the symbol's texture again, after its picture was replaced. */
  refreshTexture(): void {
    if (this.code >= 0) this.sprite.texture = this.textures[this.code];
  }

  set(code: number, bombValue: number): void {
    this.code = code;
    this.bombValue = bombValue;
    this.sprite.texture = this.textures[code];
    const big = code === this.scatterCode;
    this.sprite.scale.set(big ? SYMBOL_SCALE * SCATTER_SCALE : SYMBOL_SCALE);
    this.sprite.y = big ? SCATTER_DROP : 0;
    this.zIndex = big ? 10 : 0; // above its neighbours
    this.valueLabel.visible = bombValue > 0;
    if (bombValue > 0) {
      this.valueLabel.text = `x${bombValue}`;
      this.valueLabel.style.fontSize = bombValue >= 100 ? 27 : 34;
    }
    this.scale.set(1);
    this.alpha = 1;
    this.rotation = 0;
  }
}

export class GridView extends Container {
  readonly boardWidth: number;
  readonly boardHeight: number;
  private cols: number;
  private rows: number;
  private cells: Array<SymbolView | null>;
  private pool: SymbolView[] = [];
  private layer = new Container();
  private fx = new Container();
  private dots: Sprite[] = [];
  private colors: number[];
  private scatterCode: number;
  /** Called as each column lands, for sound. */
  onColumnLand: (column: number) => void = () => {};

  constructor(
    private anim: Animator,
    private textures: Texture[],
    private dotTexture: Texture,
    config: GameConfig,
  ) {
    super();
    this.scatterCode = config.symbols.length; // the scatter comes right after the paying symbols
    this.cols = config.cols;
    this.rows = config.rows;
    this.boardWidth = this.cols * CELL_W;
    this.boardHeight = this.rows * CELL_H;
    this.cells = new Array(this.cols * this.rows).fill(null);
    this.colors = [...config.symbols.map((s) => SYMBOL_COLORS[s.id] ?? 0xffffff), SYMBOL_COLORS.scatter, SYMBOL_COLORS.bomb];

    const mask = new Graphics().rect(-SPILL, 0, this.boardWidth + 2 * SPILL, this.boardHeight + SPILL).fill(0xffffff);
    this.addChild(mask);
    this.layer.mask = mask;
    this.layer.sortableChildren = true;
    this.addChild(this.layer, this.fx);
  }

  /** A symbol picture was replaced: show the new one on every symbol on the board. */
  refreshArt(): void {
    for (const view of this.cells) view?.refreshTexture();
    for (const view of this.pool) view.refreshTexture();
  }

  cellX(position: number): number {
    return Math.floor(position / this.rows) * CELL_W + CELL_W / 2;
  }

  cellY(position: number): number {
    return (position % this.rows) * CELL_H + CELL_H / 2;
  }

  private obtain(code: number, bombValue: number): SymbolView {
    const view = this.pool.pop() ?? new SymbolView(this.textures, this.scatterCode);
    view.set(code, bombValue);
    this.layer.addChild(view);
    return view;
  }

  private release(view: SymbolView): void {
    this.layer.removeChild(view);
    this.pool.push(view);
  }

  /** Show a grid immediately, with no animation. */
  setGrid(grid: GridSnapshot): void {
    for (let i = 0; i < this.cells.length; i++) {
      const old = this.cells[i];
      if (old) this.release(old);
      const view = this.obtain(grid.symbols[i], grid.bombValues[i]);
      view.position.set(this.cellX(i), this.cellY(i));
      this.cells[i] = view;
    }
  }

  /** The old symbols fall away and a new grid drops in, column by column. */
  async dropIn(grid: GridSnapshot): Promise<void> {
    const jobs: Promise<void>[] = [];
    const leaving = this.cells.filter((c): c is SymbolView => c !== null);
    this.cells.fill(null);
    for (const view of leaving) {
      const from = view.y;
      const col = Math.round((view.x - CELL_W / 2) / CELL_W);
      jobs.push(
        this.anim
          .tween(240, (t) => (view.y = from + t * (this.boardHeight + CELL_H)), ease.inQuad, col * 22)
          .then(() => this.release(view)),
      );
    }
    const startDelay = leaving.length > 0 ? 150 : 0;
    for (let col = 0; col < this.cols; col++) {
      let last: Promise<void> | null = null;
      for (let row = this.rows - 1; row >= 0; row--) {
        const i = col * this.rows + row;
        const view = this.obtain(grid.symbols[i], grid.bombValues[i]);
        const to = this.cellY(i);
        const from = to - this.boardHeight - CELL_H;
        view.position.set(this.cellX(i), from);
        this.cells[i] = view;
        const delay = startDelay + col * 55 + (this.rows - 1 - row) * 30;
        last = this.anim.tween(380, (t) => (view.y = from + (to - from) * t), ease.land, delay);
        jobs.push(last);
      }
      if (last) void last.then(() => this.onColumnLand(col));
    }
    await Promise.all(jobs);
  }

  /** Winning symbols pulse while the rest of the board dims. */
  async highlight(positions: readonly number[]): Promise<void> {
    const winners = new Set(positions);
    const jobs: Promise<void>[] = [];
    this.cells.forEach((view, i) => {
      if (!view) return;
      if (winners.has(i)) {
        this.layer.addChild(view); // bring to front
        jobs.push(this.anim.tween(260, (t) => view.scale.set(1 + 0.2 * t), ease.pulse));
        jobs.push(this.anim.tween(260, (t) => view.scale.set(1 + 0.2 * t), ease.pulse, 260));
      } else {
        jobs.push(this.anim.tween(160, (t) => (view.alpha = 1 - 0.6 * t), ease.outQuad));
      }
    });
    await Promise.all(jobs);
  }

  /** Winning symbols burst and disappear. */
  async pop(positions: readonly number[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const i of positions) {
      const view = this.cells[i];
      if (!view) continue;
      this.cells[i] = null;
      this.burst(view.x, view.y, this.colors[view.code] ?? 0xffffff, 6);
      jobs.push(
        this.anim
          .tween(200, (t) => {
            view.scale.set(1 + 0.45 * t);
            view.alpha = 1 - t;
          }, ease.outQuad)
          .then(() => this.release(view)),
      );
    }
    for (const view of this.cells) {
      if (view && view.alpha < 1) {
        const from = view.alpha;
        jobs.push(this.anim.tween(200, (t) => (view.alpha = from + (1 - from) * t)));
      }
    }
    await Promise.all(jobs);
  }

  /** Survivors fall into the gaps and new symbols drop in from above. Call after `pop`. */
  async tumble(removed: readonly number[], after: GridSnapshot): Promise<void> {
    const gone = new Set(removed);
    const jobs: Promise<void>[] = [];
    const next: Array<SymbolView | null> = new Array(this.cells.length).fill(null);
    for (let col = 0; col < this.cols; col++) {
      const top = col * this.rows;
      let missing = 0;
      for (let row = 0; row < this.rows; row++) if (gone.has(top + row)) missing++;
      if (missing === 0) {
        for (let row = 0; row < this.rows; row++) next[top + row] = this.cells[top + row];
        continue;
      }
      // Survivors keep their order and end up at the bottom of the column.
      let target = this.rows - 1;
      for (let row = this.rows - 1; row >= 0; row--) {
        const view = this.cells[top + row];
        if (!view || gone.has(top + row)) continue;
        const i = top + target;
        next[i] = view;
        if (target !== row) jobs.push(this.fall(view, view.y, this.cellY(i), target - row, col));
        target--;
      }
      // New symbols queue up above the board.
      for (let row = missing - 1; row >= 0; row--) {
        const i = top + row;
        const view = this.obtain(after.symbols[i], after.bombValues[i]);
        const to = this.cellY(i);
        const from = to - missing * CELL_H;
        view.position.set(this.cellX(i), from);
        next[i] = view;
        jobs.push(this.fall(view, from, to, missing, col));
      }
    }
    this.cells = next;
    await Promise.all(jobs);
  }

  private fall(view: SymbolView, from: number, to: number, distance: number, col: number): Promise<void> {
    return this.anim.tween(200 + 55 * distance, (t) => (view.y = from + (to - from) * t), ease.land, col * 18);
  }

  /** A short attention pulse on some positions (scatters, bombs). */
  async pulse(positions: readonly number[], strength = 0.28, repeats = 2): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const i of positions) {
      const view = this.cells[i];
      if (!view) continue;
      this.layer.addChild(view);
      for (let n = 0; n < repeats; n++) {
        jobs.push(this.anim.tween(280, (t) => view.scale.set(1 + strength * t), ease.pulse, n * 280));
      }
    }
    await Promise.all(jobs);
  }

  /** A bomb goes off: flash, shake and sparks. Used when its value is collected. */
  async detonate(position: number): Promise<void> {
    const view = this.cells[position];
    if (!view) return;
    this.layer.addChild(view);
    this.burst(view.x, view.y, SYMBOL_COLORS.bomb, 10);
    await this.anim.tween(300, (t) => {
      view.scale.set(1 + 0.4 * t);
      view.rotation = Math.sin(t * Math.PI * 3) * 0.12;
    }, ease.pulse);
    view.rotation = 0;
    view.scale.set(1);
  }

  private burst(x: number, y: number, color: number, count: number): void {
    for (let n = 0; n < count; n++) {
      const dot = this.dots.pop() ?? new Sprite(this.dotTexture);
      dot.anchor.set(0.5);
      dot.tint = n % 3 === 0 ? 0xffffff : color;
      dot.position.set(x, y);
      this.fx.addChild(dot);
      const angle = (n / count) * Math.PI * 2 + Math.random() * 0.8;
      const reach = 46 + Math.random() * 44;
      const size = 0.5 + Math.random() * 0.7;
      void this.anim
        .tween(420, (t) => {
          dot.position.set(x + Math.cos(angle) * reach * t, y + Math.sin(angle) * reach * t + 40 * t * t);
          dot.scale.set(size * (1 - t * 0.6));
          dot.alpha = 1 - t * t;
        }, ease.outQuad)
        .then(() => {
          this.fx.removeChild(dot);
          this.dots.push(dot);
        });
    }
  }
}
