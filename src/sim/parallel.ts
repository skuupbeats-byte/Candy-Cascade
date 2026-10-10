/**
 * Runs simulation chunks in parallel child processes. Each chunk is a seed
 * range, so the merged result is the same however many processes are used.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { CONFIG, type Mode } from '../engine';
import { type Stats, emptyStats, mergeStats, runChunk } from './stats';

export interface ChunkJob {
  mode: Mode;
  firstSeed: number;
  rounds: number;
}

/** Called in the child process: answer chunk jobs until the parent disconnects. */
export function serveWorker(): void {
  process.on('message', (job: ChunkJob) => {
    process.send?.(runChunk(CONFIG, job.mode, job.firstSeed, job.rounds));
  });
}

export async function runParallel(
  scriptPath: string,
  mode: Mode,
  firstSeed: number,
  rounds: number,
  threads: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Stats> {
  // Chunks are small enough for smooth progress but large enough to amortise messaging.
  const chunkSize = mode === 'buy' ? 20_000 : 250_000;
  const jobs: ChunkJob[] = [];
  for (let start = 0; start < rounds; start += chunkSize) {
    jobs.push({ mode, firstSeed: firstSeed + start, rounds: Math.min(chunkSize, rounds - start) });
  }

  let total = emptyStats(CONFIG, mode);
  let done = 0;
  const finish = (stats: Stats) => {
    total = mergeStats(total, stats);
    done += stats.rounds;
    onProgress?.(done, rounds);
  };

  if (threads <= 1 || jobs.length <= 1) {
    for (const job of jobs) finish(runChunk(CONFIG, job.mode, job.firstSeed, job.rounds));
    return total;
  }

  let next = 0;
  const workers: ChildProcess[] = [];
  await new Promise<void>((resolve, reject) => {
    let active = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      for (const w of workers) w.kill();
      reject(err);
    };
    const feed = (worker: ChildProcess) => {
      if (next < jobs.length) {
        worker.send(jobs[next++]);
      } else {
        worker.disconnect();
        if (--active === 0) resolve();
      }
    };
    for (let i = 0; i < Math.min(threads, jobs.length); i++) {
      const worker = fork(scriptPath, ['--worker'], { execArgv: process.execArgv });
      workers.push(worker);
      active++;
      worker.on('message', (stats: Stats) => {
        finish(stats);
        feed(worker);
      });
      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (code !== 0 && code !== null) fail(new Error(`Simulation worker exited with code ${code}`));
      });
      feed(worker);
    }
  });
  return total;
}
