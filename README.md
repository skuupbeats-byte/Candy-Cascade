# Candy Cascade

A local, single-player, play-money slot game: a 6 x 5 board where 8 or more matching symbols anywhere win, winning symbols tumble away, and free spins bring multiplier bombs.

Everything runs in your browser on your own machine. There is no backend, no account, no network call and no real money. Credits are fictional and are saved in the browser's localStorage.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer (20.19 or later also works).

```
npm install
npm run dev
```

Then open the address Vite prints (normally http://localhost:5173).

| Command | What it does |
|---|---|
| `npm run dev` | Start the game with live reload |
| `npm run build` | Type-check and build a static copy into `dist/` |
| `npm run preview` | Serve the built copy locally |
| `npm test` | Run the test suite once |
| `npm run simulate` | Run the headless math simulator (see below) |

## Playing

- **Spin**: the Spin button or the spacebar.
- **Bet**: 0.20 to 100 credits, with the minus and plus buttons.
- **Ante bet**: raises the stake by 25% and doubles the chance of free spins. Buying is disabled while it is on.
- **Buy free spins**: pay 100 x the bet to start free spins straight away (asks for confirmation).
- **Autoplay**: 10, 25, 50 or 100 spins; the same button stops it.
- **Turbo**: faster animations.
- **Pays and rules**: the full paytable and rules, generated from the game config.
- **Sound**: off by default.
- **Reset balance**: back to 10,000 credits.

Banners (free spins, big wins) close on their own; a click, tap or the spacebar closes them sooner.

## How it is put together

```
src/engine/   Pure game logic. No rendering, no DOM. Runs headless.
  config.ts     The paytable, every weight and every feature parameter
  engine.ts     spin(config, bet, mode, seed) -> a complete round result
  rng.ts        Seedable random number generator
  types.ts      Shape of the round result
src/sim/      The simulator command line tool
src/ui/       PixiJS board and animations, HTML controls
  game.ts         Controller: balance, autoplay, plays a result back
  stateMachine.ts Round states: idle, spinning, tumbling, freeSpinIntro, freeSpins, summary
  scene.ts, gridView.ts, symbolArt.ts   The Pixi scene and vector artwork
  hud.ts, style.css                     Controls, paytable and dialogs
tests/        Vitest tests
MATH.md       Simulation report for the shipped weights
DECISIONS.md  Choices that were not spelled out in the brief
```

The engine decides the whole round up front: `spin()` returns every grid, every tumble step, the wins, the bombs and the final payout. The UI only plays that result back, so what you see can never disagree with what was paid.

Every spin is reproducible from its seed. The seed of the last round is shown at the bottom of "Pays and rules", and can be replayed in the terminal:

```
npm run simulate -- --replay 12345 --mode base
```

While running `npm run dev`, the browser console also has `__game.replay(seed, 'base' | 'ante' | 'buy')`, which plays a seed on screen without touching the balance.

## Simulating

```
npm run simulate -- --spins 10000000
```

This plays 10 million rounds in each of the three modes (base game, ante bet, buy feature) and prints, per mode: overall RTP, RTP split between the paid spin and free spins, hit frequency, free-spin trigger frequency, average free-spins payout, the largest win seen, and a win-size distribution.

Options:

| Option | Meaning |
|---|---|
| `--spins N` | Rounds per mode (default 1,000,000) |
| `--buy-spins N` | Rounds for the buy feature, if different (each one is a whole feature, so it is about ten times slower per round) |
| `--mode base\|ante\|buy\|all` | Which modes to run (default all) |
| `--seed S` | First seed (default 1). The same seed gives the same report |
| `--threads T` | Parallel processes (default: CPU cores, up to 8) |
| `--report MATH.md` | Also write the report as Markdown |
| `--json` | Print raw statistics as JSON |
| `--replay SEED` | Print one round, grid by grid |

Speed is roughly 1.4 million base-game rounds per second per core.

**How precise is a run?** This is a high-volatility game, so RTP estimates are noisy: 10 million base-game rounds pin the RTP down to about ±0.3% (one standard error). The report prints the standard error, and also a "combined estimate" that is much tighter because it prices the free spins from the buy-feature run. `MATH.md` was made with 100 million rounds for the base game and ante bet and 20 million bought features.

## Retuning the math

All numbers live in `src/engine/config.ts`. Nothing else needs to change.

1. Edit the config.
2. Run `npm run simulate -- --spins 20000000 --buy-spins 4000000` and read the three RTP figures.
3. Repeat until all three are within 0.5% of the target, then regenerate the report:
   `npm run simulate -- --spins 100000000 --buy-spins 20000000 --report MATH.md`
4. Run `npm test`. A few tests in `tests/math.test.ts` guard the shipped numbers and will need new ranges if you retune on purpose.

The three modes are tied together, so tune in this order:

1. **Buy feature first.** Its RTP is (value of the bought spin + average free-spins payout) / 100. Raise or lower the free-spins payout with `reels.free.bomb` (one step of the bomb weight moves the payout by about 0.17 bets), or more coarsely with `bomb.weights` and `reels.free.hot`.
2. **Base game.** RTP = return of the paid spin + trigger frequency x free-spins payout. Move the trigger frequency with `reels.base.scatter` (one step is about 0.5% more or fewer triggers) and the paid-spin return with `reels.base.hot.chancePer1000` (one step is about 0.15% RTP).
3. **Ante bet.** Set `reels.ante.scatter` so the trigger frequency is twice the base game's. With the symbol weights shared, the ante RTP then lands close to the base game's; nudge the scatter weight by one or two to finish.

What the main levers do:

| Setting | Effect |
|---|---|
| `SYMBOL_WEIGHTS` | Steeper weights (more bananas, fewer red candies) mean more frequent, smaller wins |
| `hot.chancePer1000`, `hot.boost` | How often, and how strongly, one symbol is boosted for a whole spin. This is the main volatility control |
| `reels.*.scatter` | Free-spin trigger and retrigger frequency |
| `reels.free.bomb`, `bomb.weights` | How often bombs land and how big they are |
| `buy.scatterCountWeights` | How many scatters a bought spin lands |

## Testing

`npm test` covers: win detection at 7 to 12+ symbols for every symbol, tumble gravity, scatter pays and triggers, retriggers, bomb summing, the max-win cap, ante and buy modes, seed reproducibility, config validation, the round state machine, saved-state handling, and smoke checks on the tuned math.

## Artwork and names

The title, symbols and sounds are original. Symbols are drawn in code as vector shapes (`src/ui/symbolArt.ts`) and sounds are synthesised, so there are no image or audio files. Fonts are Lilita One and Nunito (SIL Open Font License), installed from npm and served locally.
