import '@fontsource/lilita-one';
import '@fontsource-variable/nunito';
import './ui/style.css';
import { CONFIG } from './engine';
import { BattleUi } from './battle/ui';
import { Game } from './ui/game';
import { Scene } from './ui/scene';

async function start(): Promise<void> {
  const host = document.getElementById('stage');
  if (!host) throw new Error('Missing #stage element');
  // The canvas text uses the display font, so wait for it before drawing anything.
  await Promise.allSettled([document.fonts.load('40px "Lilita One"'), document.fonts.load('16px "Nunito Variable"')]);
  const scene = await Scene.create(host, CONFIG);
  const game = new Game(scene);
  new BattleUi(game);
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
}

start().catch((err: unknown) => {
  console.error(err);
  const host = document.getElementById('stage');
  if (host) {
    const note = document.createElement('p');
    note.style.cssText = 'padding:24px;text-align:center';
    note.textContent = 'The game could not start. It needs a browser with WebGL enabled. Details are in the browser console.';
    host.replaceChildren(note);
  }
});
