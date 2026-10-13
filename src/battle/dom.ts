/** Small DOM helpers shared by the big screen and the phone controller. Text is always set with textContent, so names are safe. */
type Attrs = Record<string, string | number | boolean>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...kids);
  return node;
}

/** A row of glass segments: `left` full ones, the rest empty, the last `drinking` full ones marked as about to be drunk. */
export function beerBar(p: { glass: number; drinkName: string }, left: number, drinking = 0, label = ''): HTMLElement {
  const size = p.glass;
  const bar = h('div', { class: 'beer', role: 'img', 'aria-label': label || `${p.drinkName} : ${left} parts sur ${size}` });
  bar.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  for (let i = 0; i < size; i++) {
    const cls = i >= left ? 'seg empty' : i >= left - drinking ? 'seg drink' : 'seg';
    bar.append(h('i', { class: cls }));
  }
  return bar;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const parts = (n: number) => plural(n, 'part', 'parts');
export const beers = (p: { partsDrunk: number; glass: number }) => (p.partsDrunk / p.glass).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * The draw for who starts: the names light up one after the other, slower and slower, and stop on the winner.
 * The same code runs on the big screen and on every phone, so they all see it at the same time.
 */
export function drawView(names: readonly string[], winner: number): Node[] {
  const chips = names.map((n) => h('li', { class: 'draw-name' }, n));
  const list = h('ul', { class: 'draw-list' }, ...chips);
  const result = h('p', { class: 'draw-result' }, '…');
  const n = names.length;
  const steps = n * 4 + winner; // a few laps, and the last step is the winner
  let step = 0;
  const light = (i: number) => chips.forEach((c, k) => c.classList.toggle('on', k === i));
  const tick = () => {
    if (!list.isConnected && step > 0) return;
    light(step % n);
    if (step >= steps) {
      chips[winner].classList.add('won');
      result.textContent = `${names[winner]} commence !`;
      return;
    }
    const delay = 70 + Math.pow(step / steps, 3) * 520;
    step++;
    setTimeout(tick, delay);
  };
  setTimeout(tick, 50);
  return [h('h2', {}, 'Tirage au sort'), h('p', {}, 'Qui commence ?'), list, result];
}

/** How long the draw is shown (milliseconds), so the big screen and the phones close it together. */
export const DRAW_MS = 6500;

let glassCount = 0;
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A beer mug that empties. The lines cut it into `size` parts (numbered from the bottom), the orange zone is
 * what the player has to drink, and the beer level goes down through it. `before` parts are in the glass,
 * `drink` of them are drunk, `delayMs` waits before the glass starts to empty.
 */
export function drainGlass(size: number, before: number, drink: number, delayMs = 600, caption = ''): HTMLElement {
  const id = `g${++glassCount}`;
  const X0 = 30;
  const X1 = 110;
  const TOP = 22;
  const BOTTOM = 168;
  const ph = (BOTTOM - TOP) / size;
  const y = (parts: number) => BOTTOM - parts * ph;
  const t0 = (size - before) * ph;
  const t1 = (size - Math.max(0, before - drink)) * ph;

  const root = svg('svg', { class: 'mug', viewBox: '0 0 160 190', role: 'img', 'aria-label': drink > 0 ? `${drink} parts à boire sur ${size}` : 'Rien à boire' });
  const defs = svg('defs', {});
  const clip = svg('clipPath', { id: `${id}c` });
  clip.append(svg('rect', { x: String(X0), y: String(TOP), width: String(X1 - X0), height: String(BOTTOM - TOP), rx: '6' }));
  const mask = svg('mask', { id: `${id}m` });
  const maskLevel = svg('g', { class: 'level', style: `transform: translateY(${t0}px)` });
  maskLevel.append(svg('rect', { x: String(X0), y: String(TOP), width: String(X1 - X0), height: String(BOTTOM - TOP + 4), fill: '#fff' }));
  mask.append(maskLevel);
  defs.append(clip, mask);

  const body = svg('g', { 'clip-path': `url(#${id}c)` });
  const beerLevel = svg('g', { class: 'level', style: `transform: translateY(${t0}px)` });
  beerLevel.append(svg('rect', { x: String(X0), y: String(TOP), width: String(X1 - X0), height: String(BOTTOM - TOP + 4), fill: '#ffb21e' }), svg('rect', { x: String(X0), y: String(TOP), width: String(X1 - X0), height: String(BOTTOM - TOP + 4), fill: 'url(#' + id + 'g)' }));
  const grad = svg('linearGradient', { id: `${id}g`, x1: '0', x2: '1', y1: '0', y2: '0' });
  grad.append(svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.35' }), svg('stop', { offset: '0.35', 'stop-color': '#fff', 'stop-opacity': '0' }), svg('stop', { offset: '1', 'stop-color': '#7a3d00', 'stop-opacity': '0.35' }));
  defs.append(grad);
  for (let i = 0; i < 6; i++) beerLevel.append(svg('circle', { class: 'bubble', cx: String(X0 + 12 + i * 12), cy: String(TOP + 40 + ((i * 37) % 60)), r: String(1.6 + (i % 3) * 0.7), style: `animation-delay:${i * 0.45}s` }));
  const foam = svg('g', { class: 'foam' });
  foam.append(svg('rect', { x: String(X0), y: String(TOP - 2), width: String(X1 - X0), height: '9', fill: '#fff8e7' }));
  for (let i = 0; i < 5; i++) foam.append(svg('circle', { cx: String(X0 + 8 + i * 16), cy: String(TOP + 7), r: '7', fill: '#fff8e7' }));
  beerLevel.append(foam);
  body.append(beerLevel);

  if (drink > 0) {
    const zone = svg('rect', { class: 'zone', x: String(X0), y: String(y(before)), width: String(X1 - X0), height: String(Math.min(drink, before) * ph), fill: '#ff4d2e', mask: `url(#${id}m)` });
    body.append(zone);
  }

  const ticks = svg('g', { class: 'ticks' });
  const every = size <= 10 ? 1 : size <= 20 ? 5 : 10;
  for (let i = 1; i <= size; i++) {
    const yy = y(i);
    if (i < size) ticks.append(svg('line', { x1: String(X0), x2: String(X1), y1: String(yy), y2: String(yy), class: i % every === 0 || size <= 10 ? 'tick strong' : 'tick' }));
    if (i % every === 0 || i === size) {
      const label = svg('text', { x: String(X0 - 6), y: String(yy + ph / 2 + 4), class: 'tick-n', 'text-anchor': 'end' });
      label.textContent = String(i);
      ticks.append(label);
    }
  }
  const handle = svg('path', { d: `M${X1} ${TOP + 30} h22 q14 0 14 18 v34 q0 18 -14 18 h-22`, class: 'mug-line', fill: 'none' });
  const outline = svg('path', { d: `M${X0} ${TOP - 4} V${BOTTOM - 4} q0 10 10 10 h${X1 - X0 - 20} q10 0 10 -10 V${TOP - 4}`, class: 'mug-line', fill: 'rgba(255,255,255,0.08)' });
  // The empty part of the glass is drawn first so the beer sits on top of it.
  root.append(defs, outline, body, ticks, handle);

  const fig = h('figure', { class: 'mug-fig' }, root, h('figcaption', {}, caption || (drink > 0 ? `À boire : ${parts(drink)}` : 'Rien à boire')));
  const move = (to: number) => {
    for (const g of [maskLevel, beerLevel]) g.setAttribute('style', `transform: translateY(${to}px)`);
  };
  if (drink > 0 && !reducedMotion()) {
    setTimeout(() => {
      if (!fig.isConnected) return;
      fig.classList.add('draining');
      requestAnimationFrame(() => move(t1));
    }, delayMs);
  } else if (drink > 0) {
    move(t1);
  }
  return fig;
}
