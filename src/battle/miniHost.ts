/**
 * The big screen side of a mini game: the dialog with the canvas, the intro, the countdown, the game itself and the
 * results. The phones follow through the `MiniView` that is sent with every picture of the game.
 */
import { COLORS, MINI_H, MINI_INFO, MINI_W, type MiniGame, type MiniInput, type MiniKind, type MiniPlayer, createMini } from '../mini';
import type { MiniView } from '../net/protocol';

const INTRO_S = 6;
const COUNT_S = 3;
const AFTER_S = 1.2;
const RESULT_S = 7;

export interface MiniOptions {
  kind: MiniKind;
  players: Array<{ id: number; name: string }>;
  rewards: number[];
  onView: (view: MiniView) => void;
  /** Called once, with the ranking, when the results have been shown. */
  onDone: (ranking: number[]) => void;
}

export class MiniRun {
  private dialog = document.createElement('dialog');
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private game: MiniGame;
  private stage: MiniView['stage'] = 'intro';
  private stageStart = performance.now();
  private last = performance.now();
  private raf = 0;
  private lastView = 0;
  private after = 0;
  private finished = false;
  private ranking: number[] = [];
  /** The labels at the end of the game: the numbers that settle the ranking. */
  private finalLabels: Record<number, string> = {};
  private readonly info;
  private readonly roster: MiniPlayer[];

  constructor(private o: MiniOptions) {
    this.roster = o.players.map((p) => ({ id: p.id, name: p.name, color: COLORS[p.id % COLORS.length] }));
    this.game = createMini(o.kind, this.roster);
    this.info = MINI_INFO[o.kind];
    this.dialog.className = 'mini-dialog';
    this.canvas.width = MINI_W;
    this.canvas.height = MINI_H;
    this.canvas.className = 'mini-canvas';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas');
    this.ctx = ctx;
    this.dialog.append(this.canvas);
    this.dialog.addEventListener('cancel', (e) => e.preventDefault());
  }

  start(): void {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.setStage('intro');
    this.raf = requestAnimationFrame(this.frame);
  }

  input(id: number, input: MiniInput): void {
    if (this.stage === 'play') this.game.input(id, input);
  }

  abort(): void {
    this.finished = true;
    cancelAnimationFrame(this.raf);
    this.dialog.close();
    this.dialog.remove();
  }

  private elapsed(): number {
    return (performance.now() - this.stageStart) / 1000;
  }

  private setStage(stage: MiniView['stage']): void {
    this.stage = stage;
    this.stageStart = performance.now();
    this.push();
  }

  private view(): MiniView {
    const left =
      this.stage === 'intro' ? INTRO_S - this.elapsed() : this.stage === 'count' ? COUNT_S - this.elapsed() : this.stage === 'play' ? this.game.maxTime - this.elapsed() : RESULT_S - this.elapsed();
    return {
      kind: this.o.kind,
      title: this.info.title,
      rules: this.info.rules,
      controls: this.info.controls,
      stage: this.stage,
      left: Math.max(0, Math.ceil(left)),
      labels: this.game.labels(),
      ranking: this.stage === 'result' ? this.ranking.map((id, i) => ({ id, reward: this.o.rewards[i] ?? 0, label: this.finalLabels[id] ?? '' })) : undefined,
      names: Object.fromEntries(this.roster.map((p) => [p.id, p.name])),
    };
  }

  private push(): void {
    this.lastView = performance.now();
    this.o.onView(this.view());
  }

  private frame = (now: number): void => {
    if (this.finished) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = this.elapsed();
    if (this.stage === 'intro' && t >= INTRO_S) this.setStage('count');
    else if (this.stage === 'count' && t >= COUNT_S) this.setStage('play');
    else if (this.stage === 'play') {
      let rest = dt;
      while (rest > 0) {
        const step = Math.min(rest, 1 / 60);
        this.game.update(step);
        rest -= step;
      }
      if (this.game.over) {
        this.after += dt;
        if (this.after >= AFTER_S) {
          this.ranking = this.game.ranking();
          this.finalLabels = this.game.labels();
          this.setStage('result');
        }
      }
    } else if (this.stage === 'result' && t >= RESULT_S) {
      this.finished = true;
      this.dialog.close();
      this.dialog.remove();
      this.o.onDone(this.ranking);
      return;
    }
    // The phones get a fresh picture of the stage often, so their countdown follows the big screen.
    if (!this.finished && now - this.lastView > 250) this.push();
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(): void {
    const c = this.ctx;
    if (this.stage === 'play') {
      this.game.render(c);
      this.hud();
      return;
    }
    if (this.stage === 'count') {
      // The game is already on screen under the countdown: everybody finds their place before it starts.
      this.game.render(c);
      c.fillStyle = 'rgba(18,6,26,0.55)';
      c.fillRect(0, 0, MINI_W, MINI_H);
      c.textAlign = 'center';
      c.fillStyle = '#ffd23f';
      c.font = '400 220px "Lilita One", sans-serif';
      c.lineWidth = 14;
      c.strokeStyle = 'rgba(18,6,26,0.9)';
      const n = String(Math.max(1, Math.ceil(COUNT_S - this.elapsed())));
      c.strokeText(n, MINI_W / 2, 360);
      c.fillText(n, MINI_W / 2, 360);
      c.font = '400 54px "Lilita One", sans-serif';
      c.fillStyle = '#ff5c8a';
      c.strokeText(this.info.title, MINI_W / 2, 120);
      c.fillText(this.info.title, MINI_W / 2, 120);
      c.font = '700 24px Nunito, sans-serif';
      c.fillStyle = '#fff';
      c.strokeText('Retrouve ta couleur et ton nom : ça démarre !', MINI_W / 2, 560);
      c.fillText('Retrouve ta couleur et ton nom : ça démarre !', MINI_W / 2, 560);
      return;
    }
    c.fillStyle = '#12061a';
    c.fillRect(0, 0, MINI_W, MINI_H);
    c.textAlign = 'center';
    c.fillStyle = '#ff5c8a';
    c.font = '400 76px "Lilita One", sans-serif';
    c.fillText(this.info.title, MINI_W / 2, 150);
    if (this.stage === 'intro') {
      c.fillStyle = '#fff';
      c.font = '700 28px Nunito, sans-serif';
      wrap(c, this.info.rules, MINI_W / 2, 230, 760, 38);
      c.fillStyle = '#ffd23f';
      c.font = '700 24px Nunito, sans-serif';
      c.fillText('Prends ton téléphone : les commandes arrivent dessus.', MINI_W / 2, 380);
      this.roster.forEach((p, i) => {
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(MINI_W / 2 - ((this.roster.length - 1) * 70) / 2 + i * 70, 450, 22, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#fff';
        c.font = '700 16px Nunito, sans-serif';
        c.fillText(p.name, MINI_W / 2 - ((this.roster.length - 1) * 70) / 2 + i * 70, 494);
      });
      c.fillStyle = '#fff';
      c.font = '400 40px "Lilita One", sans-serif';
      c.fillText(String(Math.max(1, Math.ceil(INTRO_S - this.elapsed()))), MINI_W / 2, 560);
    } else {
      c.fillStyle = '#fff';
      c.font = '700 26px Nunito, sans-serif';
      c.fillText('Résultats', MINI_W / 2, 210);
      this.ranking.forEach((id, i) => {
        const p = this.roster.find((x) => x.id === id);
        if (!p) return;
        const y = 270 + i * 52;
        const reward = this.o.rewards[i] ?? 0;
        c.textAlign = 'left';
        c.fillStyle = p.color;
        c.font = '400 38px "Lilita One", sans-serif';
        c.fillText(`${i + 1}. ${p.name}`, 150, y);
        c.textAlign = 'right';
        c.fillStyle = '#fff';
        c.font = '700 26px Nunito, sans-serif';
        c.fillText(this.finalLabels[id] ?? '', MINI_W - 330, y);
        c.fillStyle = reward > 0 ? '#3ecf8e' : 'rgba(255,255,255,0.45)';
        c.font = '400 38px "Lilita One", sans-serif';
        c.fillText(reward > 0 ? `+${reward} pts` : '—', MINI_W - 150, y);
      });
    }
  }

  private hud(): void {
    const c = this.ctx;
    const left = Math.max(0, this.game.maxTime - this.elapsed());
    c.textAlign = 'right';
    c.font = '400 28px "Lilita One", sans-serif';
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(20,6,30,0.9)';
    const text = this.game.over ? 'Terminé !' : `${Math.ceil(left)} s`;
    c.strokeText(text, MINI_W - 16, 36);
    c.fillStyle = '#ffd23f';
    c.fillText(text, MINI_W - 16, 36);
    const labels = this.game.labels();
    c.textAlign = 'left';
    c.font = '700 15px Nunito, sans-serif';
    this.roster.forEach((p, i) => {
      const line = `${p.name} · ${labels[p.id] ?? ''}`;
      c.strokeText(line, 14, 24 + i * 20);
      c.fillStyle = p.color;
      c.fillText(line, 14, 24 + i * 20);
    });
  }
}

function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (c.measureText(test).width > maxWidth && line) {
      c.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else line = test;
  }
  if (line) c.fillText(line, x, yy);
}
