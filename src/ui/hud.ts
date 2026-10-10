/** The HTML controls around the board. Pure view: it shows what it is told and reports clicks. */
import { CONFIG, roundCost } from '../engine';
import { credits, multiple } from './format';

export interface HudHandlers {
  spin(): void;
  betStep(direction: -1 | 1): void;
  toggleAnte(): void;
  /** The buy button was pressed (before confirmation). */
  requestBuy(): void;
  /** The purchase was confirmed. */
  buy(): void;
  autoplay(spins: number): void;
  stopAutoplay(): void;
  toggleTurbo(): void;
  toggleSound(): void;
  resetBalance(): void;
  /** Current details for the paytable. */
  paytableInfo(): { bet: number; lastSeed: number | null };
  /** A picture of a symbol (by symbol code) as an image URL. */
  symbolImage(code: number): Promise<string>;
}

export interface HudView {
  balance: number;
  bet: number;
  ante: boolean;
  turbo: boolean;
  sound: boolean;
  /** True when a new round can be started. */
  ready: boolean;
  autoplayOn: boolean;
  autoplayLeft: number;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export class Hud {
  private balance = el('balance');
  private bet = el('bet');
  private betDown = el<HTMLButtonElement>('bet-down');
  private betUp = el<HTMLButtonElement>('bet-up');
  private ante = el<HTMLButtonElement>('btn-ante');
  private anteNote = el('ante-note');
  private spinButton = el<HTMLButtonElement>('btn-spin');
  private buy = el<HTMLButtonElement>('btn-buy');
  private buyNote = el('buy-note');
  private auto = el<HTMLButtonElement>('btn-auto');
  private autoTitle = el('auto-title');
  private autoNote = el('auto-note');
  private autoMenu = el('auto-menu');
  private turbo = el<HTMLButtonElement>('btn-turbo');
  private turboNote = el('turbo-note');
  private sound = el<HTMLButtonElement>('btn-sound');
  private reset = el<HTMLButtonElement>('btn-reset');
  private win = el('win');
  private message = el('message');
  private fsLeft = el('fs-left');
  private fsLeftValue = el('fs-left-value');
  private fsTotal = el('fs-total');
  private fsTotalValue = el('fs-total-value');
  private paytable = el<HTMLDialogElement>('dlg-paytable');
  private paytableBody = el('paytable-body');
  private buyDialog = el<HTMLDialogElement>('dlg-buy');
  private resetDialog = el<HTMLDialogElement>('dlg-reset');
  private view: HudView | null = null;

  constructor(handlers: HudHandlers) {
    this.spinButton.addEventListener('click', () => handlers.spin());
    this.betDown.addEventListener('click', () => handlers.betStep(-1));
    this.betUp.addEventListener('click', () => handlers.betStep(1));
    this.ante.addEventListener('click', () => handlers.toggleAnte());
    this.buy.addEventListener('click', () => handlers.requestBuy());
    this.turbo.addEventListener('click', () => handlers.toggleTurbo());
    this.sound.addEventListener('click', () => handlers.toggleSound());

    this.auto.addEventListener('click', () => {
      if (this.view?.autoplayOn) handlers.stopAutoplay();
      else this.setAutoMenu(Boolean(this.autoMenu.hidden));
    });
    this.autoMenu.addEventListener('click', (event) => {
      const spins = Number((event.target as HTMLElement).dataset.auto);
      if (!spins) return;
      this.setAutoMenu(false);
      handlers.autoplay(spins);
    });
    document.addEventListener('pointerdown', (event) => {
      if (!this.autoMenu.hidden && !(event.target as HTMLElement).closest('.auto')) this.setAutoMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.setAutoMenu(false);
    });

    el('btn-paytable').addEventListener('click', () => {
      const info = handlers.paytableInfo();
      this.paytableBody.innerHTML = paytableHtml(info.bet, info.lastSeed);
      this.paytable.showModal();
      this.paytableBody.scrollTop = 0;
      // Pictures are filled in as they become available, so the dialog never waits for them.
      this.paytableBody.querySelectorAll<HTMLImageElement>('img[data-code]').forEach((img) => {
        void handlers.symbolImage(Number(img.dataset.code)).then((url) => (img.src = url));
      });
    });
    this.reset.addEventListener('click', () => {
      el('reset-text').textContent = `Your balance goes back to ${credits(CONFIG.startingBalance)} play credits.`;
      this.resetDialog.showModal();
    });
    el('reset-confirm').addEventListener('click', () => {
      this.resetDialog.close();
      handlers.resetBalance();
    });
    el('buy-confirm').addEventListener('click', () => {
      this.buyDialog.close();
      handlers.buy();
    });

    for (const dialog of [this.paytable, this.buyDialog, this.resetDialog]) {
      dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
      // Clicking the dimmed area outside the dialog closes it.
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }

    // After a mouse or touch press, drop focus so the spacebar goes back to spinning.
    document.addEventListener('pointerup', () => {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && !active.closest('dialog')) active.blur();
    });
  }

  get dialogOpen(): boolean {
    return this.paytable.open || this.buyDialog.open || this.resetDialog.open;
  }

  private setAutoMenu(open: boolean): void {
    this.autoMenu.hidden = !open;
    this.auto.setAttribute('aria-expanded', String(open));
  }

  render(view: HudView): void {
    this.view = view;
    const locked = !view.ready || view.autoplayOn;
    const bets = CONFIG.bets;
    const index = bets.indexOf(view.bet);

    this.balance.textContent = credits(view.balance);
    this.bet.textContent = credits(view.bet);
    this.betDown.disabled = locked || index <= 0;
    this.betUp.disabled = locked || index >= bets.length - 1;

    this.ante.disabled = locked;
    this.ante.setAttribute('aria-pressed', String(view.ante));
    this.anteNote.textContent = view.ante ? `On, stake ${credits(roundCost(CONFIG, view.bet, 'ante'))}` : 'Double chance';
    this.ante.title = `Stake ${multiple(CONFIG.ante.costMultiplier)} your bet for twice the chance of free spins`;

    this.buy.disabled = locked || view.ante;
    this.buyNote.textContent = view.ante ? 'Ante bet is on' : credits(roundCost(CONFIG, view.bet, 'buy'));
    this.buy.title = view.ante
      ? 'Turn off the ante bet to buy free spins'
      : `Pay ${multiple(CONFIG.buy.costMultiplier)} your bet to start free spins now`;

    this.spinButton.disabled = locked;

    this.auto.classList.toggle('stop', view.autoplayOn);
    this.auto.disabled = !view.autoplayOn && !view.ready;
    this.autoTitle.textContent = view.autoplayOn ? 'Stop autoplay' : 'Autoplay';
    this.autoNote.textContent = view.autoplayOn ? `${view.autoplayLeft} left` : 'Choose spins';
    if (locked) this.setAutoMenu(false);

    this.turbo.setAttribute('aria-pressed', String(view.turbo));
    this.turboNote.textContent = view.turbo ? 'On' : 'Off';
    this.sound.setAttribute('aria-pressed', String(view.sound));
    this.sound.textContent = view.sound ? 'Sound on' : 'Sound off';
    this.reset.disabled = locked;
  }

  setWin(value: number): void {
    this.win.textContent = credits(value);
  }

  setMessage(text: string, warn = false): void {
    this.message.textContent = text;
    this.message.classList.toggle('warn', warn);
  }

  /** Show or hide the free-spins counters. */
  setFreeSpins(info: { left: number; total: number } | null): void {
    this.fsLeft.hidden = info === null;
    this.fsTotal.hidden = info === null;
    if (info) {
      this.fsLeftValue.textContent = String(info.left);
      this.fsTotalValue.textContent = credits(info.total);
    }
  }

  confirmBuy(cost: number, bet: number): void {
    el('buy-text').textContent =
      `Pay ${credits(cost)} (${multiple(CONFIG.buy.costMultiplier)} your ${credits(bet)} bet) to start ` +
      `${CONFIG.scatter.freeSpins} free spins right away.`;
    this.buyDialog.showModal();
  }
}

/** Build the paytable from the config, so it can never disagree with the engine. */
function paytableHtml(bet: number, lastSeed: number | null): string {
  const c = CONFIG;
  const tiers = c.payTiers.map((t, i) => (i + 1 < c.payTiers.length ? `${t} to ${c.payTiers[i + 1] - 1}` : `${t} or more`));
  const scatterCounts = Object.keys(c.scatter.pays).map(Number).sort((a, b) => a - b);

  const pay = (x: number) => `${multiple(x)} <span aria-hidden="true">=</span> ${credits(x * bet)}`;
  const card = (code: number, name: string, rows: Array<[string, number]>) => `
    <div class="pay-card">
      <img data-code="${code}" alt="" width="68" height="68" />
      <div>
        <h4>${name}</h4>
        <table>${rows.map(([label, x]) => `<tr><th scope="row">${label}</th><td>${pay(x)}</td></tr>`).join('')}</table>
      </div>
    </div>`;
  const symbolCards = c.symbols.map((s, i) => card(i, s.name, s.pays.map((p, t) => [tiers[t], p] as [string, number])));
  const scatterCard = card(
    c.symbols.length,
    `${c.scatter.name} (scatter)`,
    scatterCounts.map((n, i) => [i === scatterCounts.length - 1 ? `${n} or more` : String(n), c.scatter.pays[n]] as [string, number]),
  );

  return `
    <p class="pay-note">A symbol wins when ${c.payTiers[0]} or more of it land anywhere on the board. There are no paylines.
    Pays are multiples of your bet, shown here for a bet of ${credits(bet)}.</p>
    <div class="pay-grid">${symbolCards.join('')}${scatterCard}</div>

    <h3>Tumbles</h3>
    <p>After a win is paid, the winning symbols pop, the symbols above fall into the gaps and new ones drop in from the top.
    This repeats until no new win forms. Every win in the sequence is added to the spin's total.</p>

    <h3>Free spins</h3>
    <ul>
      <li>${c.scatter.triggerCount} or more lollipops on the board start ${c.scatter.freeSpins} free spins. Lollipops are never removed by tumbles, and they are counted once the tumbles have finished.</li>
      <li>During free spins, ${c.scatter.retriggerCount} or more lollipops add ${c.scatter.retriggerSpins} more spins.</li>
      <li>Free spins use the bet of the spin that started them.</li>
    </ul>

    <h3>Multiplier bombs</h3>
    <p>Bombs only land during free spins and stay on the board until the tumbles end. Then every bomb on screen is added
    together and the spin's win is multiplied by that total. Low values are far more common than high ones.</p>
    <ul class="bomb-values">${c.bomb.values.map((v) => `<li>x${v}</li>`).join('')}</ul>

    <h3>Ante bet</h3>
    <p>Turning on the ante bet raises your stake to ${multiple(c.ante.costMultiplier)} the bet and doubles the chance of starting
    free spins. Wins are still multiples of the bet itself. You cannot buy free spins while the ante bet is on.</p>

    <h3>Buy free spins</h3>
    <p>Pay ${multiple(c.buy.costMultiplier)} your bet and the next spin lands ${c.scatter.triggerCount} or more lollipops, starting free spins straight away.</p>

    <h3>Max win</h3>
    <p>A round can pay at most ${multiple(c.maxWinMultiplier)} the bet. If the total reaches that amount, the round ends and the max win is paid.</p>

    <h3>Controls</h3>
    <ul>
      <li>Press Spin or the spacebar to play. Bets run from ${credits(c.bets[0])} to ${credits(c.bets[c.bets.length - 1])}.</li>
      <li>Autoplay runs 10, 25, 50 or 100 spins and can be stopped at any time. Turbo speeds up the animations.</li>
    </ul>

    <h3>About this game</h3>
    <p>${c.title} is a play-money game that runs entirely in your browser. Credits are fictional, are saved only on this
    device and cannot be bought, withdrawn or exchanged for anything. The long-run return is about
    ${(c.targetRtp * 100).toFixed(1)}% in every mode, measured by simulation (see MATH.md).</p>
    ${lastSeed === null ? '' : `<p>Seed of the last round: <span class="seed">${lastSeed}</span></p>`}`;
}
