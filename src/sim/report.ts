/** Turns simulation statistics into text: console output and MATH.md. */
import type { GameConfig, Mode } from '../engine';
import { type Stats, type Summary, bucketLabels, summarize } from './stats';

export const TOLERANCE = 0.005;

const MODE_NAMES: Record<Mode, string> = {
  base: 'Base game',
  ante: 'Ante bet',
  buy: 'Buy feature',
};

const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`;
const int = (v: number) => Math.round(v).toLocaleString('en-US');
const oneIn = (v: number) => (v > 0 ? `1 in ${(1 / v).toFixed(v > 0.2 ? 2 : 1)}` : 'never');
const mult = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}x`;

function table(headers: string[], rows: string[][], rightAlign: boolean[] = []): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map((_, i) => (rightAlign[i] ? '---:' : '---')).join('|')}|`;
  return [head, sep, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/**
 * RTP estimate that reuses the buy-feature run to price the free spins.
 *
 * A direct estimate is noisy because free spins are rare and their wins are
 * very spread out. The free spins themselves are identical in every mode, so
 * their average value is measured most precisely by the buy run (every round
 * is a feature). Combining "return of the paid spin" + "trigger chance x
 * average feature value" gives a much tighter figure for base and ante.
 */
export function combinedRtp(s: Stats, buy: Stats | undefined): number | null {
  if (!buy || s.mode === 'buy' || buy.rounds === 0 || s.rounds === 0) return null;
  const featureValue = buy.sumFree / buy.rounds;
  const baseReturn = s.sumBase / s.rounds;
  const trigger = s.triggers / s.rounds;
  return (baseReturn + trigger * featureValue) / s.costX100;
}

function verdict(rtp: number, target: number): string {
  return Math.abs(rtp - target) <= TOLERANCE ? 'within tolerance' : 'OUT OF TOLERANCE';
}

export function summaryRows(config: GameConfig, all: Stats[]): { headers: string[]; rows: string[][] } {
  const buy = all.find((s) => s.mode === 'buy');
  const sums = all.map(summarize);
  const row = (label: string, f: (s: Summary, raw: Stats) => string) => [label, ...sums.map((s, i) => f(s, all[i]))];
  return {
    headers: ['', ...all.map((s) => MODE_NAMES[s.mode])],
    rows: [
      row('Rounds simulated', (s) => int(s.rounds)),
      row('Stake per round', (s) => `${s.cost} x bet`),
      row('**RTP (direct)**', (s) => `**${pct(s.rtp, 3)}**`),
      row('Standard error of that RTP', (s) => `±${pct(s.rtpStdError, 3)}`),
      row('RTP (combined estimate)', (_s, raw) => {
        const c = combinedRtp(raw, buy);
        return c === null ? 'n/a' : pct(c, 3);
      }),
      row(`Check against ${pct(config.targetRtp, 1)} ± ${pct(TOLERANCE, 1)}`, (s) => verdict(s.rtp, config.targetRtp)),
      row('RTP from the paid spin', (s) => pct(s.rtpBase, 3)),
      row('RTP from free spins', (s) => pct(s.rtpFree, 3)),
      row('Hit frequency (any win)', (s) => `${pct(s.hitFrequency)} (${oneIn(s.hitFrequency)})`),
      row('Free-spin trigger frequency', (s) => `${pct(s.triggerFrequency, 4)} (${oneIn(s.triggerFrequency)})`),
      row('Average free-spins payout', (s) => mult(s.avgFreeSpinsWin)),
      row('Average free spins per feature', (s) => s.avgFreeSpinsPlayed.toFixed(2)),
      row('Standard deviation per round', (s) => mult(s.stdDev)),
      row('Max win observed', (s) => `${mult(s.maxWin)} (seed ${s.maxWinSeed})`),
      row('Rounds that hit the max-win cap', (s) => int(s.capped)),
    ],
  };
}

export function distributionRows(config: GameConfig, all: Stats[]): { headers: string[]; rows: string[][] } {
  const labels = bucketLabels(config.maxWinMultiplier);
  const headers = ['Round win (x bet)'];
  for (const s of all) headers.push(`${MODE_NAMES[s.mode]}: share of rounds`, 'share of RTP');
  const rows = labels.map((label, i) => {
    const r = [label];
    for (const s of all) {
      const count = s.bucketCounts[i];
      r.push(count === 0 ? '-' : pct(count / s.rounds, 4), s.sumTotal > 0 && s.bucketSums[i] > 0 ? pct(s.bucketSums[i] / s.sumTotal, 2) : '-');
    }
    return r;
  });
  return { headers, rows };
}

function plainTable(headers: string[], rows: string[][]): string {
  const clean = (v: string) => v.replace(/\*\*/g, '');
  const all = [headers, ...rows].map((r) => r.map(clean));
  const widths = headers.map((_, c) => Math.max(...all.map((r) => r[c].length)));
  return all
    .map((r, i) => {
      const line = r.map((v, c) => (c === 0 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join('  ');
      return i === 0 ? `${line}\n${widths.map((w) => '-'.repeat(w)).join('  ')}` : line;
    })
    .join('\n');
}

export function consoleReport(config: GameConfig, all: Stats[]): string {
  const summary = summaryRows(config, all);
  const dist = distributionRows(config, all);
  return [
    `${config.title} - simulation report (target RTP ${pct(config.targetRtp, 1)})`,
    '',
    plainTable(summary.headers, summary.rows),
    '',
    'Win-size distribution',
    '',
    plainTable(dist.headers, dist.rows),
  ].join('\n');
}

function weightTable(config: GameConfig): string {
  const reels = config.reels;
  const names = ['base', 'ante', 'free'] as const;
  const totals = names.map((n) => reels[n].symbols.reduce((a, b) => a + b, 0) + reels[n].scatter + reels[n].bomb);
  const cell = (w: number, t: number) => `${w} (${pct(w / t)})`;
  const rows = config.symbols.map((sym, i) => [sym.name, ...names.map((n, k) => cell(reels[n].symbols[i], totals[k]))]);
  rows.push([config.scatter.name, ...names.map((n, k) => cell(reels[n].scatter, totals[k]))]);
  rows.push([config.bomb.name, ...names.map((n, k) => (reels[n].bomb ? cell(reels[n].bomb, totals[k]) : '-'))]);
  rows.push(['Hot-symbol spins', ...names.map((n) => `${pct(reels[n].hot.chancePer1000 / 1000, 1)} of spins, x${reels[n].hot.boost}`)]);
  return table(['Symbol', 'Base game', 'Ante bet', 'Free spins'], rows);
}

export function markdownReport(config: GameConfig, all: Stats[], command: string): string {
  const summary = summaryRows(config, all);
  const dist = distributionRows(config, all);
  const buy = all.find((s) => s.mode === 'buy');
  const bombTotal = config.bomb.weights.reduce((a, b) => a + b, 0);
  const bombMean = config.bomb.values.reduce((a, v, i) => a + v * config.bomb.weights[i], 0) / bombTotal;
  const buyTotal = Object.values(config.buy.scatterCountWeights).reduce((a, b) => a + b, 0);

  const checks = all.map((s) => {
    const sum = summarize(s);
    const combined = combinedRtp(s, buy);
    const parts = [`direct ${pct(sum.rtp, 3)} (${verdict(sum.rtp, config.targetRtp)})`];
    if (combined !== null) parts.push(`combined ${pct(combined, 3)} (${verdict(combined, config.targetRtp)})`);
    return `- **${MODE_NAMES[s.mode]}**: ${parts.join(', ')}`;
  });

  return `# ${config.title} - math report

This file is generated by the simulator. Do not edit it by hand; regenerate it with:

\`\`\`
${command}
\`\`\`

Target RTP: **${pct(config.targetRtp, 1)}**, tolerance ±${pct(TOLERANCE, 1)}, checked separately for the base game, the ante bet and the buy feature.

## Result

${checks.join('\n')}

## Headline figures

RTP is total winnings divided by total stakes. The stake is the bet in the base game, ${config.ante.costMultiplier} x bet with the ante on, and ${config.buy.costMultiplier} x bet for the buy feature. Wins are always multiples of the bet itself.

${table(summary.headers, summary.rows, summary.headers.map((_, i) => i > 0))}

Notes on reading the table:

- **RTP (direct)** is simply winnings / stakes over the simulated rounds. Its standard error is given on the next line; roughly 95% of runs land within two standard errors of the true value.
- **RTP (combined estimate)** is a lower-noise figure for the base game and ante bet. Free spins are rare and very spread out, so they dominate the noise of a direct estimate. The free spins play identically in every mode, so their average value is taken from the buy-feature run (where every round is a feature) and combined as: return of the paid spin + trigger frequency x average feature value.
- **RTP from the paid spin / from free spins** splits the direct RTP by where the win came from.
- **Average free-spins payout** is the average total won by the free spins when they trigger, in bets (the triggering spin's own win is not included).

## Win-size distribution

Share of rounds that end in each win band, and the share of all winnings (RTP) that band contributes.

${table(dist.headers, dist.rows, dist.headers.map((_, i) => i > 0))}

## Model

Every grid position, on the first drop and on every tumble refill, is an independent draw from a weighted bag of symbols. There is one bag for the base game, one for the ante bet and one for free spins.

${table(
  ['Symbol', ...config.payTiers.map((t, i) => (i + 1 < config.payTiers.length ? `${t}-${config.payTiers[i + 1] - 1}` : `${t}+`))],
  config.symbols.map((s) => [s.name, ...s.pays.map((p) => `${p}x`)]),
  [false, true, true, true],
)}

Weights (and the share of the bag they represent):

${weightTable(config)}

**Hot-symbol spins.** On the stated share of spins one symbol is chosen and its weight is multiplied for that whole spin. This makes symbol counts clumpy, the way stacked reel strips do in a physical-style slot: wins are less frequent but larger, which is what gives the game its high volatility without changing the paytable.

**Scatter.** ${Object.entries(config.scatter.pays)
    .map(([k, v]) => `${k}${Number(k) === Math.max(...Object.keys(config.scatter.pays).map(Number)) ? '+' : ''} pay ${v}x`)
    .join(', ')}. ${config.scatter.triggerCount}+ trigger ${config.scatter.freeSpins} free spins; ${config.scatter.retriggerCount}+ during free spins add ${config.scatter.retriggerSpins}. Scatters are counted once per spin, when the tumbles have finished.

**Multiplier bombs** (free spins only). Average bomb value ${bombMean.toFixed(2)}x.

${table(['Value', ...config.bomb.values.map((v) => `${v}x`)], [['Weight', ...config.bomb.weights.map(String)], ['Chance', ...config.bomb.weights.map((w) => pct(w / bombTotal, 1))]])}

**Ante bet.** Same symbol weights as the base game with a heavier scatter, set so the trigger frequency is about twice the base game's (see the table above).

**Buy feature.** Costs ${config.buy.costMultiplier} x bet. The bought spin lands ${Object.entries(config.buy.scatterCountWeights)
    .map(([k, w]) => `${k} scatters ${pct(w / buyTotal, 1)} of the time`)
    .join(', ')}, then plays the same free spins as a natural trigger.

**Max win.** A round is capped at ${int(config.maxWinMultiplier)} x bet and ends as soon as it gets there.

## Reproducing a result

Round *n* of a run uses seed \`start + n\`, where the start is ${all.map((s) => `${int(s.seedFrom)} for ${MODE_NAMES[s.mode].toLowerCase()}`).join(', ')}. Any single round can be replayed with \`npm run simulate -- --replay <seed> --mode <base|ante|buy>\`, including the max wins listed above.
`;
}
