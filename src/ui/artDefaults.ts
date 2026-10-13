/**
 * The icons drawn for the game (beer, seven, picnic table, microphone, goal). Each one takes the place
 * of the base symbol whose colours it shares. They are SVG files in ./art, turned into 256px pictures at start-up.
 */
import beer from './art/beer.svg?raw';
import seven from './art/seven.svg?raw';
import picnic from './art/picnic.svg?raw';
import mic from './art/mic.svg?raw';
import goal from './art/goal.svg?raw';
import guitar from './art/guitar.svg?raw';
import building from './art/building.svg?raw';
import plane from './art/plane.svg?raw';
import frites from './art/frites.svg?raw';
import scatterUrl from './art/scatter.png';
import { ICON_PX } from './icons';

/** Symbol id → bundled icon. */
const BUNDLED: Record<string, string> = {
  banana: beer,
  red: seven,
  green: picnic,
  purple: mic,
  blue: goal,
  watermelon: guitar,
  apple: building,
  plum: plane,
  grapes: frites,
};

/** Pictures that are already bitmaps (the scatter photo). Not wrapped in an SVG: Safari draws such SVGs empty. */
const BITMAPS: Record<string, string> = { scatter: scatterUrl };

function bitmapToPng(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ICON_PX;
      canvas.height = ICON_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      // Fit the whole picture in the square, centred.
      const k = Math.min(ICON_PX / img.naturalWidth, ICON_PX / img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      ctx.drawImage(img, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('bitmap'));
    img.src = url;
  });
}

function toPng(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = ICON_PX;
      canvas.height = ICON_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas'));
      ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('svg'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** The bundled icons of the given symbol ids, as PNG data URLs. A picture that fails to load is skipped. */
export async function rasterizeArt(ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    ids.map(async (id) => {
      const svg = BUNDLED[id];
      const bitmap = BITMAPS[id];
      if (!svg && !bitmap) return;
      try {
        out.set(id, bitmap ? await bitmapToPng(bitmap) : await toPng(svg));
      } catch {
        /* keep the drawn symbol */
      }
    }),
  );
  return out;
}
