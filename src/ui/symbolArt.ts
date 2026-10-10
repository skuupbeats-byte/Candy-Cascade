/**
 * Original symbol artwork, drawn with vector shapes at start-up and baked
 * into textures. No image files: gameplay is never blocked on art, and the
 * drawings can be replaced one function at a time.
 */
import { Container, Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';

/** Side of the square each symbol is drawn into (centred on 0,0). */
export const ART_SIZE = 128;

type Draw = (root: Container) => void;

function part(root: Container, draw: (g: Graphics) => void, at: { x?: number; y?: number; rotation?: number } = {}): Graphics {
  const g = new Graphics();
  draw(g);
  g.position.set(at.x ?? 0, at.y ?? 0);
  g.rotation = at.rotation ?? 0;
  root.addChild(g);
  return g;
}

function gloss(root: Container, x: number, y: number, rx: number, ry: number, rotation = -0.6, alpha = 0.55): void {
  part(root, (g) => g.ellipse(0, 0, rx, ry).fill({ color: 0xffffff, alpha }), { x, y, rotation });
}

function leaf(root: Container, x: number, y: number, rotation: number, size = 1): void {
  part(
    root,
    (g) =>
      g
        .moveTo(-16 * size, 0)
        .quadraticCurveTo(0, -13 * size, 16 * size, 0)
        .quadraticCurveTo(0, 13 * size, -16 * size, 0)
        .fill(0x58c441)
        .stroke({ width: 3, color: 0x1f7a2a, join: 'round' }),
    { x, y, rotation },
  );
}

function stem(root: Container, x: number, y: number, rotation: number, length = 20): void {
  part(root, (g) => g.roundRect(-3.5, -length, 7, length, 3).fill(0x7a4a23).stroke({ width: 2, color: 0x4a2a10 }), { x, y, rotation });
}

const heart = (g: Graphics, s: number): Graphics =>
  g
    .moveTo(0, 46 * s)
    .bezierCurveTo(-64 * s, 4 * s, -56 * s, -48 * s, -26 * s, -48 * s)
    .bezierCurveTo(-10 * s, -48 * s, 0, -38 * s, 0, -26 * s)
    .bezierCurveTo(0, -38 * s, 10 * s, -48 * s, 26 * s, -48 * s)
    .bezierCurveTo(56 * s, -48 * s, 64 * s, 4 * s, 0, 46 * s)
    .closePath();

const DRAW: Record<string, Draw> = {
  red(root) {
    part(root, (g) => heart(g, 1).fill(0xff2e63).stroke({ width: 5, color: 0xa30f3c, join: 'round' }));
    part(root, (g) => heart(g, 0.68).fill({ color: 0xff7d9d, alpha: 0.75 }), { y: -3 });
    gloss(root, -24, -28, 11, 6);
  },

  purple(root) {
    part(root, (g) => g.roundRect(-44, -44, 88, 88, 22).fill(0x9a4dff).stroke({ width: 5, color: 0x5320b0 }));
    part(root, (g) => g.roundRect(-30, -30, 60, 60, 13).fill({ color: 0xc194ff, alpha: 0.85 }));
    gloss(root, -24, -28, 12, 6);
  },

  green(root) {
    part(root, (g) => g.roundPoly(0, 2, 50, 5, 13).fill(0x2bc85a).stroke({ width: 5, color: 0x0f7d33, join: 'round' }));
    part(root, (g) => g.roundPoly(0, 2, 33, 5, 9).fill({ color: 0x86eda2, alpha: 0.85 }));
    gloss(root, -17, -24, 11, 6);
  },

  blue(root) {
    part(root, (g) => {
      g.poly([-30, 0, -58, -24, -52, 0, -58, 24]).fill(0x8fd0ff).stroke({ width: 4, color: 0x0e5fc0, join: 'round' });
      g.poly([30, 0, 58, -24, 52, 0, 58, 24]).fill(0x8fd0ff).stroke({ width: 4, color: 0x0e5fc0, join: 'round' });
    });
    part(root, (g) => g.ellipse(0, 0, 38, 32).fill(0x2e9bff).stroke({ width: 5, color: 0x0e5fc0 }));
    part(root, (g) => g.ellipse(0, 0, 25, 20).fill({ color: 0x8fd0ff, alpha: 0.85 }));
    gloss(root, -17, -17, 10, 5);
  },

  apple(root) {
    stem(root, 2, -30, 0.25, 22);
    leaf(root, 22, -44, -0.45);
    part(root, (g) =>
      g
        .moveTo(0, -30)
        .bezierCurveTo(-22, -46, -52, -28, -48, 6)
        .bezierCurveTo(-45, 36, -22, 52, 0, 44)
        .bezierCurveTo(22, 52, 45, 36, 48, 6)
        .bezierCurveTo(52, -28, 22, -46, 0, -30)
        .closePath()
        .fill(0xf4511e)
        .stroke({ width: 5, color: 0x9c2a08, join: 'round' }),
    );
    part(root, (g) => g.ellipse(8, 10, 24, 22).fill({ color: 0xff8a4c, alpha: 0.6 }));
    gloss(root, -24, -8, 7, 14, 0.35);
  },

  plum(root) {
    stem(root, 4, -36, 0.3, 16);
    leaf(root, 22, -44, -0.3, 0.8);
    part(root, (g) => g.ellipse(0, 6, 38, 44).fill(0x4f46e5).stroke({ width: 5, color: 0x24208f }), { rotation: 0.22 });
    part(root, (g) => g.moveTo(2, -34).quadraticCurveTo(-14, 0, 0, 30).stroke({ width: 4, color: 0x24208f, alpha: 0.55, cap: 'round' }), { rotation: 0.22 });
    gloss(root, -18, -10, 7, 15, 0.45, 0.45);
  },

  watermelon(root) {
    part(root, (g) => g.moveTo(56, -20).arc(0, -20, 56, 0, Math.PI).closePath().fill(0x1e9e48).stroke({ width: 5, color: 0x0c5e27, join: 'round' }));
    part(root, (g) => g.moveTo(47, -20).arc(0, -20, 47, 0, Math.PI).closePath().fill(0xf3f7d4));
    part(root, (g) => g.moveTo(41, -20).arc(0, -20, 41, 0, Math.PI).closePath().fill(0xff4d6d));
    for (const [x, y, r] of [[-22, -8, 0.5], [0, -4, 0], [22, -8, -0.5], [-10, 10, 0.3], [11, 10, -0.3]] as const) {
      part(root, (g) => g.ellipse(0, 0, 3, 5.5).fill(0x3a1020), { x, y, rotation: r });
    }
    gloss(root, -20, -14, 12, 3.5, 0, 0.35);
  },

  grapes(root) {
    stem(root, 0, -34, 0.15, 16);
    leaf(root, 16, -46, -0.25, 0.85);
    for (const [x, y] of [[-27, -18], [0, -20], [27, -18], [-14, 6], [14, 6], [0, 30]] as const) {
      part(root, (g) => g.circle(0, 0, 16).fill(0xc238d6).stroke({ width: 4, color: 0x74148a }), { x, y });
      gloss(root, x - 5, y - 6, 5, 3, -0.6, 0.6);
    }
  },

  banana(root) {
    part(root, (g) =>
      g
        .moveTo(-46, -30)
        .quadraticCurveTo(-30, 50, 46, 14)
        .quadraticCurveTo(54, 8, 48, 0)
        .quadraticCurveTo(-6, 24, -30, -36)
        .quadraticCurveTo(-40, -42, -46, -30)
        .closePath()
        .fill(0xffd23f)
        .stroke({ width: 5, color: 0xb27a00, join: 'round' }),
    );
    part(root, (g) => g.moveTo(-36, -22).quadraticCurveTo(-22, 34, 34, 16).stroke({ width: 5, color: 0xfff1a8, alpha: 0.8, cap: 'round' }));
    part(root, (g) => g.circle(-39, -33, 6).fill(0x6b4a1b));
    part(root, (g) => g.circle(49, 7, 5).fill(0x6b4a1b));
  },

  scatter(root) {
    part(root, (g) => g.circle(0, -8, 52).fill({ color: 0xffd84a, alpha: 0.22 }));
    part(root, (g) => g.roundRect(-5, 0, 10, 62, 5).fill(0xfff4e6).stroke({ width: 3, color: 0x8a6d4a }), { rotation: -0.5, y: 10, x: 6 });
    const cx = 0;
    const cy = -8;
    const r = 40;
    const wedges = 8;
    const rim = (a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const ctrl = (a: number): [number, number] => [cx + Math.cos(a - 0.75) * r * 0.55, cy + Math.sin(a - 0.75) * r * 0.55];
    part(root, (g) => g.circle(cx, cy, r).fill(0xffffff));
    for (let i = 0; i < wedges; i += 2) {
      const a0 = (i / wedges) * Math.PI * 2;
      const a1 = ((i + 1) / wedges) * Math.PI * 2;
      part(root, (g) =>
        g
          .moveTo(cx, cy)
          .quadraticCurveTo(...ctrl(a0), ...rim(a0))
          .arc(cx, cy, r, a0, a1)
          .quadraticCurveTo(...ctrl(a1), cx, cy)
          .closePath()
          .fill(0xff4f9a),
      );
    }
    part(root, (g) => g.circle(cx, cy, r).stroke({ width: 5, color: 0xa3125c }));
    gloss(root, -16, -26, 11, 6);
  },

  bomb(root) {
    part(root, (g) => g.circle(0, 6, 52).fill({ color: 0xffd84a, alpha: 0.18 }));
    part(root, (g) => g.moveTo(22, -26).quadraticCurveTo(26, -44, 40, -44).stroke({ width: 6, color: 0xfff4e6, cap: 'round' }));
    part(root, (g) => g.star(42, -46, 8, 13, 6).fill(0xffd84a).stroke({ width: 2, color: 0xff7a1a }));
    part(root, (g) => g.circle(0, 6, 42).fill(0x3a1552).stroke({ width: 6, color: 0xffd84a }));
    const sprinkles: Array<[number, number, number, number]> = [
      [-28, -12, 0.6, 0xff5fa2], [-14, -27, -0.4, 0x58e0c0], [10, -29, 0.9, 0xff5fa2], [29, -10, -0.7, 0x58e0c0],
      [-31, 16, -0.5, 0x58e0c0], [31, 18, 0.5, 0xff5fa2], [-16, 36, 0.3, 0xff5fa2], [14, 37, -0.3, 0x58e0c0],
    ];
    for (const [x, y, rotation, color] of sprinkles) {
      part(root, (g) => g.roundRect(-6, -2.5, 12, 5, 2.5).fill(color), { x, y, rotation });
    }
  },
};

/** Main colour of each symbol, used for particles and highlights. */
export const SYMBOL_COLORS: Record<string, number> = {
  red: 0xff2e63,
  purple: 0x9a4dff,
  green: 0x2bc85a,
  blue: 0x2e9bff,
  apple: 0xf4511e,
  plum: 0x4f46e5,
  watermelon: 0xff4d6d,
  grapes: 0xc238d6,
  banana: 0xffd23f,
  scatter: 0xff4f9a,
  bomb: 0xffd84a,
};

/**
 * Bake one texture per symbol id. `ids` is the list of symbol ids in code
 * order (config symbols, then 'scatter', then 'bomb').
 */
export function createSymbolTextures(renderer: Renderer, ids: readonly string[]): Texture[] {
  const frame = new Rectangle(-ART_SIZE / 2, -ART_SIZE / 2, ART_SIZE, ART_SIZE);
  return ids.map((id) => {
    const root = new Container();
    const draw = DRAW[id];
    if (draw) draw(root);
    else part(root, (g) => g.circle(0, 0, 44).fill(0x999999)); // unknown id: neutral placeholder
    const texture = renderer.generateTexture({ target: root, frame, resolution: 2, antialias: true });
    root.destroy({ children: true });
    return texture;
  });
}

/** A soft round dot for particles and confetti. */
export function createDotTexture(renderer: Renderer): Texture {
  const g = new Graphics().circle(0, 0, 8).fill(0xffffff);
  const texture = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
  g.destroy();
  return texture;
}
