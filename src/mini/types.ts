/** Mini games played with the phones at the end of every round. The big screen runs them, the phones send inputs. */

export type MiniKind = 'click' | 'flappy' | 'bomber' | 'agar' | 'snake' | 'tanks' | 'sabre';

export interface MiniPlayer {
  id: number;
  name: string;
  color: string;
}

/** What a phone can send during a mini game. */
export type MiniInput =
  | { a: 'tap' }
  /** A direction pad: 0 up, 1 right, 2 down, 3 left, or -1 when the finger is lifted. */
  | { a: 'dir'; d: number }
  | { a: 'bomb' }
  /** The fire button of the tanks. */
  | { a: 'fire' }
  /** The aim joystick of the tanks: it points the barrel and shoots when pushed all the way. */
  | { a: 'aim'; x: number; y: number }
  /** A sword strike: 0 up, 1 right, 2 down, 3 left. */
  | { a: 'slash'; d: number }
  /** A joystick: a vector with length 0 to 1 (0, 0 when released). */
  | { a: 'move'; x: number; y: number };

/** The logical size every game draws in. The canvas is scaled to the screen. */
export const MINI_W = 960;
export const MINI_H = 600;

export interface MiniGame {
  readonly kind: MiniKind;
  /** Longest time the game can take, in seconds. */
  readonly maxTime: number;
  readonly over: boolean;
  update(dt: number): void;
  input(id: number, input: MiniInput): void;
  /** Everybody, best first. Valid at any moment (it is final once `over`). */
  ranking(): number[];
  /** A short live label for each player (score, "out"...). */
  labels(): Record<number, string>;
  render(ctx: CanvasRenderingContext2D): void;
}

export const COLORS = ['#ff5c8a', '#ffd23f', '#3ecf8e', '#5cc8ff', '#b388ff', '#ff9a3c'];

export interface MiniInfo {
  kind: MiniKind;
  title: string;
  rules: string;
  controls: 'tap' | 'pad' | 'padbomb' | 'stick' | 'tank' | 'sabre';
}

export const MINI_INFO: Record<MiniKind, MiniInfo> = {
  click: { kind: 'click', title: 'Click Rush', rules: 'Tape sur ton téléphone le plus vite possible pendant 5 secondes ! Le nombre de clics départage tout le monde.', controls: 'tap' },
  flappy: { kind: 'flappy', title: 'Flappy Course', rules: 'Tous les oiseaux volent sur le même écran. Tape pour battre des ailes et passe entre les tuyaux verts. Le dernier en vol gagne.', controls: 'tap' },
  bomber: { kind: 'bomber', title: 'Bomberman', rules: 'Pose des bombes, casse les blocs et évite les flammes. Le dernier debout gagne.', controls: 'padbomb' },
  agar: { kind: 'agar', title: 'Agar.io', rules: 'Mange les billes pour grossir, puis avale les plus petits que toi. Joystick pour bouger.', controls: 'stick' },
  tanks: { kind: 'tanks', title: 'Tanks', rules: 'Joystick gauche : avancer. Joystick droit : viser, et pousse-le à fond pour tirer. Les balles rebondissent sur les murs ! Les caisses cassent et reviennent après 10 secondes. Vous avez 3 vies chacun et vous réapparaissez. Le dernier tank en jeu gagne. Mets ton téléphone à l’horizontale.', controls: 'tank' },
  sabre: { kind: 'sabre', title: 'Duel de sabres', rules: 'Une flèche apparaît après un temps au hasard : fais vite le geste du sabre dans cette direction avec ton téléphone (ou touche la flèche) ! Un coup trop tôt ou dans la mauvaise direction te bloque pour la manche. Premier à 5 points.', controls: 'sabre' },
  snake: { kind: 'snake', title: 'Snake.io', rules: 'Joystick libre dans tous les sens : mange pour grandir, évite les murs et le corps des autres serpents. Le dernier en vie gagne.', controls: 'stick' },
};

/** Points for the winners of a mini game: 50 and 25 with 4 players or more, only 30 for the winner with fewer. */
export function rewardsFor(playerCount: number): number[] {
  return playerCount >= 4 ? [50, 25] : [30];
}

export type Rng = () => number;

/** Draw a name tag above something. */
export function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#fff'): void {
  ctx.font = '700 14px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20,6,30,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Rank players: alive ones by `score` (higher first), then the dead, the later the death the better. */
export function rankSurvival(ids: number[], alive: (id: number) => boolean, score: (id: number) => number, deadAt: (id: number) => number): number[] {
  return [...ids].sort((a, b) => {
    const aa = alive(a);
    const ab = alive(b);
    if (aa !== ab) return aa ? -1 : 1;
    if (aa) return score(b) - score(a) || a - b;
    return deadAt(b) - deadAt(a) || score(b) - score(a) || a - b;
  });
}
