/**
 * Headless simulator.
 *
 *   npm run simulate -- --spins 10000000
 *   npm run simulate -- --spins 2000000 --mode buy
 *   npm run simulate -- --spins 10000000 --report MATH.md
 *   npm run simulate -- --replay 12345 --mode base
 */
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONFIG, type Mode, spin, symbolCodes } from '../engine';
import { runParallel, serveWorker } from './parallel';
import { consoleReport, markdownReport } from './report';
import type { Stats } from './stats';

const MODES: Mode[] = ['base', 'ante', 'buy'];
/** Each mode gets its own seed range so runs never share seeds. */
const SEED_OFFSET: Record<Mode, number> = { base: 0, ante: 2 ** 40, buy: 2 ** 41 };

interface Options {
  spins: number;
  buySpins: number | null;
  modes: Mode[];
  seed: number;
  threads: number;
  report: string | null;
  json: boolean;
  replay: number | null;
}

function usage(): string {
  return `Usage: npm run simulate -- [options]

  --spins N        rounds to simulate per mode (default 1,000,000)
  --buy-spins N    rounds for the buy feature, if different from --spins
  --mode M         base, ante, buy or all (default all)
  --seed S         first seed of the run (default 1)
  --threads T      parallel processes (default: number of CPU cores, max 8)
  --report FILE    also write the report as Markdown (for example MATH.md)
  --json           print raw statistics as JSON instead of tables
  --replay SEED    play one round with this seed and print what happened
  --help           show this text`;
}

function parseNumber(text: string | undefined, name: string): number {
  const value = Number((text ?? '').replace(/[_,]/g, ''));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} needs a non-negative whole number`);
  return value;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    spins: 1_000_000,
    buySpins: null,
    modes: MODES,
    seed: 1,
    threads: Math.min(8, availableParallelism()),
    report: null,
    json: false,
    replay: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i];
    switch (arg) {
      case '--spins': o.spins = parseNumber(value(), '--spins'); break;
      case '--buy-spins': o.buySpins = parseNumber(value(), '--buy-spins'); break;
      case '--seed': o.seed = parseNumber(value(), '--seed'); break;
      case '--threads': o.threads = Math.max(1, parseNumber(value(), '--threads')); break;
      case '--report': o.report = value() ?? 'MATH.md'; break;
      case '--json': o.json = true; break;
      case '--replay': o.replay = parseNumber(value(), '--replay'); break;
      case '--mode': {
        const m = value();
        if (m === 'all') o.modes = MODES;
        else if (MODES.includes(m as Mode)) o.modes = [m as Mode];
        else throw new Error('--mode must be base, ante, buy or all');
        break;
      }
      case '--help': case '-h':
        console.log(usage());
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        throw new Error(`Unknown option ${arg}\n\n${usage()}`);
    }
  }
  if (o.spins < 1) throw new Error('--spins must be at least 1');
  return o;
}

function replay(seed: number, mode: Mode): void {
  const r = spin(CONFIG, 1, mode, seed);
  const { SCATTER, BOMB } = symbolCodes(CONFIG);
  const letters = ['R', 'P', 'G', 'B', 'a', 'p', 'w', 'g', 'b'];
  const show = (grid: { symbols: number[]; bombValues: number[] }) => {
    for (let row = 0; row < CONFIG.rows; row++) {
      let line = '   ';
      for (let col = 0; col < CONFIG.cols; col++) {
        const i = col * CONFIG.rows + row;
        const s = grid.symbols[i];
        const text = s === SCATTER ? '*' : s === BOMB ? `x${grid.bombValues[i]}` : letters[s] ?? String(s);
        line += text.padEnd(5);
      }
      console.log(line);
    }
  };
  const showSpin = (title: string, s: typeof r.baseSpin) => {
    console.log(`\n${title}`);
    show(s.initialGrid);
    s.steps.forEach((step, n) => {
      const wins = step.wins.map((w) => `${w.count} x ${CONFIG.symbols[w.symbol].name} pays ${w.pay}x`).join(', ');
      console.log(`  tumble ${n + 1}: ${wins}`);
      show(step.gridAfter);
    });
    const parts = [`symbols ${s.tumbleWin}x`];
    if (s.scatterWin) parts.push(`${s.scatterCount} scatters ${s.scatterWin}x`);
    if (s.bombs.length) parts.push(`bombs ${s.bombs.map((b) => `x${b.value}`).join(' + ')}${s.multiplier > 1 ? ` = x${s.multiplier}` : ' (no win to multiply)'}`);
    console.log(`  spin win: ${s.win}x  (${parts.join('; ')})${s.freeSpinsAwarded ? `  +${s.freeSpinsAwarded} free spins` : ''}`);
  };
  console.log(`${CONFIG.title}: seed ${seed}, mode ${mode}, bet 1`);
  console.log('Legend: R P G B = red/purple/green/blue candy, a p w g b = apple/plum/watermelon/grapes/banana, * = scatter, xN = bomb');
  showSpin('Paid spin', r.baseSpin);
  r.freeSpins.forEach((s, i) => showSpin(`Free spin ${i + 1}`, s));
  console.log(`\nRound total: ${r.totalWin}x the bet${r.capped ? ' (max win reached, round ended)' : ''}; stake ${r.cost}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--worker') {
    serveWorker();
    return;
  }
  const o = parseArgs(argv);

  if (o.replay !== null) {
    replay(o.replay, o.modes.length === 1 ? o.modes[0] : 'base');
    return;
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const started = Date.now();
  const results: Stats[] = [];
  for (const mode of o.modes) {
    const rounds = mode === 'buy' && o.buySpins !== null ? o.buySpins : o.spins;
    if (rounds < 1) continue;
    let lastShown = 0;
    const stats = await runParallel(scriptPath, mode, o.seed + SEED_OFFSET[mode], rounds, o.threads, (done, total) => {
      if (!process.stderr.isTTY) return;
      const now = Date.now();
      if (now - lastShown < 200 && done < total) return;
      lastShown = now;
      process.stderr.write(`\r${mode}: ${((done / total) * 100).toFixed(0)}% of ${total.toLocaleString('en-US')} rounds   `);
    });
    if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(60) + '\r');
    results.push(stats);
  }

  if (o.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(consoleReport(CONFIG, results));
    console.log(`\nFinished in ${((Date.now() - started) / 1000).toFixed(1)}s using ${o.threads} process${o.threads === 1 ? '' : 'es'}.`);
  }

  if (o.report) {
    const command = `npm run simulate -- --spins ${o.spins}${o.buySpins !== null ? ` --buy-spins ${o.buySpins}` : ''}${o.seed !== 1 ? ` --seed ${o.seed}` : ''} --report ${o.report}`;
    writeFileSync(o.report, markdownReport(CONFIG, results, command));
    console.log(`Report written to ${o.report}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
