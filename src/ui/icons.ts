/**
 * The icon editor: replace any symbol with a picture from the computer or the phone.
 * The picture is framed in a square (zoom, move, round or rounded corners), saved in the
 * browser (localStorage) and applied to the board straight away.
 */
import type { Scene } from './scene';

/** French names for the symbols, by id. */
export const ICON_NAMES: Record<string, string> = {
  red: 'Le 7',
  purple: 'Micro',
  green: 'Table de pique-nique',
  blue: 'But',
  apple: 'Immeuble',
  plum: 'Avion',
  watermelon: 'Guitare',
  grapes: 'Frites',
  banana: 'Bière',
  scatter: 'Scatter (free spins)',
  bomb: 'Bombe (multiplicateur)',
};

const STORAGE_KEY = 'candy-cascade.icons.v1';
/** Side in pixels of a saved icon. The board draws them at about half that. */
export const ICON_PX = 256;

type Shape = 'none' | 'circle' | 'rounded';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function readStored(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.startsWith('data:image/')) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Returns false when the browser refused to keep it (storage full or blocked). */
function writeStored(icons: Record<string, string>): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(icons));
    return true;
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** Path of the frame the picture is cut to, on a canvas of `size` pixels. */
function framePath(ctx: CanvasRenderingContext2D, shape: Shape, size: number, inset = 0): void {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(size / 2, size / 2, size / 2 - inset, 0, Math.PI * 2);
  else if (shape === 'rounded') ctx.roundRect(inset, inset, size - 2 * inset, size - 2 * inset, size * 0.22);
  else ctx.rect(inset, inset, size - 2 * inset, size - 2 * inset);
}

export class IconEditor {
  private stored = readStored();
  private dialog = byId<HTMLDialogElement>('dlg-icons');
  private body = byId('icons-body');
  private note = byId('icons-note');
  private fileInput = byId<HTMLInputElement>('icon-file');
  private crop = byId<HTMLDialogElement>('dlg-crop');
  private canvas = byId<HTMLCanvasElement>('crop-canvas');
  private zoom = byId<HTMLInputElement>('crop-zoom');
  private border = byId<HTMLInputElement>('crop-border');

  private editing: string | null = null;
  private img: HTMLImageElement | null = null;
  private objectUrl: string | null = null;
  private shape: Shape = 'rounded';
  private offsetX = 0;
  private offsetY = 0;
  private drag: { x: number; y: number; ox: number; oy: number } | null = null;

  /** `ids` are the symbol ids in code order (the same list the scene was built with). */
  constructor(
    private scene: Scene,
    private ids: readonly string[],
    private onChange: () => void,
  ) {
    byId('btn-icons').addEventListener('click', () => this.open());
    byId('icons-reset-all').addEventListener('click', () => void this.resetAll());
    for (const dialog of [this.dialog, this.crop]) {
      dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    this.crop.addEventListener('close', () => this.releaseImage());

    this.fileInput.addEventListener('change', () => void this.onFile());
    this.zoom.addEventListener('input', () => this.draw());
    this.border.addEventListener('change', () => this.draw());
    document.querySelectorAll<HTMLButtonElement>('#crop-shapes button').forEach((b) =>
      b.addEventListener('click', () => {
        this.shape = b.dataset.shape as Shape;
        this.markShape();
        this.draw();
      }),
    );
    byId('crop-recenter').addEventListener('click', () => {
      this.offsetX = 0;
      this.offsetY = 0;
      this.zoom.value = '100';
      this.draw();
    });
    byId('crop-save').addEventListener('click', () => void this.save());

    // Moving the picture: one finger or the mouse. touch-action:none (in the CSS) stops the page from scrolling instead.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, ox: this.offsetX, oy: this.offsetY };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const k = ICON_PX / this.canvas.getBoundingClientRect().width;
      this.offsetX = this.drag.ox + (e.clientX - this.drag.x) * k;
      this.offsetY = this.drag.oy + (e.clientY - this.drag.y) * k;
      this.draw();
    });
    const end = (): void => {
      this.drag = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom.value = String(Math.min(Number(this.zoom.max), Math.max(Number(this.zoom.min), Number(this.zoom.value) - Math.sign(e.deltaY) * 8)));
        this.draw();
      },
      { passive: false },
    );
  }

  /** Put the saved pictures on the board. Called once at start-up. */
  async applySaved(): Promise<void> {
    await Promise.all(
      this.ids.map(async (id, code) => {
        const url = this.stored[id];
        if (!url) return;
        try {
          await this.scene.setSymbolArt(code, url);
        } catch {
          delete this.stored[id]; // unreadable picture: forget it
        }
      }),
    );
    this.onChange();
  }

  // ------------------------------------------------------------------ list

  private open(): void {
    void this.renderList();
    this.note.textContent = '';
    if (!this.dialog.open) this.dialog.showModal();
  }

  private async renderList(): Promise<void> {
    const cards = await Promise.all(
      this.ids.map(async (id, code) => {
        const card = document.createElement('div');
        card.className = 'icon-card';
        const img = document.createElement('img');
        img.alt = '';
        img.width = 72;
        img.height = 72;
        img.src = await this.scene.symbolImage(code);
        const name = document.createElement('span');
        name.className = 'icon-name';
        name.textContent = ICON_NAMES[id] ?? id;
        const change = document.createElement('button');
        change.type = 'button';
        change.className = 'chip primary';
        change.textContent = 'Changer';
        change.setAttribute('aria-label', `Changer l'icône : ${name.textContent}`);
        change.addEventListener('click', () => this.pick(id));
        card.append(img, name, change);
        if (this.stored[id]) {
          const reset = document.createElement('button');
          reset.type = 'button';
          reset.className = 'chip';
          reset.textContent = 'Rétablir';
          reset.setAttribute('aria-label', `Rétablir l'icône d'origine : ${name.textContent}`);
          reset.addEventListener('click', () => void this.reset(id));
          card.append(reset);
        }
        return card;
      }),
    );
    this.body.replaceChildren(...cards);
    byId<HTMLButtonElement>('icons-reset-all').disabled = Object.keys(this.stored).length === 0;
  }

  private pick(id: string): void {
    this.editing = id;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  private async reset(id: string): Promise<void> {
    const code = this.ids.indexOf(id);
    if (code < 0) return;
    delete this.stored[id];
    writeStored(this.stored);
    await this.scene.setSymbolArt(code, null);
    this.onChange();
    await this.renderList();
  }

  private async resetAll(): Promise<void> {
    for (const id of Object.keys(this.stored)) {
      const code = this.ids.indexOf(id);
      if (code >= 0) await this.scene.setSymbolArt(code, null);
    }
    this.stored = {};
    writeStored(this.stored);
    this.onChange();
    await this.renderList();
  }

  // ---------------------------------------------------------------- editor

  private async onFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    const id = this.editing;
    if (!file || !id) return;
    if (!file.type.startsWith('image/')) {
      this.note.textContent = "Ce fichier n'est pas une image.";
      return;
    }
    this.releaseImage();
    const url = URL.createObjectURL(file);
    try {
      this.img = await loadImage(url);
      this.objectUrl = url;
    } catch {
      URL.revokeObjectURL(url);
      this.note.textContent = "Impossible de lire cette image. Essaie un fichier JPG, PNG ou WebP.";
      return;
    }
    this.note.textContent = '';
    byId('crop-title').textContent = ICON_NAMES[id] ?? id;
    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom.value = '100';
    this.markShape();
    this.draw();
    if (!this.crop.open) this.crop.showModal();
  }

  private releaseImage(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.img = null;
  }

  private markShape(): void {
    document.querySelectorAll<HTMLButtonElement>('#crop-shapes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shape === this.shape)));
    this.border.disabled = this.shape === 'none';
  }

  /** Paint the picture, framed, onto a canvas. Used for the preview and for the saved icon. */
  private paint(target: HTMLCanvasElement): void {
    const ctx = target.getContext('2d');
    const img = this.img;
    if (!ctx || !img) return;
    const size = target.width;
    ctx.clearRect(0, 0, size, size);
    const k = size / ICON_PX;
    // Zoom 100 shows the whole picture inside the frame.
    const fit = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const scale = fit * (Number(this.zoom.value) / 100);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.save();
    framePath(ctx, this.shape, size);
    ctx.clip();
    ctx.drawImage(img, (size - w) / 2 + this.offsetX * k, (size - h) / 2 + this.offsetY * k, w, h);
    ctx.restore();
    if (this.border.checked && this.shape !== 'none') {
      ctx.lineWidth = 8 * k;
      ctx.strokeStyle = '#fff4e6';
      framePath(ctx, this.shape, size, 4 * k);
      ctx.stroke();
    }
  }

  private draw(): void {
    this.paint(this.canvas);
  }

  private async save(): Promise<void> {
    const id = this.editing;
    if (!id || !this.img) return;
    const code = this.ids.indexOf(id);
    const out = document.createElement('canvas');
    out.width = ICON_PX;
    out.height = ICON_PX;
    this.paint(out);
    const url = out.toDataURL('image/png');
    await this.scene.setSymbolArt(code, url);
    this.stored[id] = url;
    const kept = writeStored(this.stored);
    this.onChange();
    this.crop.close();
    await this.renderList();
    this.note.textContent = kept ? 'Icône enregistrée sur cet appareil.' : "Icône utilisée, mais la mémoire du navigateur est pleine : elle ne sera pas gardée au prochain lancement.";
  }
}
