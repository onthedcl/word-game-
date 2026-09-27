/// <reference lib="webworker" />
// Loads the dictionary once and builds puzzles off the main thread.
import { parseDawg, type Dawg } from '../engine/dawg';
import { generateBlitz, generateDaily, withAnswers } from '../engine/generator';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let loaded: Promise<{ dict: Dawg; accepted: Dawg; seeds: string[] }> | null = null;

async function fetchText(file: string): Promise<string> {
  const res = await fetch(new URL(`${import.meta.env.BASE_URL}dict/${file}`, self.location.origin));
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return res.text();
}

function load() {
  loaded ??= Promise.all([fetchText('words.dawg'), fetchText('words-all.dawg'), fetchText('pangrams.txt')]).then(([dawg, all, pangrams]) => ({
    dict: parseDawg(dawg),
    accepted: parseDawg(all),
    seeds: pangrams.split('\n').filter(Boolean),
  }));
  return loaded;
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  let reply: WorkerResponse;
  try {
    const { dict, accepted, seeds } = await load();
    const { request } = data;
    // Boards come from common words; answers include every accepted word.
    const puzzle = withAnswers(
      request.type === 'daily' ? generateDaily(dict, seeds, request.dateKey) : generateBlitz(dict, seeds, request.seed),
      accepted,
    );
    reply = { id: data.id, puzzle };
  } catch (err) {
    loaded = null;
    reply = { id: data.id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
