/**
 * What the big screen and the phones say to each other. The big screen owns the game; phones send intents
 * ("I spin", "I attack these players") and receive pictures of the game ("sync") to draw.
 * The server in ../../server only passes these messages along.
 */

import type { MiniInfo, MiniInput, MiniKind } from '../mini/types';

/** Seats on the phones' side. A game takes the seats that are filled, in order. */
export const SEATS = 6;

export interface DrinkView {
  id: string;
  name: string;
  icon: string;
  parts: number;
}

export interface SeatView {
  seat: number;
  name: string;
  drink: string;
  connected: boolean;
}

/** Before the game: who sits where, and the drinks to choose from. */
export interface LobbyMsg {
  type: 'lobby';
  seats: Array<SeatView | null>;
  drinks: DrinkView[];
  spins: number;
  /** Set while the mini games menu is on: what the first player's phone can start, and the win counters. */
  minis?: MinisMenu;
}

/** The mini games menu, driven from the phone of the first seated player. */
export interface MinisMenu {
  kinds: Array<{ kind: MiniKind; title: string; rules: string }>;
  /** Wins by seat index. */
  wins: Record<number, number>;
  /** The seat that holds the remote (the first player), or null when nobody sits. */
  leader: number | null;
  /** At least two players sit: a game can start. */
  ready: boolean;
}

export interface PlayerView {
  id: number;
  name: string;
  icon: string;
  drinkName: string;
  glass: number;
  beer: number;
  partsDrunk: number;
  beersFinished: number;
  hits: number;
  points: number;
  shield: number;
}

/** A moment everybody sees at once: the attacked player's choice and the wheel, then what they drink. */
export type Popup =
  | {
      kind: 'dodge';
      targetId: number;
      title: string;
      text: string;
      /** Parts the target is trying to dodge. */
      k: number;
      incoming: number;
      glass: number;
      stage: 'choose' | 'spinning' | 'result';
      /** Final needle angle (degrees, clockwise from the top), once the wheel is thrown. */
      angle?: number;
      success?: boolean;
      result?: string;
    }
  | {
      kind: 'hit';
      targetId: number;
      title: string;
      text: string;
      glass: number;
      beerBefore: number;
      fromCurrent: number;
      fromNext: number;
      label2: string;
      line: string;
      left: number;
    };

/** The draw that picks who plays first: everybody sees the same names and the same winner. */
export interface DrawPopup {
  kind: 'draw';
  names: string[];
  winner: number;
}

/** The mini game that is on: the phones show its rules, its controls, then the results. */
export interface MiniView {
  kind: MiniKind;
  title: string;
  rules: string;
  controls: MiniInfo['controls'];
  stage: 'intro' | 'count' | 'play' | 'result';
  /** Seconds left in this stage. */
  left: number;
  /** A short live label per player (score, "out"...). */
  labels: Record<number, string>;
  ranking?: Array<{ id: number; reward: number; label: string }>;
  /** Names by player id, so a phone can write the results even outside a Battle. */
  names?: Record<number, string>;
}

/** Sent while a mini game is played on its own (from the mini games menu, outside a Battle). */
export interface MiniOnlyMsg {
  type: 'miniview';
  view: MiniView | null;
  /** The id this phone has in the mini game, or null if it does not play. */
  you: number | null;
}

export interface SyncMsg {
  type: 'sync';
  players: PlayerView[];
  active: number;
  phase: 'spins' | 'actions';
  round: number;
  spinsPerTurn: number;
  busy: boolean;
  progress: { done: number; points: number } | null;
  say: string;
  popup: Popup | DrawPopup | null;
  /** Drinks a player can switch to. */
  drinks: DrinkView[];
  mini: MiniView | null;
  freeSpinsCost: number;
  /** Ids of the players whose phone is connected right now. */
  connected: number[];
  /** Set when the game is over (the big screen shows the standings). */
  over: boolean;
}

/** Sent to one phone: the seat it holds, or null when it has none. */
export interface SeatedMsg {
  type: 'seated';
  seat: number | null;
  /** The player id in the game, once the game has started. */
  playerId: number | null;
}

export interface RejectedMsg {
  type: 'rejected';
  reason: string;
}

export type HostToPhone = LobbyMsg | SyncMsg | SeatedMsg | RejectedMsg | MiniOnlyMsg;

export type Intent =
  | { type: 'hello' }
  | { type: 'seat'; seat: number; name: string; drink: string }
  | { type: 'spin' }
  | { type: 'end' }
  | { type: 'free' }
  | { type: 'drink'; drink: string }
  | { type: 'mini'; input: MiniInput }
  | { type: 'minipick'; kind: MiniKind | 'random' }
  | { type: 'attack'; plan: Array<{ targetId: number; parts: number }> }
  | { type: 'shield'; parts: number }
  | { type: 'dodge-k'; k: number }
  | { type: 'dodge-drink' }
  | { type: 'dodge-try' }
  | { type: 'ack' };
