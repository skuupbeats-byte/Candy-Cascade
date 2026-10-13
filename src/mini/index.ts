import { AgarGame } from './agar';
import { BomberGame } from './bomber';
import { ClickGame } from './click';
import { FlappyGame } from './flappy';
import { SabreGame } from './sabre';
import { SnakeGame } from './snake';
import { TanksGame } from './tanks';
import { type MiniGame, type MiniKind, type MiniPlayer, type Rng } from './types';

export * from './types';

export const MINI_KINDS: readonly MiniKind[] = ['click', 'flappy', 'bomber', 'agar', 'snake', 'tanks', 'sabre'];

export function createMini(kind: MiniKind, players: MiniPlayer[], rng: Rng = Math.random): MiniGame {
  switch (kind) {
    case 'click':
      return new ClickGame(players);
    case 'flappy':
      return new FlappyGame(players, rng);
    case 'bomber':
      return new BomberGame(players, rng);
    case 'agar':
      return new AgarGame(players, rng);
    case 'snake':
      return new SnakeGame(players, rng);
    case 'tanks':
      return new TanksGame(players, rng);
    case 'sabre':
      return new SabreGame(players, rng);
  }
}

/** The mini game of a round: they rotate in a shuffled order, so a game never comes twice in a row. */
export function pickMini(previous: MiniKind | null, rng: Rng = Math.random): MiniKind {
  const choices = MINI_KINDS.filter((k) => k !== previous);
  return choices[Math.floor(rng() * choices.length)];
}
