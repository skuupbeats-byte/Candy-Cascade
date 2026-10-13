/** The volume dialog: one slider for the music, one for the effects. */
import type { Sound } from './sound';

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function setupVolume(sound: Sound): void {
  const dialog = byId<HTMLDialogElement>('dlg-volume');
  const music = byId<HTMLInputElement>('vol-music');
  const voice = byId<HTMLInputElement>('vol-voice');
  const fx = byId<HTMLInputElement>('vol-fx');
  const musicOut = byId('vol-music-out');
  const voiceOut = byId('vol-voice-out');
  const fxOut = byId('vol-fx-out');

  const show = (): void => {
    music.value = String(Math.round(sound.getMusicVolume() * 100));
    voice.value = String(Math.round(sound.getVoiceVolume() * 100));
    fx.value = String(Math.round(sound.getFxVolume() * 100));
    musicOut.textContent = music.value;
    voiceOut.textContent = voice.value;
    fxOut.textContent = fx.value;
  };
  show();

  music.addEventListener('input', () => {
    sound.setMusicVolume(Number(music.value) / 100);
    musicOut.textContent = music.value;
  });
  voice.addEventListener('input', () => {
    sound.setVoiceVolume(Number(voice.value) / 100);
    voiceOut.textContent = voice.value;
  });
  // Let go of the voice slider: play the sample so the level can be judged.
  voice.addEventListener('change', () => sound.supprime());
  fx.addEventListener('input', () => {
    sound.setFxVolume(Number(fx.value) / 100);
    fxOut.textContent = fx.value;
  });
  // Let go of the effects slider: play a sample so the level can be judged.
  fx.addEventListener('change', () => sound.win(0));

  byId('btn-volume').addEventListener('click', () => {
    show();
    if (!dialog.open) dialog.showModal();
  });
  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
