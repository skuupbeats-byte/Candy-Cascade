/** The Battle mode screens: players, turn buttons and the dialogs. All text is set with textContent, so names are safe. */
import type { Game } from '../ui/game';
import {
  BATTLE,
  DRINKS,
  type AttackResult,
  type Battle,
  type Drink,
  type PendingHit,
  activePlayer,
  addWinnings,
  attackCost,
  attackMany,
  awards,
  buyShield,
  canAttack,
  canBuyFreeSpins,
  canDefend,
  changeDrink,
  createBattle,
  dodgeChance,
  dodgeMultiplier,
  endTurn,
  failedDrink,
  payFreeSpins,
  recordSpins,
  resolveHit,
  shieldCost,
  shieldName,
  standings,
  targets,
} from './logic';
import { DRAW_MS, beerBar, drainGlass, beers, drawView, h, parts, plural, svg } from './dom';
import qrcode from 'qrcode-generator';
import { RemoteHost } from './remote';
import { MiniRun } from './miniHost';
import { MINI_INFO, MINI_KINDS, type MiniKind, pickMini, rewardsFor } from '../mini';
import { SEATS, type HostToPhone, type Intent, type DrawPopup, type LobbyMsg, type MinisMenu, type MiniView, type Popup, type SyncMsg } from '../net/protocol';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** A random number from 0 up to (not including) 1, from the browser's secure generator. */
function randomUnit(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class BattleUi {
  private battle: Battle | null = null;
  private names = ['Joueur 1', 'Joueur 2'];
  /** The drinks of this game: the usual ones, with sizes that can be changed in the setup. */
  private drinks: Drink[] = DRINKS.map((d) => ({ ...d }));
  /** The drink chosen by each player, by drink id. */
  private choices: string[] = ['biere', 'biere'];
  private spins: number = BATTLE.defaultSpins;
  /** True while the turn's spins are running. */
  private busy = false;
  /** Progress of the running spins, shown in the turn line. */
  private progress: { done: number; points: number } | null = null;
  /** Parts of beer chosen for each target (player id -> parts) in the attack dialog. */
  private plan = new Map<number, number>();
  /** Parts chosen in the shield dialog. */
  private shieldParts = 0;
  /** Attacks waiting for their target to drink or try the wheel, one after the other. */
  private pendingQueue: PendingHit[] = [];
  private dodgeHit: PendingHit | null = null;
  private dodgeParts = 1;
  private dodgeSpinning = false;
  private dodgeOutcome: { parts: number; success: boolean } | null = null;

  // Phones: the big screen runs the game, the phones send what their players want to do.
  private remote: RemoteHost | null = null;
  /** True while a game is played with phones. */
  private remoteMode = false;
  /** Phone id -> player id, once the game has started. */
  private playerOf = new Map<string, number>();
  /** The moment shown on every screen at once (the wheel, then the drink). */
  private popup: Popup | DrawPopup | null = null;
  /** The mini game being played at the end of a round, and what the phones see of it. */
  private mini: MiniRun | null = null;
  /** True when the lobby is the mini games menu (no Battle). */
  private minisOnly = false;
  /** Phone id -> its id in a mini game played on its own. */
  private miniOf = new Map<string, number>();
  /** Mini games menu: wins per seat. */
  private miniWins = new Map<number, number>();
  private miniOnlyView: MiniView | null = null;
  private miniView: MiniView | null = null;
  private lastMini: MiniKind | null = null;
  private lastSay = '';
  private overOpen = false;
  private joinHost: string | null = null;

  private roster = el('roster');
  private controls = el('battle-controls');
  private turnText = el('bt-turn');
  private spinButton = el<HTMLButtonElement>('bt-spin');
  private attackButton = el<HTMLButtonElement>('bt-attack');
  private defendButton = el<HTMLButtonElement>('bt-defend');
  private freeButton = el<HTMLButtonElement>('bt-free');
  private freeDialog = el<HTMLDialogElement>('dlg-bbuy');
  private endButton = el<HTMLButtonElement>('bt-end');
  private finishButton = el<HTMLButtonElement>('bt-finish');
  private modeButton = el<HTMLButtonElement>('btn-mode');
  private modeDialog = el<HTMLDialogElement>('dlg-mode');
  private setupDialog = el<HTMLDialogElement>('dlg-setup');
  private attackDialog = el<HTMLDialogElement>('dlg-attack');
  private defendDialog = el<HTMLDialogElement>('dlg-defend');
  private hitDialog = el<HTMLDialogElement>('dlg-hit');
  private dodgeDialog = el<HTMLDialogElement>('dlg-dodge');
  private overDialog = el<HTMLDialogElement>('dlg-over');

  constructor(private game: Game) {
    // Dialogs: the dimmed area and the Close/Cancel buttons close them.
    for (const dialog of [this.modeDialog, this.setupDialog, this.attackDialog, this.defendDialog, this.freeDialog, this.overDialog]) {
      dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    // The hit dialog can only be closed with its button, so the drink is never skipped by accident.
    this.hitDialog.addEventListener('cancel', (event) => event.preventDefault());
    this.dodgeDialog.addEventListener('cancel', (event) => event.preventDefault());
    el('dodge-drink').addEventListener('click', () => this.finishDodge(null));
    el('dodge-try').addEventListener('click', () => this.tryWheel());
    el('dodge-next').addEventListener('click', () => this.finishDodge(this.dodgeOutcome));

    this.overDialog.addEventListener('close', () => {
      this.overOpen = false;
      this.push();
    });
    el('mode-remote').addEventListener('click', () => this.openLobby(false));
    el('mode-minis').addEventListener('click', () => {
      this.miniWins.clear();
      this.openLobby(true);
    });
    for (const kind of MINI_KINDS) {
      const info = MINI_INFO[kind];
      const b = h('button', { type: 'button', class: 'mini-pick', 'data-mini': kind }, h('strong', {}, info.title), h('span', {}, info.rules));
      b.addEventListener('click', () => this.startMiniOnly(kind));
      el('lobby-minis-list').append(b);
    }
    el('lobby-start').addEventListener('click', () => this.startRemote());
    el('lobby-spins').addEventListener('change', () => {
      this.spins = Number(el<HTMLSelectElement>('lobby-spins').value) || BATTLE.defaultSpins;
      this.afterLobbyChange();
    });
    for (const n of BATTLE.spinChoices) el('lobby-spins').append(h('option', { value: n }, `${n} spins`));
    el('dlg-lobby').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => el<HTMLDialogElement>('dlg-lobby').close()));

    this.modeButton.addEventListener('click', () => this.openMode());
    el('mode-classic').addEventListener('click', () => this.startClassic());
    el('mode-battle').addEventListener('click', () => {
      this.modeDialog.close();
      this.openSetup();
    });

    const sizes = el<HTMLSelectElement>('setup-spins');
    for (const n of BATTLE.spinChoices) sizes.append(h('option', { value: n }, `${n} spins`));
    el('setup-add').addEventListener('click', () => {
      this.readNames();
      if (this.names.length < BATTLE.maxPlayers) {
        this.names.push(`Joueur ${this.names.length + 1}`);
        this.choices.push(this.choices[this.choices.length - 1] ?? 'biere');
      }
      this.renderSetup();
    });
    el('setup-start').addEventListener('click', () => this.start());

    this.spinButton.addEventListener('click', () => void this.runSpins());
    this.attackButton.addEventListener('click', () => this.openAttack());
    this.defendButton.addEventListener('click', () => this.openDefend());
    this.freeButton.addEventListener('click', () => this.openFree());
    el('bbuy-confirm').addEventListener('click', () => void this.buyFree());
    this.endButton.addEventListener('click', () => this.onEnd());
    el('bt-drink').addEventListener('click', () => this.openDrinkDialog());
    this.finishButton.addEventListener('click', () => this.showOver());
    el('attack-confirm').addEventListener('click', () => this.confirmAttack());
    el('defend-confirm').addEventListener('click', () => this.confirmDefend());
    el('hit-ok').addEventListener('click', () => this.closeHit());
    el('over-resume').addEventListener('click', () => this.overDialog.close());
    el('over-again').addEventListener('click', () => {
      this.overDialog.close();
      this.start(true);
    });
    el('over-menu').addEventListener('click', () => {
      this.overDialog.close();
      this.openMode();
    });

    if (import.meta.env.DEV) (window as unknown as { __battle: () => Battle | null }).__battle = () => this.battle;
    game.battleKey = null;
    game.machine.onChange(() => this.refreshMenuButton());
    this.openMode();
  }

  // ------------------------------------------------------------------ modes

  private openMode(): void {
    el('mode-note').hidden = this.battle === null;
    if (!this.modeDialog.open) this.modeDialog.showModal();
  }

  /** The line under the board, also sent to the phones. */
  private say(text: string): void {
    this.lastSay = text;
    this.game.say(text);
    this.push();
  }

  private refreshMenuButton(): void {
    this.modeButton.disabled = !this.game.isIdle || this.busy;
  }

  private startClassic(): void {
    this.modeDialog.close();
    this.endRemote();
    this.battle = null;
    this.leaveBattleLook();
    this.say('Press Spin or the spacebar to play');
  }

  private leaveBattleLook(): void {
    this.game.setBattleLook(false);
    this.game.battleKey = null;
    this.roster.hidden = true;
    this.controls.hidden = true;
  }

  // ------------------------------------------------------------------ setup

  private openSetup(): void {
    el<HTMLSelectElement>('setup-spins').value = String(this.spins);
    this.renderSetup();
    this.setupDialog.showModal();
  }

  private readNames(): void {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('#setup-players input'));
    if (inputs.length > 0) this.names = inputs.map((i) => i.value);
    const picks = Array.from(document.querySelectorAll<HTMLSelectElement>('#setup-players select'));
    if (picks.length > 0) this.choices = picks.map((i) => i.value);
    const sizes = Array.from(document.querySelectorAll<HTMLInputElement>('#setup-drinks input'));
    sizes.forEach((input, i) => {
      const parts = Math.round(Number(input.value));
      if (Number.isFinite(parts)) this.drinks[i].parts = Math.min(BATTLE.maxGlass, Math.max(BATTLE.minGlass, parts));
    });
  }

  private renderSetup(): void {
    while (this.choices.length < this.names.length) this.choices.push(this.choices[this.choices.length - 1] ?? 'biere');
    this.choices.length = this.names.length;

    el('setup-drinks').replaceChildren(
      ...this.drinks.map((d) => {
        const input = h('input', { type: 'number', min: BATTLE.minGlass, max: BATTLE.maxGlass, step: 1, inputmode: 'numeric', 'aria-label': `Parts dans un ${d.name}` });
        input.value = String(d.parts);
        // A drink that is in use cannot change size half way through the editing: re-read and redraw on change.
        input.addEventListener('change', () => {
          this.readNames();
          this.renderSetup();
        });
        return h('label', { class: 'drink-row' }, h('span', {}, `${d.icon} ${d.name}`), input, h('span', { class: 'drink-unit' }, 'parts'));
      }),
    );

    const list = el('setup-players');
    list.replaceChildren();
    this.names.forEach((name, i) => {
      const input = h('input', { type: 'text', id: `pl-${i}`, maxlength: 14, 'aria-label': `Nom du joueur ${i + 1}`, autocomplete: 'off' });
      input.value = name;
      const pick = h('select', { 'aria-label': `Boisson du joueur ${i + 1}` });
      for (const d of this.drinks) pick.append(h('option', { value: d.id }, `${d.icon} ${d.name} (${d.parts})`));
      pick.value = this.choices[i];
      const remove = h('button', { type: 'button', class: 'chip', 'aria-label': `Retirer le joueur ${i + 1}` }, 'Retirer');
      remove.disabled = this.names.length <= BATTLE.minPlayers;
      remove.addEventListener('click', () => {
        this.readNames();
        this.names.splice(i, 1);
        this.choices.splice(i, 1);
        this.renderSetup();
      });
      list.append(h('div', { class: 'setup-row' }, input, pick, remove));
    });
    el<HTMLButtonElement>('setup-add').disabled = this.names.length >= BATTLE.maxPlayers;
  }

  private start(again = false): void {
    if (!again) {
      this.endRemote();
      this.readNames();
      this.spins = Number(el<HTMLSelectElement>('setup-spins').value) || BATTLE.defaultSpins;
      this.setupDialog.close();
    }
    this.names = this.names.map((n, i) => n.trim() || `Joueur ${i + 1}`);
    const glasses = this.names.map((_, i) => this.drinks.find((d) => d.id === this.choices[i]) ?? this.drinks[0]);
    this.battle = createBattle(this.names, this.spins, glasses);
    this.busy = false;
    this.progress = null;
    this.game.setBattleLook(true);
    this.game.battleKey = () => {
      if (!this.popup && !this.mini && this.hostCanAct()) void this.runSpins();
    };
    this.popup = null;
    this.roster.hidden = false;
    this.controls.hidden = false;
    // With phones, a draw picks who starts: everybody watches it at the same time.
    if (this.remoteMode) {
      const winner = Math.floor(Math.random() * this.battle.players.length);
      this.battle.current = winner;
      this.popup = { kind: 'draw', names: this.battle.players.map((p) => p.name), winner };
      this.showDraw(this.popup);
    }
    this.render();
    this.say(this.popup ? 'Tirage au sort : qui commence ?' : 'À toi de jouer, ' + activePlayer(this.battle).name + ' !');
    if (this.remoteMode) this.sendSeats();
  }

  private showDraw(draw: DrawPopup): void {
    const d = h('dialog', { class: 'confirm wide draw', id: 'dlg-draw' });
    d.addEventListener('cancel', (event) => event.preventDefault());
    d.replaceChildren(...drawView(draw.names, draw.winner));
    document.body.append(d);
    d.showModal();
    setTimeout(() => {
      if (this.popup !== draw) return;
      d.close();
      d.remove();
      this.popup = null;
      if (this.battle) this.say('À toi de jouer, ' + activePlayer(this.battle).name + ' !');
      this.render();
    }, DRAW_MS);
  }

  // ----------------------------------------------------------- change drink

  private openDrinkDialog(): void {
    const b = this.battle;
    if (!b || this.busy || this.popup) return;
    const who = h('select', { 'aria-label': 'Joueur' });
    for (const p of b.players) who.append(h('option', { value: String(p.id) }, p.name));
    who.value = String(activePlayer(b).id);
    const what = h('select', { 'aria-label': 'Nouveau verre' });
    for (const d of this.drinks) what.append(h('option', { value: d.id }, `${d.icon} ${d.name} (${d.parts} parts)`));
    const d = h('dialog', { class: 'confirm', id: 'dlg-drink' });
    const ok = h('button', { type: 'button', class: 'chip primary' }, 'Changer');
    const cancel = h('button', { type: 'button', class: 'chip' }, 'Annuler');
    const close = () => {
      d.close();
      d.remove();
    };
    cancel.addEventListener('click', close);
    d.addEventListener('click', (event) => {
      if (event.target === d) close();
    });
    ok.addEventListener('click', () => {
      this.switchDrink(Number(who.value), what.value);
      close();
    });
    d.append(h('h2', {}, 'Changer de verre'), h('p', {}, 'Le nouveau verre est plein. Les parts déjà bues et les points restent.'), h('div', { class: 'setup-row' }, who, what), h('div', { class: 'confirm-actions' }, cancel, ok));
    document.body.append(d);
    d.showModal();
  }

  private switchDrink(playerId: number, drinkId: string): void {
    const b = this.battle;
    const drink = this.drinks.find((x) => x.id === drinkId);
    if (!b || !drink || !b.players[playerId]) return;
    changeDrink(b, playerId, drink);
    this.say(`${b.players[playerId].name} passe à ${drink.name}.`);
    this.render();
  }

  // ------------------------------------------------------------------ view

  private render(): void {
    const b = this.battle;
    if (!b) return;
    this.refreshMenuButton();

    this.roster.replaceChildren(
      ...b.players.map((p) => {
        const isTurn = p.id === activePlayer(b).id;
        const card = h(
          'article',
          { class: `pcard${isTurn ? ' is-turn' : ''}` },
          h('header', { class: 'pcard-head' }, h('span', { class: 'pcard-name' }, p.name), h('span', { class: 'pcard-state' }, isTurn ? 'À toi' : '')),
          beerBar(p, p.beer, 0, `${p.drinkName} en cours : ${p.beer} parts sur ${p.glass}`),
          h(
            'div',
            { class: 'pstats' },
            h('div', { class: 'stat', title: `${p.drinkName} bu` }, h('span', { class: 'stat-icon', role: 'img', 'aria-label': `${p.drinkName} bu` }, p.icon), h('strong', {}, beers(p))),
            h('div', { class: 'stat', title: 'Coups portés' }, h('span', { class: 'stat-icon', role: 'img', 'aria-label': 'Coups portés' }, '💥'), h('strong', {}, String(p.hits))),
          ),
          h('div', { class: 'pcard-pts' }, h('strong', {}, p.points.toLocaleString('fr-FR')), h('span', {}, 'points')),
          p.shield > 0 ? h('div', { class: 'pcard-foot' }, h('span', { class: 'shield-chip' }, `Bouclier ${p.shield}`)) : '',
        );
        return card;
      }),
    );

    const me = activePlayer(b);
    if (b.phase === 'spins') {
      this.turnText.replaceChildren(
        h('strong', {}, me.name),
        ...(this.progress
          ? [` · spin ${Math.min(this.progress.done + 1, b.spinsPerTurn)}/${b.spinsPerTurn} · gagné ce tour : `, h('span', { class: 'bt-gain' }, `+${this.progress.points} points`)]
          : [` · tour ${b.round} · ${b.spinsPerTurn} spins à enchaîner`]),
      );
    } else {
      this.turnText.replaceChildren(h('strong', {}, me.name), ' · ', h('span', { class: 'bt-gain' }, `${me.points} points`), ' : attaque, défends-toi ou passe');
    }
    this.spinButton.textContent = `Lancer les ${b.spinsPerTurn} spins`;
    this.spinButton.hidden = b.phase !== 'spins';
    this.spinButton.disabled = this.busy;
    for (const button of [this.attackButton, this.defendButton, this.freeButton, this.endButton]) button.hidden = b.phase !== 'actions';
    this.attackButton.disabled = this.busy || !canAttack(b);
    this.defendButton.disabled = this.busy || !canDefend(b);
    this.freeButton.disabled = this.busy || !canBuyFreeSpins(b);
    this.freeButton.textContent = `Free spins · ${BATTLE.freeSpinsCost} pts`;
    this.endButton.disabled = this.busy;
    this.finishButton.disabled = this.busy;
    this.controls.classList.toggle('remote-hide', !this.hostCanAct());
    this.push();
  }

  // ------------------------------------------------------------------ turn

  /** The current player's spins, one after the other. */
  private async runSpins(): Promise<void> {
    const b = this.battle;
    if (!b || this.busy || b.phase !== 'spins' || !this.game.isIdle) return;
    this.busy = true;
    const wins: number[] = [];
    this.progress = { done: 0, points: 0 };
    this.render();
    for (let i = 0; i < b.spinsPerTurn; i++) {
      this.say(`Spin ${i + 1} sur ${b.spinsPerTurn}`);
      const result = await this.game.playBattleSpin();
      if (this.battle !== b) return; // the battle was replaced while spinning
      if (!result) break;
      wins.push(result.totalWin);
      this.progress = { done: i + 1, points: this.progress.points + Math.round(result.totalWin * BATTLE.pointsPerBet) };
      this.render();
      if (i < b.spinsPerTurn - 1) await pause(800);
    }
    this.busy = false;
    this.progress = null;
    const name = activePlayer(b).name;
    const points = recordSpins(b, wins);
    this.say(points > 0 ? `${name} gagne ${points} points` : `${name} ne gagne aucun point`);
    this.render();
  }

  private onEnd(): void {
    const b = this.battle;
    if (!b || this.busy || b.phase !== 'actions') return;
    const round = b.round;
    endTurn(b);
    this.render();
    // With phones, every round ends with a mini game once everybody has played.
    if (this.remoteMode && b.round > round && b.players.length >= 2) {
      this.runMini();
      return;
    }
    this.say(`Au tour de ${activePlayer(b).name}`);
  }

  // ------------------------------------------------------------- mini games

  private runMini(): void {
    const b = this.battle;
    if (!b || this.mini) return;
    const kind = pickMini(this.lastMini);
    this.lastMini = kind;
    const rewards = rewardsFor(b.players.length);
    this.busy = true;
    this.render();
    this.say('Mini jeu !');
    this.mini = new MiniRun({
      kind,
      players: b.players.map((p) => ({ id: p.id, name: p.name })),
      rewards,
      onView: (view) => {
        this.miniView = view;
        this.push();
      },
      onDone: (ranking) => this.finishMini(ranking, rewards),
    });
    this.mini.start();
  }

  /** A mini game from the menu: the seated phones play it, no points are given and the menu comes back after the results. */
  private startMiniOnly(kind: MiniKind): void {
    const r = this.remote;
    if (!r || this.mini || this.remoteMode) return;
    const seated = r.seats.flatMap((s) => (s ? [s] : []));
    if (seated.length < 2) return;
    const seatIdx = r.seats.flatMap((s, i) => (s ? [i] : []));
    el<HTMLDialogElement>('dlg-lobby').close();
    this.miniOf = new Map(seated.map((s, i) => [s.cid, i]));
    const sendView = (view: MiniView | null): void => {
      this.miniOnlyView = view;
      for (const [cid, id] of this.miniOf) r.sendTo(cid, { type: 'miniview', view, you: view ? id : null });
    };
    this.mini = new MiniRun({
      kind,
      players: seated.map((s, i) => ({ id: i, name: s.name })),
      rewards: [],
      onView: sendView,
      onDone: (ranking) => {
        this.mini = null;
        sendView(null);
        this.miniOf.clear();
        this.game.resumeMusic();
        const winner = ranking.length > 0 ? seatIdx[ranking[0]] : undefined;
        if (winner !== undefined) this.miniWins.set(winner, (this.miniWins.get(winner) ?? 0) + 1);
        this.openLobby(true);
        this.remote?.broadcast(this.lobbyMsg());
      },
    });
    this.mini.start();
  }

  private finishMini(ranking: number[], rewards: number[]): void {
    const b = this.battle;
    this.mini = null;
    this.miniView = null;
    this.busy = false;
    this.game.resumeMusic();
    if (!b) return;
    ranking.forEach((id, i) => {
      const gain = rewards[i] ?? 0;
      if (gain > 0 && b.players[id]) b.players[id].points += gain;
    });
    this.say(ranking.length > 0 ? `${b.players[ranking[0]].name} gagne le mini jeu ! Au tour de ${activePlayer(b).name}` : `Au tour de ${activePlayer(b).name}`);
    this.render();
  }

  // ----------------------------------------------------------- free spins

  private openFree(): void {
    const b = this.battle;
    if (!b || this.busy || !canBuyFreeSpins(b)) return;
    el('bbuy-text').textContent =
      `${activePlayer(b).name} paie ${BATTLE.freeSpinsCost} points pour lancer directement les free spins. ` +
      `Ils rapportent en moyenne autant qu'ils coûtent, mais avec de gros écarts : tu peux gagner bien plus, ou beaucoup moins.`;
    this.freeDialog.showModal();
  }

  private async buyFree(): Promise<void> {
    const b = this.battle;
    if (!b || this.busy || !canBuyFreeSpins(b)) return;
    this.freeDialog.close();
    payFreeSpins(b);
    this.busy = true;
    this.render();
    this.say('Free spins achetés !');
    const result = await this.game.playBattleSpin(true);
    if (this.battle !== b) return; // the battle was replaced meanwhile
    this.busy = false;
    const me = activePlayer(b);
    if (!result) {
      me.points += BATTLE.freeSpinsCost; // could not play: give the points back
      this.say('Impossible de lancer les free spins, points rendus');
    } else {
      const won = addWinnings(b, result.totalWin);
      this.say(won > 0 ? `${me.name} gagne ${won} points avec les free spins` : `${me.name} ne gagne rien avec les free spins`);
    }
    this.render();
  }

  // ---------------------------------------------------------------- attack

  /** One row to choose a number of parts: − n + and a button for one more beer. */
  private stepperRow(opts: {
    name: string;
    meta: string;
    n: number;
    canMinus: boolean;
    canPlus: boolean;
    /** Parts added by the big button, and what it says. Hidden when it would add a single part. */
    bulk: number;
    bulkLabel: string;
    canBeer: boolean;
    bar?: HTMLElement;
    onChange: (delta: number) => void;
  }): HTMLElement {
    const minus = h('button', { type: 'button', class: 'round', 'aria-label': `Une part de moins pour ${opts.name}` }, '−');
    const plus = h('button', { type: 'button', class: 'round', 'aria-label': `Une part de plus pour ${opts.name}` }, '+');
    const beer = h('button', { type: 'button', class: 'chip', 'aria-label': `${opts.bulk} parts de plus pour ${opts.name}` }, opts.bulkLabel);
    beer.hidden = opts.bulk <= 1;
    minus.disabled = !opts.canMinus;
    plus.disabled = !opts.canPlus;
    beer.disabled = !opts.canBeer;
    minus.addEventListener('click', () => opts.onChange(-1));
    plus.addEventListener('click', () => opts.onChange(1));
    beer.addEventListener('click', () => opts.onChange(opts.bulk));
    return h(
      'div',
      { class: `alloc${opts.n > 0 ? ' is-set' : ''}` },
      h('div', {}, h('div', { class: 'pick-name' }, opts.name), h('div', { class: 'pick-meta' }, opts.meta)),
      h('div', { class: 'alloc-ctl' }, minus, h('strong', { class: 'alloc-n' }, opts.n === 0 ? '—' : parts(opts.n)), plus, beer),
      ...(opts.bar ? [opts.bar] : []),
    );
  }

  private planTotal(): number {
    const b = this.battle;
    if (!b) return 0;
    let total = 0;
    for (const [id, n] of this.plan) {
      const target = b.players.find((p) => p.id === id);
      if (target && n > 0) total += attackCost(n, target.glass);
    }
    return total;
  }

  private openAttack(): void {
    const b = this.battle;
    if (!b || !canAttack(b)) return;
    this.plan = new Map();
    this.renderAttack();
    this.attackDialog.showModal();
  }

  private renderAttack(): void {
    const b = this.battle;
    if (!b) return;
    const me = activePlayer(b);
    const total = this.planTotal();
    const left = me.points - total;
    el('attack-title').textContent = `${me.name} attaque`;
    el('attack-points').replaceChildren('Tu as ', h('strong', {}, `${me.points} points`), '.');

    el('target-list').replaceChildren(
      ...targets(b).map((p) => {
        const n = this.plan.get(p.id) ?? 0;
        const drunk = Math.max(0, n - p.shield);
        let meta = `${p.icon} ${p.beer}/${p.glass} · ${beers(p)} bus`;
        if (p.shield > 0) meta += ` · bouclier ${p.shield}`;
        if (n > 0) {
          if (drunk === 0) meta = 'bloqué par le bouclier';
          else if (drunk < p.beer) meta = `boit ${parts(drunk)}${p.shield > 0 ? ` (bouclier : −${parts(Math.min(n, p.shield))})` : ''}`;
          else if (drunk === p.beer) meta = 'finit son verre';
          else {
            const after = drunk - p.beer;
            const whole = Math.floor(after / p.glass);
            meta = `finit son verre${whole > 0 ? `, ${plural(whole, 'verre entier', 'verres entiers')}` : ''}${after % p.glass > 0 ? `, ${parts(after % p.glass)} de plus` : ''}`;
          }
        }
        const room = (extra: number) => attackCost(n + extra, p.glass) - (n > 0 ? attackCost(n, p.glass) : 0) <= left;
        return this.stepperRow({
          name: p.name,
          meta,
          n,
          canMinus: n > 0,
          canPlus: room(1),
          bulk: p.glass,
          bulkLabel: `+ ${p.icon}`,
          canBeer: room(p.glass),
          bar: beerBar(p, p.beer, Math.min(drunk, p.beer)),
          onChange: (delta) => {
            const next = Math.max(0, n + delta);
            if (next === 0) this.plan.delete(p.id);
            else this.plan.set(p.id, next);
            this.renderAttack();
          },
        });
      }),
    );

    const targetsHit = [...this.plan.values()].filter((n) => n > 0).length;
    el('attack-total').replaceChildren(
      targetsHit === 0 ? 'Choisis au moins une cible.' : h('span', {}, 'Coût : ', h('strong', {}, `${total} points`), ` · il t'en reste ${left}`),
    );
    el<HTMLButtonElement>('attack-confirm').disabled = targetsHit === 0;
  }

  private confirmAttack(): void {
    const plan = [...this.plan.entries()].filter(([, n]) => n > 0).map(([targetId, n]) => ({ targetId, parts: n }));
    if (plan.length === 0) return;
    this.attackDialog.close();
    this.launchAttack(plan);
  }

  private launchAttack(plan: Array<{ targetId: number; parts: number }>): void {
    const b = this.battle;
    if (!b) return;
    this.pendingQueue = attackMany(b, plan);
    this.game.hitSound();
    this.render();
    this.nextReaction();
  }

  /** The next attacked player either drinks or tries the wheel; with nothing left to drink there is nothing to decide. */
  private nextReaction(): void {
    const hit = this.pendingQueue.shift();
    if (!hit) return;
    if (hit.incoming === 0) this.showHit(resolveHit(hit, null));
    else this.openDodge(hit);
  }

  // ----------------------------------------------------------------- wheel

  private openDodge(hit: PendingHit): void {
    this.dodgeHit = hit;
    this.dodgeParts = 1;
    this.dodgeSpinning = false;
    this.dodgeOutcome = null;
    const needle = el('dodge-needle');
    needle.classList.remove('spinning');
    needle.style.transform = 'rotate(0deg)';
    el('dodge-title').textContent = `${hit.target.name}, tu es attaqué !`;
    el('dodge-text').textContent =
      `${hit.attacker.name} : ${hit.name} (${parts(hit.parts)}).` +
      (hit.absorbed > 0 ? ` Ton bouclier absorbe ${parts(hit.absorbed)}.` : '') +
      ` Tu dois boire ${parts(hit.incoming)}, ou tenter la roue.`;
    el('dodge-result').textContent = '';
    el('dodge-next').hidden = true;
    el('dodge-drink').hidden = false;
    el('dodge-try').hidden = false;
    this.popup = {
      kind: 'dodge',
      targetId: hit.target.id,
      title: el('dodge-title').textContent ?? '',
      text: el('dodge-text').textContent ?? '',
      k: 1,
      incoming: hit.incoming,
      glass: hit.target.glass,
      stage: 'choose',
    };
    this.renderDodge();
    if (!this.dodgeDialog.open) this.dodgeDialog.showModal();
    el('dodge-try').focus();
  }

  private renderDodge(): void {
    const hit = this.dodgeHit;
    if (!hit) return;
    const k = this.dodgeParts;
    const glass = hit.target.glass;
    const chance = dodgeChance(k, glass);
    const mult = dodgeMultiplier(k, glass);

    const minus = h('button', { type: 'button', class: 'round', 'aria-label': 'Une part de moins à esquiver' }, '−');
    const plus = h('button', { type: 'button', class: 'round', 'aria-label': 'Une part de plus à esquiver' }, '+');
    minus.disabled = this.dodgeSpinning || k <= 1;
    plus.disabled = this.dodgeSpinning || k >= hit.incoming;
    minus.addEventListener('click', () => {
      this.dodgeParts = Math.max(1, k - 1);
      this.renderDodge();
    });
    plus.addEventListener('click', () => {
      this.dodgeParts = Math.min(hit.incoming, k + 1);
      this.renderDodge();
    });
    el('dodge-ctl').replaceChildren(minus, h('strong', { class: 'alloc-n' }, `Esquiver ${parts(k)}`), plus);

    const failed = failedDrink(hit.incoming, k, glass);
    el('dodge-odds').replaceChildren(
      'Réussite : ',
      h('strong', {}, `${Math.round(chance * 100)} %`),
      ` → tu bois ${parts(hit.incoming - k)}. Raté : ×${mult.toLocaleString('fr-FR')} → tu bois ${parts(failed)}.`,
    );
    el<HTMLButtonElement>('dodge-drink').disabled = this.dodgeSpinning;
    el<HTMLButtonElement>('dodge-try').disabled = this.dodgeSpinning;
    if (this.popup?.kind === 'dodge' && this.popup.stage === 'choose') {
      this.popup.k = k;
      this.push();
    }

    // The wheel: green for a win, red for a loss, the win slice starts at the top and runs clockwise.
    const point = (deg: number) => `${(90 * Math.sin((deg * Math.PI) / 180)).toFixed(2)} ${(-90 * Math.cos((deg * Math.PI) / 180)).toFixed(2)}`;
    const win = chance * 360;
    const slice = (from: number, to: number, fill: string) =>
      svg('path', { d: `M0 0 L${point(from)} A90 90 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)} Z`, fill });
    el('dodge-sectors').replaceChildren(slice(0, win, '#3ecf8e'), slice(win, 360, '#e8465f'));
  }

  private tryWheel(): void {
    const hit = this.dodgeHit;
    if (!hit || this.dodgeSpinning) return;
    const k = this.dodgeParts;
    const chance = dodgeChance(k, hit.target.glass);
    const success = randomUnit() < chance;
    // Land anywhere inside the chosen slice, away from its edges.
    const win = chance * 360;
    const [from, to] = success ? [0, win] : [win, 360];
    const margin = Math.min(4, (to - from) / 4);
    const angle = from + margin + randomUnit() * (to - from - 2 * margin);

    this.dodgeSpinning = true;
    this.renderDodge();
    if (this.popup?.kind === 'dodge') {
      this.popup = { ...this.popup, k, stage: 'spinning', angle, success };
      this.push();
    }
    el('dodge-result').textContent = '…';
    const needle = el('dodge-needle');
    needle.classList.add('spinning');
    // Force a layout so the transition starts from the current angle.
    void needle.getBoundingClientRect();
    needle.style.transform = `rotate(${360 * 4 + angle}deg)`;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.setTimeout(() => {
      if (this.dodgeHit !== hit) return;
      this.dodgeSpinning = false;
      this.dodgeOutcome = { parts: k, success };
      this.game.hitSound();
      el('dodge-result').textContent = success ? `Gagné ! −${parts(k)}` : `Raté ! ×${dodgeMultiplier(k, hit.target.glass).toLocaleString('fr-FR')}`;
      el('dodge-drink').hidden = true;
      el('dodge-try').hidden = true;
      el('dodge-next').hidden = false;
      el('dodge-next').focus();
      if (this.popup?.kind === 'dodge') {
        this.popup = { ...this.popup, stage: 'result', result: el('dodge-result').textContent ?? '' };
        this.push();
      }
    }, reduced ? 500 : 3800);
  }

  private finishDodge(outcome: { parts: number; success: boolean } | null): void {
    const hit = this.dodgeHit;
    if (!hit || this.dodgeSpinning) return;
    this.dodgeHit = null;
    this.popup = null;
    this.dodgeDialog.close();
    this.showHit(resolveHit(hit, outcome));
  }

  private showHit(r: AttackResult): void {
    const left = this.pendingQueue.length;
    const { attacker, target } = r;
    el('hit-title').textContent =
      r.drunk === 0 ? (r.dodge?.success ? 'Esquivé !' : 'Bloqué !') : r.dodge && !r.dodge.success ? 'Raté, ça fait mal !' : r.finished >= 3 ? 'Raz-de-marée !' : r.finished > 0 ? 'Cul sec !' : 'Touché !';
    el('hit-text').textContent =
      `${attacker.name} attaque ${target.name} : ${r.name} (${parts(r.parts)}).` + (r.absorbed > 0 ? ` Le bouclier absorbe ${parts(r.absorbed)}.` : '') +
      (r.dodge ? (r.dodge.success ? ` ${target.name} gagne la roue : −${parts(r.dodge.parts)}.` : ` ${target.name} perd la roue : ×${r.dodge.multiplier.toLocaleString('fr-FR')}.`) : '');

    const size = target.glass;
    el('hit-glass').replaceChildren(drainGlass(size, r.beerBefore, r.fromCurrent, 500));
    const next = el('hit-glass2');
    const hasNext = r.fromNext > 0;
    const whole = Math.floor(r.fromNext / size);
    const rest = r.fromNext % size;
    next.hidden = !hasNext;
    // This label is kept for the phones, which show the same text under the second mug.
    el('hit-glass2-label').textContent =
      whole > 0 && rest === 0
        ? whole === 1
          ? 'Verre suivant'
          : `${whole} verres suivants`
        : whole > 0
          ? `${plural(whole, 'verre entier', 'verres entiers')}, puis le suivant`
          : 'Verre suivant';
    // The second glass shows the last one touched: full when the drink ends on a whole glass, otherwise the rest.
    const lastDrunk = rest === 0 ? size : rest;
    next.replaceChildren(...(hasNext ? [drainGlass(size, size, lastDrunk, 500 + 3600, `${el('hit-glass2-label').textContent} : ${parts(lastDrunk)}`)] : []));

    let line: string;
    if (r.drunk === 0) line = `${target.name} ne boit rien`;
    else if (hasNext) {
      line = `${target.name} finit son verre (${parts(r.fromCurrent)})`;
      if (whole > 0) line += `, boit ${plural(whole, 'verre entier', 'verres entiers')}`;
      if (rest > 0) line += ` puis ${parts(rest)} du suivant`;
    } else if (r.finished > 0) line = `${target.name} finit son verre !`;
    else line = `${target.name} boit ${parts(r.drunk)} sur ${size}`;
    if (r.drunk > size) line += ` — ${(r.drunk / size).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${target.icon} au total`;
    el('hit-drink').textContent = line;
    el('hit-ok').textContent = left > 0 ? `C'est bu ! (encore ${left})` : "C'est bu !";
    this.popup = {
      kind: 'hit',
      targetId: target.id,
      title: el('hit-title').textContent ?? '',
      text: el('hit-text').textContent ?? '',
      glass: size,
      beerBefore: r.beerBefore,
      fromCurrent: r.fromCurrent,
      fromNext: r.fromNext,
      label2: hasNext ? (el('hit-glass2-label').textContent ?? '') : '',
      line: el('hit-drink').textContent ?? '',
      left,
    };
    this.push();
    if (!this.hitDialog.open) this.hitDialog.showModal();
    el('hit-ok').focus();
  }

  private closeHit(): void {
    this.popup = null;
    if (this.pendingQueue.length > 0) {
      this.hitDialog.close();
      this.nextReaction();
      return;
    }
    this.hitDialog.close();
    this.render();
  }

  // ---------------------------------------------------------------- shield

  private openDefend(): void {
    const b = this.battle;
    if (!b || !canDefend(b)) return;
    this.shieldParts = 0;
    this.renderDefend();
    this.defendDialog.showModal();
  }

  private renderDefend(): void {
    const b = this.battle;
    if (!b) return;
    const me = activePlayer(b);
    const n = this.shieldParts;
    const cost = n > 0 ? shieldCost(n, me.glass) : 0;
    const left = me.points - cost;
    el('defend-title').textContent = `${me.name} se défend`;
    el('defend-points').replaceChildren('Tu as ', h('strong', {}, `${me.points} points`), me.shield > 0 ? ` et un bouclier de ${me.shield} parts.` : '.');

    const room = (extra: number) => shieldCost(n + extra, me.glass) - (n > 0 ? shieldCost(n, me.glass) : 0) <= left;
    el('shield-picker').replaceChildren(
      this.stepperRow({
        name: 'Bouclier',
        meta: n > 0 ? `${shieldName(n)} · absorbe ${parts(n)}${me.shield > 0 ? ` (total : ${parts(me.shield + n)})` : ''}` : 'Combien de parts veux-tu absorber ?',
        n,
        canMinus: n > 0,
        canPlus: room(1),
        bulk: me.glass,
        bulkLabel: `+ ${me.icon}`,
        canBeer: room(BATTLE.beerParts),
        onChange: (delta) => {
          this.shieldParts = Math.max(0, n + delta);
          this.renderDefend();
        },
      }),
    );
    el('defend-total').replaceChildren(
      n === 0 ? 'Choisis la taille du bouclier.' : h('span', {}, 'Coût : ', h('strong', {}, `${cost} points`), ` · il t'en reste ${left}`),
    );
    el<HTMLButtonElement>('defend-confirm').disabled = n === 0;
  }

  private confirmDefend(): void {
    if (this.shieldParts === 0) return;
    this.defendDialog.close();
    this.applyShield(this.shieldParts);
  }

  private applyShield(n: number): void {
    const b = this.battle;
    if (!b) return;
    const me = activePlayer(b);
    buyShield(b, n);
    this.say(`${me.name} s'équipe : ${shieldName(n)}, bouclier de ${me.shield} parts`);
    this.render();
  }

  // ------------------------------------------------------------------ over

  private showOver(): void {
    const b = this.battle;
    if (!b || this.busy) return;
    el('over-title').textContent = 'Bilan de la partie';
    el('over-text').textContent = `Tour ${b.round}. Vous pouvez reprendre là où vous en étiez.`;
    const rows = standings(b).map((p) =>
      h(
        'tr',
        {},
        h('td', {}, p.name),
        h('td', {}, `${beers(p)} ${p.icon}`),
        h('td', {}, String(p.partsDrunk)),
        h('td', {}, String(p.hits)),
        h('td', {}, String(p.partsDealt)),
        h('td', {}, String(p.partsBlocked)),
        h('td', {}, String(p.partsSaved)),
      ),
    );
    el('over-table').replaceChildren(
      h('thead', {}, h('tr', {}, ...['Joueur', 'Verres bus', 'Gorgées', '💥 Coups', 'Parts infligées', 'Parts bloquées', 'Parts esquivées'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows),
    );

    const a = awards(b);
    const lines: Node[] = [];
    if (a.sharpest) lines.push(h('p', {}, 'Le plus incisif : ', h('strong', {}, a.sharpest.name), ` (${plural(a.sharpest.hits, 'coup', 'coups')})`));
    if (a.thirstiest) lines.push(h('p', {}, 'A le plus bu : ', h('strong', {}, a.thirstiest.name), ` (${a.thirstiest.partsDrunk} gorgées, ${beers(a.thirstiest)} ${a.thirstiest.icon})`));
    const old = this.overDialog.querySelector('.awards');
    old?.remove();
    if (lines.length > 0) el('over-table').parentElement?.after(h('div', { class: 'awards' }, ...lines));
    this.overOpen = true;
    this.push();
    this.overDialog.showModal();
  }

  // ---------------------------------------------------------------- phones

  /** The big screen plays for the active player when that player has no phone connected (or there is no phone game). */
  private hostCanAct(): boolean {
    const b = this.battle;
    if (!this.remoteMode || !this.remote || !b) return true;
    const id = activePlayer(b).id;
    for (const [cid, pid] of this.playerOf) if (pid === id && this.remote.isConnected(cid)) return false;
    return true;
  }

  private endRemote(): void {
    this.mini?.abort();
    this.mini = null;
    this.miniView = null;
    this.remote?.close();
    this.remote = null;
    this.remoteMode = false;
    this.playerOf.clear();
    this.popup = null;
    this.controls.classList.remove('remote-hide');
  }

  private seatedMsg(cid: string): HostToPhone {
    const seat = this.remote?.seatOf(cid) ?? -1;
    return { type: 'seated', seat: seat >= 0 ? seat : null, playerId: this.playerOf.get(cid) ?? null };
  }

  private sendSeats(): void {
    if (!this.remote) return;
    for (const cid of this.playerOf.keys()) this.remote.sendTo(cid, this.seatedMsg(cid));
  }

  private syncMessage(b: Battle): SyncMsg {
    const connected: number[] = [];
    for (const [cid, pid] of this.playerOf) if (this.remote?.isConnected(cid)) connected.push(pid);
    return {
      type: 'sync',
      players: b.players.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        drinkName: p.drinkName,
        glass: p.glass,
        beer: p.beer,
        partsDrunk: p.partsDrunk,
        beersFinished: p.beersFinished,
        hits: p.hits,
        points: p.points,
        shield: p.shield,
      })),
      active: activePlayer(b).id,
      phase: b.phase,
      round: b.round,
      spinsPerTurn: b.spinsPerTurn,
      busy: this.busy,
      progress: this.progress ? { ...this.progress } : null,
      say: this.lastSay,
      popup: this.popup,
      mini: this.miniView,
      drinks: this.drinks.map((x) => ({ id: x.id, name: x.name, icon: x.icon, parts: x.parts })),
      freeSpinsCost: BATTLE.freeSpinsCost,
      connected,
      over: this.overOpen,
    };
  }

  /** Send the phones a picture of the game. */
  private push(): void {
    const b = this.battle;
    if (!this.remote || !this.remoteMode || !b) return;
    this.remote.broadcast(this.syncMessage(b));
  }

  private lobbyMsg(): LobbyMsg {
    const r = this.remote;
    return {
      type: 'lobby',
      seats: (r?.seats ?? []).map((s, i) => (s ? { seat: i, name: s.name, drink: s.drink, connected: r?.isConnected(s.cid) ?? false } : null)),
      drinks: this.drinks.map((d) => ({ id: d.id, name: d.name, icon: d.icon, parts: d.parts })),
      spins: this.spins,
      ...(this.minisOnly ? { minis: this.minisMenu() } : {}),
    };
  }

  private minisMenu(): MinisMenu {
    const r = this.remote;
    const filled = (r?.seats ?? []).flatMap((s, i) => (s ? [i] : []));
    return {
      kinds: MINI_KINDS.map((k) => ({ kind: k, title: MINI_INFO[k].title, rules: MINI_INFO[k].rules })),
      wins: Object.fromEntries(this.miniWins),
      leader: filled.length > 0 ? filled[0] : null,
      ready: filled.length >= 2 && !!r?.online,
    };
  }

  private openLobby(minisOnly = false): void {
    this.minisOnly = minisOnly;
    el('lobby-title').textContent = minisOnly ? 'Mini-jeux sur téléphones' : 'Battle sur téléphones';
    for (const id of ['lobby-drinks-title', 'lobby-drinks', 'lobby-spins-label', 'lobby-start']) el(id).hidden = minisOnly;
    el('lobby-minis').hidden = !minisOnly;
    this.modeDialog.close();
    if (!this.remote) {
      this.remote = new RemoteHost({
        onIntent: (cid, intent) => this.onIntent(cid, intent),
        onChange: () => this.onRemoteChange(),
      });
    }
    el<HTMLSelectElement>('lobby-spins').value = String(this.spins);
    void this.findJoinHost();
    this.renderLobby();
    const dialog = el<HTMLDialogElement>('dlg-lobby');
    if (!dialog.open) dialog.showModal();
  }

  /** The address phones can reach this computer at: the page's own address, unless it says "localhost". */
  private async findJoinHost(): Promise<void> {
    if (this.joinHost) return;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (!local) {
      this.joinHost = location.hostname;
    } else {
      try {
        const info = (await (await fetch('/info', { cache: 'no-store' })).json()) as { ips?: string[]; httpsPort?: number | null };
        this.joinHost = info.ips?.[0] ?? null;
        this.httpsPort = info.httpsPort ?? null;
      } catch {
        this.joinHost = null;
      }
    }
    this.renderLobby();
  }

  /** The port of the secure version of the server, when it runs (the sword duel needs HTTPS on the phones). */
  private httpsPort: number | null = null;

  private joinUrl(): string | null {
    const r = this.remote;
    if (!r?.room || !this.joinHost) return null;
    const url = new URL(location.href);
    url.hostname = this.joinHost;
    if (this.httpsPort && url.protocol === 'http:') {
      url.protocol = 'https:';
      url.port = String(this.httpsPort);
    }
    url.pathname = '/controller.html';
    url.search = `?room=${r.room}`;
    url.hash = '';
    return url.toString();
  }

  private onRemoteChange(): void {
    this.renderLobby();
    if (this.remoteMode) {
      this.render();
    } else {
      this.remote?.broadcast(this.lobbyMsg());
    }
  }

  private afterLobbyChange(): void {
    this.renderLobby();
    this.remote?.broadcast(this.lobbyMsg());
  }

  private renderLobby(): void {
    const r = this.remote;
    const dialog = el<HTMLDialogElement>('dlg-lobby');
    if (!r || !dialog.open) return;
    el('lobby-code').textContent = r.room || '····';
    const url = this.joinUrl();
    el('lobby-url').textContent = url ?? '';
    const qr = el('lobby-qr');
    if (url) {
      const code = qrcode(0, 'M');
      code.addData(url);
      code.make();
      qr.innerHTML = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } else {
      qr.replaceChildren();
    }
    el('lobby-status').textContent = !r.online
      ? 'Pas de connexion au serveur. Lance « npm run play » dans le dossier du jeu, puis ouvre le jeu depuis http://localhost:8080.'
      : !this.joinHost
        ? 'Ouvre le jeu depuis l’adresse du réseau (affichée dans le terminal) pour que les téléphones puissent le rejoindre.'
        : '';

    // Drink sizes: the same for everybody in the room.
    const drinks = el('lobby-drinks');
    if (!drinks.contains(document.activeElement)) {
      drinks.replaceChildren(
        ...this.drinks.map((d) => {
          const input = h('input', { type: 'number', min: BATTLE.minGlass, max: BATTLE.maxGlass, step: 1, inputmode: 'numeric', 'aria-label': `Parts dans un ${d.name}` });
          input.value = String(d.parts);
          input.addEventListener('change', () => {
            const n = Math.round(Number(input.value));
            if (Number.isFinite(n)) d.parts = Math.min(BATTLE.maxGlass, Math.max(BATTLE.minGlass, n));
            this.afterLobbyChange();
          });
          return h('label', { class: 'drink-row' }, h('span', {}, `${d.icon} ${d.name}`), input, h('span', { class: 'drink-unit' }, 'parts'));
        }),
      );
    }

    let filled = 0;
    el('lobby-seats').replaceChildren(
      ...r.seats.map((seat, i) => {
        if (seat) filled++;
        const drink = seat ? this.drinks.find((d) => d.id === seat.drink) : null;
        const free = h('button', { type: 'button', class: 'chip', 'aria-label': `Libérer la place ${i + 1}` }, 'Libérer');
        free.addEventListener('click', () => {
          const cid = seat?.cid;
          r.seats[i] = null;
          if (cid) r.sendTo(cid, { type: 'seated', seat: null, playerId: null });
          this.afterLobbyChange();
        });
        return h(
          'div',
          { class: `lobby-seat${seat ? ' is-taken' : ''}` },
          h('span', { class: 'lobby-seat-n' }, `Joueur ${i + 1}`),
          h('span', { class: 'lobby-seat-name' }, seat ? `${drink?.icon ?? ''} ${seat.name}` : 'place libre'),
          ...(this.minisOnly && seat ? [h('span', { class: 'lobby-wins' }, `🏆 ${this.miniWins.get(i) ?? 0}`)] : []),
          seat ? h('span', { class: `lobby-seat-state${r.isConnected(seat.cid) ? ' on' : ''}` }, r.isConnected(seat.cid) ? 'connecté' : 'hors ligne') : '',
          ...(seat ? [free] : []),
        );
      }),
    );
    el<HTMLButtonElement>('lobby-start').disabled = filled < BATTLE.minPlayers || !r.online;
    const canMini = this.minisOnly && filled >= 2 && r.online;
    el('lobby-minis-list').querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = !canMini));
  }

  private startRemote(): void {
    const r = this.remote;
    if (!r) return;
    if (this.minisOnly) return;
    const seated = r.seats.flatMap((s) => (s ? [s] : []));
    if (seated.length < BATTLE.minPlayers) return;
    this.spins = Number(el<HTMLSelectElement>('lobby-spins').value) || BATTLE.defaultSpins;
    this.names = seated.map((s) => s.name);
    this.choices = seated.map((s) => s.drink);
    this.playerOf = new Map(seated.map((s, i) => [s.cid, i]));
    this.remoteMode = true;
    el<HTMLDialogElement>('dlg-lobby').close();
    this.start(true);
  }

  private greet(cid: string): void {
    const r = this.remote;
    if (!r) return;
    r.sendTo(cid, this.seatedMsg(cid));
    if (this.remoteMode && this.battle) r.sendTo(cid, this.syncMessage(this.battle));
    else {
      r.sendTo(cid, this.lobbyMsg());
      if (this.miniOnlyView && this.miniOf.has(cid)) r.sendTo(cid, { type: 'miniview', view: this.miniOnlyView, you: this.miniOf.get(cid) ?? null });
    }
  }

  private claimSeat(cid: string, m: Extract<Intent, { type: 'seat' }>): void {
    const r = this.remote;
    if (!r) return;
    if (this.remoteMode) {
      r.sendTo(cid, { type: 'rejected', reason: 'La partie a déjà commencé.' });
      return;
    }
    const i = Math.round(Number(m.seat));
    if (!(i >= 0 && i < SEATS)) return;
    const current = r.seats[i];
    if (current && current.cid !== cid) {
      r.sendTo(cid, { type: 'rejected', reason: 'Cette place est prise.' });
      return;
    }
    const name = String(m.name ?? '').trim().slice(0, 14) || `Joueur ${i + 1}`;
    const drink = this.drinks.some((d) => d.id === m.drink) ? m.drink : this.drinks[0].id;
    const old = r.seatOf(cid);
    if (old >= 0 && old !== i) r.seats[old] = null;
    r.seats[i] = { cid, name, drink };
    this.afterLobbyChange();
    r.sendTo(cid, this.seatedMsg(cid));
  }

  /** What a phone asks for. Everything is checked here: a phone can only act for its own player, at the right moment. */
  private onIntent(cid: string, m: Intent): void {
    const r = this.remote;
    if (!r || !m || typeof m.type !== 'string') return;
    if (m.type === 'hello') return this.greet(cid);
    if (m.type === 'seat') return this.claimSeat(cid, m);
    // A mini game played on its own: the phone sends its inputs straight to it.
    if (m.type === 'mini' && this.mini && this.miniOf.size > 0) {
      const id = this.miniOf.get(cid);
      if (id !== undefined && m.input && typeof m.input === 'object') this.mini.input(id, m.input);
      return;
    }

    // The first player's phone is the remote of the mini games menu.
    if (m.type === 'minipick') {
      if (!this.minisOnly || this.mini || this.remoteMode) return;
      const menu = this.minisMenu();
      if (!menu.ready || menu.leader === null || r.seatOf(cid) !== menu.leader) return r.sendTo(cid, { type: 'rejected', reason: 'Seul le joueur 1 choisit les jeux.' });
      const kind = m.kind === 'random' ? pickMini(this.lastMini) : MINI_KINDS.find((k) => k === m.kind);
      if (!kind) return;
      this.lastMini = kind;
      this.startMiniOnly(kind);
      return;
    }

    const b = this.battle;
    const pid = this.playerOf.get(cid);
    if (!this.remoteMode || !b || pid === undefined) return;
    const reject = (reason: string) => r.sendTo(cid, { type: 'rejected', reason });
    if (this.popup?.kind === 'draw') return reject('Tirage au sort en cours…');
    const mine = pid === activePlayer(b).id;
    const calm = !this.busy && !this.popup && !this.dodgeHit && this.pendingQueue.length === 0 && !this.hitDialog.open;
    const popup = this.popup;
    const asTarget = popup?.kind === 'dodge' && popup.targetId === pid ? popup : null;

    switch (m.type) {
      case 'mini': {
        const i = m.input;
        if (this.mini && i && typeof i === 'object') this.mini.input(pid, i);
        break;
      }
      case 'drink':
        if (!this.busy && !this.popup && this.pendingQueue.length === 0 && this.drinks.some((x) => x.id === m.drink)) this.switchDrink(pid, m.drink);
        break;
      case 'spin':
        if (mine && calm) void this.runSpins();
        break;
      case 'end':
        if (mine && calm) this.onEnd();
        break;
      case 'free':
        if (mine && calm && b.phase === 'actions') {
          if (canBuyFreeSpins(b)) void this.buyFree();
          else reject('Pas assez de points pour les free spins.');
        }
        break;
      case 'attack': {
        if (!(mine && calm && b.phase === 'actions') || !Array.isArray(m.plan)) break;
        const me = activePlayer(b);
        const seen = new Set<number>();
        const plan: Array<{ targetId: number; parts: number }> = [];
        let cost = 0;
        for (const e of m.plan) {
          const target = targets(b).find((t) => t.id === e?.targetId);
          const n = Math.floor(Number(e?.parts));
          if (!target || seen.has(target.id) || !(n >= 1) || n > 500) return reject('Attaque invalide.');
          seen.add(target.id);
          cost += attackCost(n, target.glass);
          plan.push({ targetId: target.id, parts: n });
        }
        if (plan.length === 0 || cost > me.points) return reject('Pas assez de points.');
        this.launchAttack(plan);
        break;
      }
      case 'shield': {
        if (!(mine && calm && b.phase === 'actions')) break;
        const n = Math.floor(Number(m.parts));
        if (!(n >= 1) || n > 500 || shieldCost(n, activePlayer(b).glass) > activePlayer(b).points) return reject('Pas assez de points.');
        this.applyShield(n);
        break;
      }
      case 'dodge-k':
        if (asTarget?.stage === 'choose' && this.dodgeHit) {
          this.dodgeParts = Math.min(this.dodgeHit.incoming, Math.max(1, Math.floor(Number(m.k)) || 1));
          this.renderDodge();
        }
        break;
      case 'dodge-drink':
        if (asTarget?.stage === 'choose') this.finishDodge(null);
        break;
      case 'dodge-try':
        if (asTarget?.stage === 'choose') this.tryWheel();
        break;
      case 'ack':
        if (asTarget?.stage === 'result') this.finishDodge(this.dodgeOutcome);
        else if (popup?.kind === 'hit' && popup.targetId === pid) this.closeHit();
        break;
    }
  }
}
