// Promise wrapper around the puzzle worker, with a per-request cache.
import type { Puzzle } from '../engine/generator';
import type { PuzzleRequest, WorkerResponse } from './protocol';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (p: Puzzle) => void; reject: (e: Error) => void }>();
const cache = new Map<string, Promise<Puzzle>>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./puzzle.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const job = pending.get(data.id);
      pending.delete(data.id);
      if (!job) return;
      if ('error' in data) job.reject(new Error(data.error));
      else job.resolve(data.puzzle);
    };
  }
  return worker;
}

export function requestPuzzle(request: PuzzleRequest): Promise<Puzzle> {
  const key = request.type === 'daily' ? `daily:${request.dateKey}` : `blitz:${request.seed}`;
  let job = cache.get(key);
  if (!job) {
    job = new Promise<Puzzle>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, request });
    });
    job.catch(() => cache.delete(key));
    cache.set(key, job);
  }
  return job;
}
