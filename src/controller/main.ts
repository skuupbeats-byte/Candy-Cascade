/**
 * The phone: a personal controller for the Battle played on the big screen.
 * It shows the player's points, the live shop and everybody's glass, and sends what the player does.
 * The big screen decides everything; this page only draws what it is told and asks.
 */
import '@fontsource/lilita-one';
import '@fontsource-variable/nunito';
import '../ui/style.css';
import './controller.css';
import { attackCost, dodgeChance, dodgeMultiplier, failedDrink, shieldCost, shieldName } from '../battle/logic';
import { beerBar, beers, drainGlass, drawView, h, parts, plural, svg } from '../battle/dom';
import { ReconnectingSocket } from '../net/socket';
import type { MiniInput } from '../mini/types';
import type { MiniOnlyMsg, MiniView } from '../net/protocol';
import { GravityFilter, SWING_COOLDOWN_MS, swingDirection } from './gesture';
import { SEATS, type Intent, type DrawPopup, type LobbyMsg, type PlayerView, type Popup, type SyncMsg } from '../net/protocol';

const root = document.getElementById('ctl') as HTMLElement;
const query = new URLSearchParams(location.search);

let room = (query.get('room') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
let cid = '';
let online = false;
let joined = false;
let error = '';
let lobby: LobbyMsg | null = null;
let sync: SyncMsg | null = null;
let seat: number | null = null;
let me: number | null = null;
let notice = '';

const store = {
  get(key: string): string {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: fine, the phone just will not remember */
    }
  },
};

cid = room ? store.get(`cc.cid.${room}`) : '';
let myName = store.get('cc.name');
let myDrink = store.get('cc.drink');

const send = (msg: Intent): void => socket.send({ t: 'c2h', msg });

const socket = new ReconnectingSocket(
  () => ({ t: 'join', room, cid: cid || undefined }),
  (m) => {
    if (m.t === 'joined') {
      cid = String(m.cid);
      store.set(`cc.cid.${room}`, cid);
      joined = true;
      error = '';
      send({ type: 'hello' });
    } else if (m.t === 'error') {
      error = String(m.msg);
      joined = false;
    } else if (m.t === 'h2c') {
      onHost(m.msg as Record<string, unknown>);
    }
    render();
  },
  (on) => {
    online = on;
    if (!on) joined = false;
    render();
  },
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
);

/** A mini game played on its own, from the menu on the big screen (no Battle going on). */
let miniOnly: MiniOnlyMsg | null = null;

/** Make the phone vibrate. Not every phone can (iPhones ignore it), so it is always safe to call. */
function buzz(pattern: number | number[] = 40): void {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    /* no vibration here: fine */
  }
}

function onHost(msg: Record<string, unknown>): void {
  switch (msg.type) {
    case 'lobby':
      lobby = msg as unknown as LobbyMsg;
      break;
    case 'sync':
      watchSync(sync, msg as unknown as SyncMsg);
      sync = msg as unknown as SyncMsg;
      break;
    case 'miniview': {
      const next = msg as unknown as MiniOnlyMsg;
      watchMini(miniOnly?.view ?? null, next.view, next.you);
      miniOnly = next.view ? next : null;
      break;
    }
    case 'seated':
      seat = (msg.seat as number | null) ?? null;
      me = (msg.playerId as number | null) ?? null;
      break;
    case 'rejected':
      notice = String(msg.reason);
      window.setTimeout(() => {
        notice = '';
        render();
      }, 3500);
      break;
  }
}

// ---------------------------------------------------------------- screens

type Screen = 'join' | 'connecting' | 'lobby' | 'game';
let screen: Screen = 'join';
let lastPopupKey = '';

function render(): void {
  const next: Screen = !room || (error && !joined) ? 'join' : !joined ? 'connecting' : sync ? 'game' : 'lobby';
  if (next !== screen) {
    screen = next;
    root.replaceChildren();
  }
  if (screen === 'join') renderJoin();
  else if (screen === 'connecting') renderMessage(online ? 'Connexion à la salle…' : 'Connexion au serveur…');
  else if (screen === 'lobby') renderLobby();
  else renderGame();
  renderPopups();
  renderMini();
}

function renderMessage(text: string): void {
  root.replaceChildren(h('p', { class: 'ctl-msg' }, text));
}

function renderJoin(): void {
  // Do not rebuild while the player is typing.
  if (root.querySelector('input:focus')) return;
  const input = h('input', { type: 'text', class: 'code-input', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', inputmode: 'text', 'aria-label': 'Code de la salle', placeholder: 'CODE' });
  input.value = room;
  const go = h('button', { type: 'button', class: 'chip primary big' }, 'Rejoindre');
  const submit = (): void => {
    room = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (room.length !== 4) return;
    cid = store.get(`cc.cid.${room}`);
    error = '';
    render();
    // Reconnect so the new code is used.
    location.search = `?room=${room}`;
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  root.replaceChildren(
    h('h1', { class: 'ctl-title' }, 'Candy Cascade'),
    h('p', { class: 'ctl-msg' }, 'Entre le code affiché sur le grand écran.'),
    input,
    go,
    ...(error ? [h('p', { class: 'ctl-error' }, error)] : []),
    ...(!online ? [h('p', { class: 'ctl-msg small' }, 'Pas de connexion au serveur.')] : []),
  );
}

function renderLobby(): void {
  if (root.querySelector('input:focus')) return;
  const l = lobby;
  if (!l) return renderMessage('En attente de l’écran…');
  if (!myDrink || !l.drinks.some((d) => d.id === myDrink)) myDrink = l.drinks[0]?.id ?? 'biere';

  const name = h('input', { type: 'text', maxlength: 14, autocomplete: 'off', 'aria-label': 'Ton nom', placeholder: 'Ton nom' });
  name.value = myName;
  const pick = h('select', { 'aria-label': 'Ta boisson' });
  for (const d of l.drinks) pick.append(h('option', { value: d.id }, `${d.icon} ${d.name} (${d.parts} parts)`));
  pick.value = myDrink;

  const claim = (index: number): void => {
    myName = name.value.trim();
    myDrink = pick.value;
    store.set('cc.name', myName);
    store.set('cc.drink', myDrink);
    send({ type: 'seat', seat: index, name: myName, drink: myDrink });
  };
  // A player who already has a seat can change name or drink: the seat is claimed again.
  const again = (): void => {
    if (seat !== null) claim(seat);
  };
  name.addEventListener('change', again);
  pick.addEventListener('change', again);

  const grid = h('div', { class: 'seat-grid' });
  for (let i = 0; i < SEATS; i++) {
    const s = l.seats[i];
    const mine = seat === i;
    const b = h('button', { type: 'button', class: `seat-btn${mine ? ' is-mine' : ''}` }, h('strong', {}, `Joueur ${i + 1}`), h('span', {}, s ? s.name : 'libre'));
    b.disabled = !!s && !mine;
    b.addEventListener('click', () => claim(i));
    grid.append(b);
  }
  const menu = l.minis;
  const remote = menu && seat !== null ? minisRemote(menu, l) : null;
  root.replaceChildren(
    h('h1', { class: 'ctl-title' }, 'Candy Cascade'),
    ...(remote ? [remote] : []),
    h('p', { class: 'ctl-msg' }, seat === null ? 'Choisis ton nom, ta boisson et ta place.' : `Tu es Joueur ${seat + 1}. La partie démarre depuis le grand écran.`),
    h('label', { class: 'ctl-field' }, h('span', {}, 'Nom'), name),
    h('label', { class: 'ctl-field' }, h('span', {}, 'Boisson'), pick),
    grid,
    h('p', { class: 'ctl-msg small' }, `${l.spins} spins par tour`),
    ...(notice ? [h('p', { class: 'ctl-error' }, notice)] : []),
  );
}

/** The mini games remote: the first player picks the games, everybody sees the win counters. */
function minisRemote(menu: NonNullable<LobbyMsg['minis']>, l: LobbyMsg): HTMLElement {
  const isLeader = seat !== null && menu.leader === seat;
  const board = h(
    'ol',
    { class: 'wins-board' },
    ...l.seats
      .flatMap((s) => (s ? [s] : []))
      .map((s) => ({ s, w: menu.wins[s.seat] ?? 0 }))
      .sort((a, b) => b.w - a.w)
      .map(({ s, w }) => h('li', { class: s.seat === seat ? 'is-me' : '' }, h('span', {}, `Joueur ${s.seat + 1} · ${s.name}`), h('strong', {}, `🏆 ${w}`))),
  );
  const parts: Node[] = [h('h2', { class: 'remote-title' }, 'Mini-jeux'), board];
  if (!menu.ready) parts.push(h('p', { class: 'ctl-msg small' }, 'Il faut au moins 2 joueurs assis pour commencer.'));
  else if (!isLeader) parts.push(h('p', { class: 'ctl-msg' }, `Joueur ${(menu.leader ?? 0) + 1} choisit le prochain jeu…`));
  else {
    const random = h('button', { type: 'button', class: 'remote-random' }, '🎲 Un jeu au hasard');
    random.addEventListener('click', () => send({ type: 'minipick', kind: 'random' }));
    parts.push(h('p', { class: 'ctl-msg' }, 'Tu as la télécommande : choisis le jeu.'), random);
    const list = h('div', { class: 'remote-list' });
    for (const k of menu.kinds) {
      const b = h('button', { type: 'button', class: 'remote-pick' }, h('strong', {}, k.title), h('span', {}, k.rules));
      b.addEventListener('click', () => send({ type: 'minipick', kind: k.kind }));
      list.append(b);
    }
    parts.push(list);
  }
  return h('section', { class: 'minis-remote' }, ...parts);
}

// ------------------------------------------------------------------- game

function player(id: number): PlayerView | undefined {
  return sync?.players.find((p) => p.id === id);
}

function renderGame(): void {
  const s = sync;
  if (!s) return;
  const mine = me !== null ? player(me) : undefined;
  const active = player(s.active);
  const myTurn = !!mine && mine.id === s.active;
  const calm = !s.busy && !s.popup;
  const targetsList = s.players.filter((p) => p.id !== s.active);
  const canAttackNow = !!mine && targetsList.some((t) => attackCost(1, t.glass) <= mine.points);
  const canDefendNow = !!mine && shieldCost(1, mine.glass) <= mine.points;
  const canFreeNow = !!mine && mine.points >= s.freeSpinsCost;

  const children: Array<Node | string> = [];
  if (!online) children.push(h('p', { class: 'ctl-banner' }, 'Connexion perdue, reconnexion…'));
  if (notice) children.push(h('p', { class: 'ctl-banner err' }, notice));
  if (s.over) children.push(h('p', { class: 'ctl-banner' }, 'Bilan de la partie : regarde le grand écran.'));

  if (mine) {
    children.push(
      h(
        'section',
        { class: `me-card${myTurn ? ' is-turn' : ''}` },
        h('div', { class: 'me-head' }, h('span', { class: 'me-name' }, `${mine.icon} ${mine.name}`), mine.shield > 0 ? h('span', { class: 'shield-chip' }, `Bouclier ${mine.shield}`) : ''),
        h('div', { class: 'me-points' }, h('strong', {}, String(mine.points)), h('span', {}, 'points')),
        beerBar(mine, mine.beer),
        h('p', { class: 'me-turn' }, myTurn ? (s.phase === 'spins' ? 'À toi de lancer tes spins.' : 'À toi : attaque, défends-toi ou passe.') : `Au tour de ${active?.name ?? '…'}`),
      ),
    );
  } else {
    children.push(h('p', { class: 'ctl-banner' }, 'Partie en cours : tu regardes. Reviens sur ta place avec le même téléphone.'));
  }
  children.push(h('p', { class: 'ctl-say' }, s.progress ? `Spin ${Math.min(s.progress.done + 1, s.spinsPerTurn)}/${s.spinsPerTurn} · gagné ce tour : +${s.progress.points} points` : s.say));

  if (mine && myTurn) {
    const act = (label: string, cls: string, enabled: boolean, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: `bt-btn ${cls}` }, label);
      b.disabled = !enabled;
      b.addEventListener('click', onClick);
      return b;
    };
    children.push(
      s.phase === 'spins'
        ? h('div', { class: 'bt-actions' }, act(`Lancer les ${s.spinsPerTurn} spins`, 'spin-btn', calm, () => send({ type: 'spin' })))
        : h(
            'div',
            { class: 'bt-actions' },
            act('Attaquer', 'attack-btn', calm && canAttackNow, openAttack),
            act('Se défendre', 'defend-btn', calm && canDefendNow, openShield),
            act(`Free spins · ${s.freeSpinsCost} pts`, 'free-btn', calm && canFreeNow, openFree),
            act('Fin du tour', 'end-btn', calm, () => send({ type: 'end' })),
          ),
    );
  }

  children.push(
    h(
      'section',
      { class: 'ctl-roster' },
      h('h2', {}, 'Joueurs'),
      ...s.players.map((p) =>
        h(
          'article',
          { class: `pcard${p.id === s.active ? ' is-turn' : ''}${p.id === me ? ' is-me' : ''}` },
          h('header', { class: 'pcard-head' }, h('span', { class: 'pcard-name' }, p.name), h('span', { class: 'pcard-state' }, !s.connected.includes(p.id) ? 'hors ligne' : p.id === s.active ? 'À lui' : '')),
          beerBar(p, p.beer),
          h(
            'div',
            { class: 'pstats' },
            h('div', { class: 'stat', title: `${p.drinkName} bu` }, h('span', { class: 'stat-icon', role: 'img', 'aria-label': `${p.drinkName} bu` }, p.icon), h('strong', {}, beers(p))),
            h('div', { class: 'stat', title: 'Coups portés' }, h('span', { class: 'stat-icon', role: 'img', 'aria-label': 'Coups portés' }, '💥'), h('strong', {}, String(p.hits))),
          ),
          h('div', { class: 'pcard-pts' }, h('strong', {}, p.points.toLocaleString('fr-FR')), h('span', {}, 'points')),
          p.shield > 0 ? h('div', { class: 'pcard-foot' }, h('span', { class: 'shield-chip' }, `Bouclier ${p.shield}`)) : '',
        ),
      ),
    ),
  );
  if (mine) {
    const swap = h('button', { type: 'button', class: 'chip swap-btn' }, `Changer de verre (${mine.icon} ${mine.drinkName})`);
    swap.disabled = !calm;
    swap.addEventListener('click', openDrink);
    children.push(swap);
  }
  if (mine) children.push(shop(mine));
  // Keep an open builder dialog alive: only the page behind it is redrawn.
  root.replaceChildren(...children);
  renderTurn(s, mine, calm, canAttackNow, canDefendNow, canFreeNow);
}

/** The shop, live: what an attack or a shield costs for the player's own glass, and what they can afford now. */
/** The shop stays folded until the player opens it, and keeps its state when the screen redraws. */
let shopOpen = false;

function shop(mine: PlayerView): HTMLElement {
  const rows = [1, 2, 3, 4, 5];
  const glass = mine.glass;
  const list = h('div', { class: 'shop-rows' });
  list.append(h('div', { class: 'shop-row head' }, h('span', {}, 'Parts'), h('span', {}, 'Attaque'), h('span', {}, 'Bouclier')));
  for (const n of rows) {
    const a = attackCost(n, glass);
    const d = shieldCost(n, glass);
    list.append(
      h(
        'div',
        { class: 'shop-row' },
        h('span', {}, parts(n)),
        h('span', { class: a <= mine.points ? 'ok' : 'no' }, `${a} pts`),
        h('span', { class: d <= mine.points ? 'ok' : 'no' }, `${d} pts`),
      ),
    );
  }
  const box = h(
    'details',
    { class: 'shop' },
    h('summary', {}, h('span', {}, '🛒 Boutique'), h('span', { class: 'shop-hint' }, shopOpen ? 'Replier' : 'Dérouler')),
    list,
    h('p', { class: 'ctl-msg small' }, `Prix pour ton verre : ${plural(glass, 'part', 'parts')}. Au-delà, chaque part en plus coûte ${attackCost(glass + 1, glass) - attackCost(glass, glass)} pts d’attaque.`),
  );
  box.open = shopOpen;
  box.addEventListener('toggle', () => {
    shopOpen = box.open;
    const hint = box.querySelector('.shop-hint');
    if (hint) hint.textContent = shopOpen ? 'Replier' : 'Dérouler';
  });
  return box;
}

// ---------------------------------------------------------------- builders

function dialog(id: string, cls = 'confirm wide'): HTMLDialogElement {
  let d = document.getElementById(id) as HTMLDialogElement | null;
  if (!d) {
    d = document.createElement('dialog');
    d.id = id;
    d.className = cls;
    document.body.append(d);
    // When a dialog closes, the page is drawn again so the turn popup can come back.
    if (id !== 'dlg-c-turn') d.addEventListener('close', () => queueMicrotask(render));
  }
  return d;
}

function stepperRow(opts: { name: string; meta: string; n: number; canMinus: boolean; canPlus: boolean; bulk: number; bulkLabel: string; canBulk: boolean; bar?: HTMLElement; onChange: (delta: number) => void }): HTMLElement {
  const minus = h('button', { type: 'button', class: 'round', 'aria-label': `Une part de moins pour ${opts.name}` }, '−');
  const plus = h('button', { type: 'button', class: 'round', 'aria-label': `Une part de plus pour ${opts.name}` }, '+');
  const bulk = h('button', { type: 'button', class: 'chip', 'aria-label': `${opts.bulk} parts de plus pour ${opts.name}` }, opts.bulkLabel);
  bulk.hidden = opts.bulk <= 1;
  minus.disabled = !opts.canMinus;
  plus.disabled = !opts.canPlus;
  bulk.disabled = !opts.canBulk;
  minus.addEventListener('click', () => opts.onChange(-1));
  plus.addEventListener('click', () => opts.onChange(1));
  bulk.addEventListener('click', () => opts.onChange(opts.bulk));
  return h(
    'div',
    { class: `alloc${opts.n > 0 ? ' is-set' : ''}` },
    h('div', {}, h('div', { class: 'pick-name' }, opts.name), h('div', { class: 'pick-meta' }, opts.meta)),
    h('div', { class: 'alloc-ctl' }, minus, h('strong', { class: 'alloc-n' }, opts.n === 0 ? '—' : parts(opts.n)), plus, bulk),
    ...(opts.bar ? [opts.bar] : []),
  );
}

const plan = new Map<number, number>();
let shieldParts = 0;

function openAttack(): void {
  (document.getElementById('dlg-c-turn') as HTMLDialogElement | null)?.close();
  plan.clear();
  renderAttack();
  const d = dialog('dlg-c-attack');
  if (!d.open) d.showModal();
}

function renderAttack(): void {
  const s = sync;
  const mine = me !== null ? player(me) : undefined;
  const d = dialog('dlg-c-attack');
  if (!s || !mine) return d.close();
  let total = 0;
  for (const [id, n] of plan) {
    const t = player(id);
    if (t && n > 0) total += attackCost(n, t.glass);
  }
  const left = mine.points - total;
  const rows = s.players
    .filter((p) => p.id !== mine.id)
    .map((p) => {
      const n = plan.get(p.id) ?? 0;
      const drunk = Math.max(0, n - p.shield);
      const meta = n === 0 ? `${p.icon} ${p.beer}/${p.glass}${p.shield > 0 ? ` · bouclier ${p.shield}` : ''}` : drunk === 0 ? 'bloqué par le bouclier' : `boit ${parts(drunk)}`;
      const room = (extra: number): boolean => attackCost(n + extra, p.glass) - (n > 0 ? attackCost(n, p.glass) : 0) <= left;
      return stepperRow({
        name: p.name,
        meta,
        n,
        canMinus: n > 0,
        canPlus: room(1),
        bulk: p.glass,
        bulkLabel: `+ ${p.icon}`,
        canBulk: room(p.glass),
        bar: beerBar(p, p.beer, Math.min(drunk, p.beer)),
        onChange: (delta) => {
          const next = Math.max(0, n + delta);
          if (next === 0) plan.delete(p.id);
          else plan.set(p.id, next);
          renderAttack();
        },
      });
    });
  const hit = [...plan.values()].filter((n) => n > 0).length;
  const confirm = h('button', { type: 'button', class: 'chip primary' }, 'Attaquer');
  confirm.disabled = hit === 0;
  confirm.addEventListener('click', () => {
    send({ type: 'attack', plan: [...plan.entries()].filter(([, n]) => n > 0).map(([targetId, n]) => ({ targetId, parts: n })) });
    d.close();
  });
  const cancel = h('button', { type: 'button', class: 'chip' }, 'Annuler');
  cancel.addEventListener('click', () => d.close());
  d.replaceChildren(
    h('h2', {}, 'Attaquer'),
    h('p', { class: 'attack-points' }, 'Tu as ', h('strong', {}, `${mine.points} points`), '.'),
    h('div', { class: 'target-list' }, ...rows),
    h('p', { class: 'attack-total' }, hit === 0 ? 'Choisis au moins une cible.' : h('span', {}, 'Coût : ', h('strong', {}, `${total} points`), ` · il t'en reste ${left}`)),
    h('div', { class: 'confirm-actions' }, cancel, confirm),
  );
}

function openShield(): void {
  (document.getElementById('dlg-c-turn') as HTMLDialogElement | null)?.close();
  shieldParts = 0;
  renderShield();
  const d = dialog('dlg-c-shield');
  if (!d.open) d.showModal();
}

function renderShield(): void {
  const mine = me !== null ? player(me) : undefined;
  const d = dialog('dlg-c-shield');
  if (!mine) return d.close();
  const n = shieldParts;
  const cost = n > 0 ? shieldCost(n, mine.glass) : 0;
  const left = mine.points - cost;
  const room = (extra: number): boolean => shieldCost(n + extra, mine.glass) - (n > 0 ? shieldCost(n, mine.glass) : 0) <= left;
  const confirm = h('button', { type: 'button', class: 'chip primary' }, 'Acheter');
  confirm.disabled = n === 0;
  confirm.addEventListener('click', () => {
    send({ type: 'shield', parts: n });
    d.close();
  });
  const cancel = h('button', { type: 'button', class: 'chip' }, 'Annuler');
  cancel.addEventListener('click', () => d.close());
  d.replaceChildren(
    h('h2', {}, 'Se défendre'),
    h('p', { class: 'attack-points' }, 'Tu as ', h('strong', {}, `${mine.points} points`), mine.shield > 0 ? ` et un bouclier de ${mine.shield} parts.` : '.'),
    h(
      'div',
      { class: 'target-list' },
      stepperRow({
        name: 'Bouclier',
        meta: n > 0 ? `${shieldName(n)} · absorbe ${parts(n)}` : 'Combien de parts veux-tu absorber ?',
        n,
        canMinus: n > 0,
        canPlus: room(1),
        bulk: mine.glass,
        bulkLabel: `+ ${mine.icon}`,
        canBulk: room(mine.glass),
        onChange: (delta) => {
          shieldParts = Math.max(0, n + delta);
          renderShield();
        },
      }),
    ),
    h('p', { class: 'attack-total' }, n === 0 ? 'Choisis la taille du bouclier.' : h('span', {}, 'Coût : ', h('strong', {}, `${cost} points`), ` · il t'en reste ${left}`)),
    h('div', { class: 'confirm-actions' }, cancel, confirm),
  );
}

function openDrink(): void {
  const s = sync;
  const mine = s && me !== null ? player(me) : undefined;
  if (!s || !mine) return;
  const d = dialog('dlg-c-drink', 'confirm');
  const pick = h('select', { 'aria-label': 'Nouveau verre' });
  for (const x of s.drinks) pick.append(h('option', { value: x.id }, `${x.icon} ${x.name} (${x.parts} parts)`));
  const confirm = h('button', { type: 'button', class: 'chip primary' }, 'Changer');
  confirm.addEventListener('click', () => {
    send({ type: 'drink', drink: pick.value });
    d.close();
  });
  const cancel = h('button', { type: 'button', class: 'chip' }, 'Annuler');
  cancel.addEventListener('click', () => d.close());
  d.replaceChildren(h('h2', {}, 'Changer de verre'), h('p', {}, 'Ton nouveau verre est plein. Ce que tu as déjà bu et tes points restent.'), pick, h('div', { class: 'confirm-actions' }, cancel, confirm));
  d.showModal();
}

function openFree(): void {
  (document.getElementById('dlg-c-turn') as HTMLDialogElement | null)?.close();
  const s = sync;
  if (!s) return;
  const d = dialog('dlg-c-free', 'confirm');
  const confirm = h('button', { type: 'button', class: 'chip primary' }, 'Acheter');
  confirm.addEventListener('click', () => {
    send({ type: 'free' });
    d.close();
  });
  const cancel = h('button', { type: 'button', class: 'chip' }, 'Annuler');
  cancel.addEventListener('click', () => d.close());
  d.replaceChildren(
    h('h2', {}, 'Free spins'),
    h('p', {}, `Tu paies ${s.freeSpinsCost} points pour lancer directement les free spins. Ils rapportent en moyenne autant qu'ils coûtent, avec de gros écarts.`),
    h('div', { class: 'confirm-actions' }, cancel, confirm),
  );
  d.showModal();
}

// ------------------------------------------------------------- mini games

let miniEl: HTMLElement | null = null;
let miniKey = '';

const sendMini = (input: MiniInput): void => send({ type: 'mini', input });

/** A button that reacts at once on touch and also tells when the finger is lifted. */
function holdButton(label: string, cls: string, onDown: () => void, onUp?: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    b.classList.add('down');
    onDown();
  });
  const up = (): void => {
    b.classList.remove('down');
    onUp?.();
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

function dirPad(): HTMLElement {
  const arrows = ['▲', '▶', '▼', '◀'];
  const cell = (d: number) => holdButton(arrows[d], `pad-btn pad-${d}`, () => sendMini({ a: 'dir', d }), () => sendMini({ a: 'dir', d: -1 }));
  return h('div', { class: 'dpad' }, cell(0), cell(3), cell(1), cell(2));
}

function joystick(kind: 'move' | 'aim' = 'move'): HTMLElement {
  const knob = h('div', { class: 'stick-knob' });
  const base = h('div', { class: `stick${kind === 'aim' ? ' aim' : ''}` }, knob);
  let active = -1;
  let lastSent = 0;
  const move = (e: PointerEvent, force = false): void => {
    const r = base.getBoundingClientRect();
    const rad = r.width / 2;
    let x = (e.clientX - (r.left + rad)) / rad;
    let y = (e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    knob.style.transform = `translate(${x * rad * 0.55}px, ${y * rad * 0.55}px)`;
    const now = performance.now();
    if (force || now - lastSent > 45) {
      lastSent = now;
      sendMini({ a: kind, x: +x.toFixed(2), y: +y.toFixed(2) });
    }
  };
  base.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = e.pointerId;
    base.setPointerCapture(e.pointerId);
    move(e, true);
  });
  base.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) move(e);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== active) return;
    active = -1;
    knob.style.transform = '';
    sendMini({ a: kind, x: 0, y: 0 });
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  return base;
}

// ---------------------------------------------------- sword: motion sensor

let motionOn = false;
let lastSwing = 0;
let invertSwing = store.get('cc.sabre.invert') === '1';
const gravity = new GravityFilter();

/** Writes a line in the sensor panel (if it is on screen). */
function motionStatus(text: string): void {
  document.querySelectorAll('[data-motion-status]').forEach((n) => (n.textContent = text));
}

function onMotion(e: DeviceMotionEvent): void {
  const m = sync?.mini ?? miniOnly?.view ?? null;
  if (!m || m.kind !== 'sabre' || m.stage !== 'play') return;
  const a = e.acceleration;
  let x: number;
  let y: number;
  if (a && a.x !== null && a.y !== null) {
    x = a.x;
    y = a.y;
  } else {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    [x, y] = gravity.remove(g.x, g.y);
  }
  const now = performance.now();
  if (now - lastSwing < SWING_COOLDOWN_MS) return;
  const d = swingDirection(x, y, invertSwing);
  if (d === null) return;
  lastSwing = now;
  buzz(35);
  sendMini({ a: 'slash', d });
  motionStatus(`Coup détecté : ${['en haut ▲', 'à droite ▶', 'en bas ▼', 'à gauche ◀'][d]}`);
}

async function enableMotion(): Promise<void> {
  if (motionOn) return;
  if (typeof DeviceMotionEvent === 'undefined') return motionStatus('Capteur introuvable sur ce téléphone : utilise les boutons.');
  if (!window.isSecureContext) return motionStatus('Gestes bloqués : ouvre la page en HTTPS (adresse https:// du QR code). Les boutons marchent.');
  try {
    // iPhones ask the player for permission, and only from a tap.
    const request = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof request === 'function' && (await request.call(DeviceMotionEvent)) !== 'granted') return motionStatus('Capteur refusé : utilise les boutons.');
  } catch {
    return motionStatus('Capteur refusé : utilise les boutons.');
  }
  window.addEventListener('devicemotion', onMotion);
  motionOn = true;
  buzz(60);
  motionStatus('Gestes activés ! Tiens le téléphone comme une épée, écran vers toi.');
}

/** The panel above the strike buttons: turn the sensor on, and turn the directions around if they feel wrong. */
function motionPanel(): HTMLElement {
  const on = h('button', { type: 'button', class: 'chip primary' }, motionOn ? 'Gestes activés ✔' : 'Activer les gestes (sabre)');
  on.addEventListener('click', () => {
    void enableMotion().then(() => {
      on.textContent = motionOn ? 'Gestes activés ✔' : 'Activer les gestes (sabre)';
    });
  });
  const flip = h('button', { type: 'button', class: 'chip' }, invertSwing ? 'Sens inversé ✔' : 'Inverser le sens');
  flip.addEventListener('click', () => {
    invertSwing = !invertSwing;
    store.set('cc.sabre.invert', invertSwing ? '1' : '0');
    flip.textContent = invertSwing ? 'Sens inversé ✔' : 'Inverser le sens';
  });
  return h(
    'div',
    { class: 'motion-panel' },
    h('div', { class: 'motion-btns' }, on, flip),
    h('p', { class: 'mini-note', 'data-motion-status': '' }, motionOn ? 'Gestes activés ! Fais le geste du sabre.' : 'Ou touche les flèches ci-dessous.'),
  );
}

function renderMini(): void {
  const m = sync?.mini ?? miniOnly?.view ?? null;
  const myMini = sync?.mini ? me : (miniOnly?.you ?? null);
  if (!m) {
    miniEl?.remove();
    miniEl = null;
    miniKey = '';
    return;
  }
  const key = `${m.kind}:${m.stage}`;
  if (!miniEl) {
    miniEl = h('div', { id: 'mini-ctl', class: 'mini-ctl' });
    document.body.append(miniEl);
  }
  if (key !== miniKey) {
    miniKey = key;
    miniEl.className = `mini-ctl${m.controls === 'tank' ? ' tank' : ''}`;
    const mine = myMini !== null;
    const body: Node[] = [h('h1', {}, m.title)];
    if (m.stage === 'intro') {
      body.push(h('p', { class: 'mini-rules' }, m.rules), h('p', { class: 'mini-big', 'data-left': '' }, String(m.left)), h('p', { class: 'mini-note' }, mine ? 'Prépare ton pouce…' : 'Tu regardes ce mini jeu.'));
      // Phones ask for the sensor permission with a tap, so the panel is there from the intro.
      if (mine && m.kind === 'sabre') body.push(motionPanel());
    } else if (m.stage === 'count') {
      body.push(h('p', { class: 'mini-count', 'data-left': '' }, String(m.left)));
    } else if (m.stage === 'play') {
      body.push(h('p', { class: 'mini-status' }, h('span', { 'data-label': '' }, ''), h('span', { 'data-left': '' }, '')));
      if (mine) {
        const tapBtn = holdButton('TAPE !', 'tap-btn', () => {
          buzz(12);
          sendMini({ a: 'tap' });
        });
        if (m.controls === 'tap') body.push(tapBtn);
        else if (m.controls === 'pad') body.push(dirPad());
        else if (m.controls === 'sabre') {
          // A cross of four big buttons: tap the way of the arrow shown on the big screen.
          const strike = (d: number, label: string): HTMLButtonElement =>
            holdButton(label, `sabre-btn sabre-${d}`, () => {
              buzz(25);
              sendMini({ a: 'slash', d });
            });
          body.push(motionPanel(), h('div', { class: 'sabre-pad' }, strike(0, '▲'), strike(3, '◀'), h('div', { class: 'sabre-mid' }, '⚔️'), strike(1, '▶'), strike(2, '▼')));
        } else if (m.controls === 'tank') {
          // Landscape layout: the move joystick under the left thumb, the aim joystick under the right one.
          body.push(
            h('p', { class: 'mini-note tank-tip' }, 'Astuce : mets ton téléphone à l’horizontale.'),
            h('div', { class: 'tank-pad' }, joystick('move'), h('div', { class: 'aim-wrap' }, joystick('aim'), h('span', { class: 'aim-hint' }, 'VISER · pousse à fond pour TIRER'))),
          );
        } else if (m.controls === 'padbomb') body.push(h('div', { class: 'pad-row' }, dirPad(), holdButton('💣', 'bomb-btn', () => {
          buzz(25);
          sendMini({ a: 'bomb' });
        })));
        else body.push(joystick());
      } else body.push(h('p', { class: 'mini-note' }, 'Tu regardes ce mini jeu.'));
    } else {
      body.push(
        h(
          'ol',
          { class: 'mini-ranking' },
          ...(m.ranking ?? []).map((r) => {
            const name = m.names?.[r.id] ?? player(r.id)?.name ?? `Joueur ${r.id + 1}`;
            return h(
              'li',
              { class: r.id === myMini ? 'is-me' : '' },
              h('span', {}, name, h('small', { class: 'mini-label' }, r.label)),
              h('strong', {}, r.reward > 0 ? `+${r.reward} pts` : '—'),
            );
          }),
        ),
        h('p', { class: 'mini-note' }, 'La partie reprend dans un instant…'),
      );
    }
    miniEl.replaceChildren(...body);
  }
  // The parts that change while the controls stay in place (a held finger must not be interrupted).
  miniEl.querySelectorAll('[data-left]').forEach((n) => {
    n.textContent = m.stage === 'play' ? `${m.left} s` : String(m.left);
  });
  const label = miniEl.querySelector('[data-label]');
  if (label) label.textContent = myMini !== null ? `${m.labels[myMini] ?? ''}` : '';
}

// -------------------------------------------------------------- vibrations

/** The phone buzzes when something happens that concerns its player. */
function watchSync(prev: SyncMsg | null, next: SyncMsg): void {
  if (me === null) return;
  const turnNow = next.active === me && !next.over;
  const turnBefore = prev ? prev.active === me : false;
  if (turnNow && (!turnBefore || prev?.phase !== next.phase)) buzz([160, 70, 160]);
  const key = (p: SyncMsg | null): string => (p?.popup ? JSON.stringify(p.popup) : '');
  if (next.popup && key(prev) !== key(next)) {
    const popup = next.popup;
    const mineTarget = (popup.kind === 'dodge' || popup.kind === 'hit') && popup.targetId === me;
    buzz(mineTarget ? [250, 90, 250, 90, 250] : 60);
  }
  if (prev && next.over && !prev.over) buzz([200, 80, 200]);
  watchMini(prev?.mini ?? null, next.mini, me);
}

let lastCountLeft = -1;
function watchMini(prev: MiniView | null, next: MiniView | null, who: number | null): void {
  if (!next || who === null) return;
  if (!prev || prev.kind !== next.kind || prev.stage !== next.stage) {
    lastCountLeft = -1;
    if (next.stage === 'intro') buzz(90);
    else if (next.stage === 'play') buzz(260);
    else if (next.stage === 'result') {
      const rank = next.ranking?.findIndex((r) => r.id === who) ?? -1;
      buzz(rank === 0 ? [120, 60, 120, 60, 320] : [120, 60, 120]);
    }
  }
  if (next.stage === 'count' && next.left !== lastCountLeft) {
    lastCountLeft = next.left;
    buzz(45);
  }
}

// ---------------------------------------------------------------- turn popup

/** When it is the player's turn a popup comes up: a big SPIN circle, then small buttons to attack or defend. */
function renderTurn(s: SyncMsg, mine: PlayerView | undefined, calm: boolean, canAttackNow: boolean, canDefendNow: boolean, canFreeNow: boolean): void {
  const d = dialog('dlg-c-turn', 'confirm turn');
  const builderOpen = ['dlg-c-attack', 'dlg-c-shield', 'dlg-c-free', 'dlg-c-drink'].some((id) => (document.getElementById(id) as HTMLDialogElement | null)?.open);
  const show = !!mine && mine.id === s.active && calm && !builderOpen && !s.over && !s.mini;
  if (!show) {
    if (d.open) d.close();
    turnKey = '';
    return;
  }
  const key = JSON.stringify([s.phase, s.spinsPerTurn, canAttackNow, canDefendNow, canFreeNow, s.freeSpinsCost, s.round]);
  if (key === turnKey && d.open) return;
  turnKey = key;
  d.addEventListener('cancel', (e) => e.preventDefault());
  const small = (label: string, cls: string, enabled: boolean, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: `turn-small ${cls}` }, label);
    b.disabled = !enabled;
    b.addEventListener('click', () => {
      buzz(30);
      onClick();
    });
    return b;
  };
  if (s.phase === 'spins') {
    const circle = h('button', { type: 'button', class: 'turn-spin', 'aria-label': `Lancer les ${s.spinsPerTurn} spins` }, h('span', {}, 'SPIN'), h('small', {}, `${s.spinsPerTurn} spins`));
    circle.addEventListener('click', () => {
      buzz(60);
      send({ type: 'spin' });
    });
    d.replaceChildren(h('h2', {}, 'À toi de jouer !'), circle);
  } else {
    d.replaceChildren(
      h('h2', {}, 'À toi de jouer !'),
      h('div', { class: 'turn-grid' }, small('Attaquer', 'attack-btn', canAttackNow, openAttack), small('Défendre', 'defend-btn', canDefendNow, openShield)),
      h('div', { class: 'turn-grid' }, small(`Free spins · ${s.freeSpinsCost} pts`, 'free-btn', canFreeNow, openFree), small('Fin du tour', 'end-btn', true, () => send({ type: 'end' }))),
    );
  }
  if (!d.open) d.showModal();
}
let turnKey = '';

// ----------------------------------------------------------------- popups

function renderPopups(): void {
  const popup = sync?.popup ?? null;
  const d = dialog('dlg-c-popup', 'confirm wide dodge');
  // A builder dialog is not needed once the big screen shows a moment.
  if (popup) for (const id of ['dlg-c-attack', 'dlg-c-shield', 'dlg-c-free']) (document.getElementById(id) as HTMLDialogElement | null)?.close();
  if (!popup) {
    lastPopupKey = '';
    if (d.open) d.close();
    return;
  }
  const key = JSON.stringify(popup) + String(me);
  if (key === lastPopupKey) return;
  lastPopupKey = key;
  d.className = popup.kind === 'dodge' ? 'confirm wide dodge' : popup.kind === 'draw' ? 'confirm wide draw' : 'confirm hit';
  d.replaceChildren(...(popup.kind === 'dodge' ? dodgeView(popup) : popup.kind === 'draw' ? drawView((popup as DrawPopup).names, (popup as DrawPopup).winner) : hitView(popup)));
  if (!d.open) d.showModal();
}

function dodgeView(p: Extract<Popup, { kind: 'dodge' }>): Node[] {
  const iAmTarget = me === p.targetId;
  const chance = dodgeChance(p.k, p.glass);
  const win = chance * 360;
  const point = (deg: number): string => `${(90 * Math.sin((deg * Math.PI) / 180)).toFixed(2)} ${(-90 * Math.cos((deg * Math.PI) / 180)).toFixed(2)}`;
  const slice = (from: number, to: number, fill: string): SVGElement => svg('path', { d: `M0 0 L${point(from)} A90 90 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)} Z`, fill });
  const needle = svg('g', { class: 'needle' });
  needle.append(svg('polygon', { points: '-6,0 6,0 0,-88', fill: '#fff4e6', stroke: '#2a1033', 'stroke-width': '2' }));
  const wheel = svg('svg', { class: 'wheel', viewBox: '-100 -100 200 200', role: 'img', 'aria-label': 'Roue de la chance' });
  const sectors = svg('g', {});
  sectors.append(slice(0, win, '#3ecf8e'), slice(win, 360, '#e8465f'));
  const ring = svg('circle', { r: '92', fill: 'none', stroke: '#fff4e6', 'stroke-width': '4' });
  const hub = svg('circle', { r: '9', fill: '#fff4e6', stroke: '#2a1033', 'stroke-width': '3' });
  wheel.append(sectors, ring, needle, hub);
  if (p.stage !== 'choose' && p.angle !== undefined) {
    const final = `rotate(${360 * 4 + p.angle}deg)`;
    if (p.stage === 'spinning') {
      // Start from the top, then spin on the next frame so the transition runs.
      needle.setAttribute('style', 'transform: rotate(0deg)');
      requestAnimationFrame(() => {
        void needle.getBoundingClientRect();
        needle.classList.add('spinning');
        needle.setAttribute('style', `transform: ${final}`);
      });
    } else {
      needle.setAttribute('style', `transform: ${final}`);
    }
  }

  const out: Node[] = [h('h2', {}, p.title), h('p', {}, p.text), wheel];
  const odds = h('p', { class: 'dodge-odds' }, 'Réussite : ', h('strong', {}, `${Math.round(chance * 100)} %`), ` → ${iAmTarget ? 'tu bois' : 'il boit'} ${parts(p.incoming - p.k)}. Raté : ×${dodgeMultiplier(p.k, p.glass)} → ${parts(failedDrink(p.incoming, p.k, p.glass))}.`);
  if (p.stage === 'choose') {
    if (iAmTarget) {
      const minus = h('button', { type: 'button', class: 'round', 'aria-label': 'Une part de moins à esquiver' }, '−');
      const plus = h('button', { type: 'button', class: 'round', 'aria-label': 'Une part de plus à esquiver' }, '+');
      minus.disabled = p.k <= 1;
      plus.disabled = p.k >= p.incoming;
      minus.addEventListener('click', () => send({ type: 'dodge-k', k: p.k - 1 }));
      plus.addEventListener('click', () => send({ type: 'dodge-k', k: p.k + 1 }));
      const drink = h('button', { type: 'button', class: 'chip' }, 'Je bois');
      const tryIt = h('button', { type: 'button', class: 'chip primary' }, 'Tenter ma chance');
      drink.addEventListener('click', () => send({ type: 'dodge-drink' }));
      tryIt.addEventListener('click', () => send({ type: 'dodge-try' }));
      out.push(h('div', { class: 'alloc-ctl dodge-ctl' }, minus, h('strong', { class: 'alloc-n' }, `Esquiver ${parts(p.k)}`), plus), odds, h('div', { class: 'confirm-actions' }, drink, tryIt));
    } else {
      out.push(h('p', { class: 'dodge-result' }, 'Il choisit : boire ou tenter la roue…'), odds);
    }
  } else if (p.stage === 'spinning') {
    out.push(h('p', { class: 'dodge-result' }, '…'));
  } else {
    out.push(h('p', { class: 'dodge-result' }, p.result ?? ''));
    if (iAmTarget) {
      const next = h('button', { type: 'button', class: 'chip primary' }, 'Voir ce que je bois');
      next.addEventListener('click', () => send({ type: 'ack' }));
      out.push(h('div', { class: 'confirm-actions' }, next));
    }
  }
  return out;
}

function hitView(p: Extract<Popup, { kind: 'hit' }>): Node[] {
  const size = p.glass;
  const rest = p.fromNext % size;
  const lastDrunk = rest === 0 ? size : rest;
  const mugs = [drainGlass(size, p.beerBefore, p.fromCurrent, 500)];
  if (p.fromNext > 0) mugs.push(drainGlass(size, size, lastDrunk, 4100, `${p.label2} : ${parts(lastDrunk)}`));
  const out: Node[] = [h('h2', {}, p.title), h('p', {}, p.text), h('div', { class: 'mug-row' }, ...mugs)];
  out.push(h('p', { class: 'hit-drink' }, p.line));
  if (me === p.targetId) {
    const ok = h('button', { type: 'button', class: 'chip primary' }, p.left > 0 ? `C'est bu ! (encore ${p.left})` : "C'est bu !");
    ok.addEventListener('click', () => send({ type: 'ack' }));
    out.push(h('div', { class: 'confirm-actions' }, ok));
  } else {
    out.push(h('p', { class: 'mode-note' }, 'En attente de la gorgée…'));
  }
  return out;
}

// A phone that was asleep: ask again for the picture of the game.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && joined) send({ type: 'hello' });
});

render();
