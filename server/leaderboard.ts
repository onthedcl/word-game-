// Leaderboard rules. Scores are never trusted from the client: the server
// rebuilds the same puzzle from its seed and scores the submitted words itself.
import { generateBlitz, generateDaily, type Puzzle } from '../src/engine/generator';
import { answerIndex, progress } from '../src/engine/game';
import { EPOCH, isDateKey, shiftDateKey } from '../src/engine/dates';
import type { Dawg } from '../src/engine/dawg';
import { cleanName } from './names';

export const BLITZ_SECONDS = 180;
const BLITZ_GRACE_SECONDS = 20; // network latency and slow phones
const TOP_N = 50;

/** The subset of a Netlify Blobs store this module uses (easy to fake in tests). */
export interface KV {
  get(key: string, opts: { type: 'json' }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

export interface Deps {
  kv: KV;
  loadDictionary(): Promise<{ dict: Dawg; seeds: string[] }>;
  now(): number;
  randomId(): string;
}

export interface Entry {
  name: string;
  score: number;
  words: number;
  pangrams: number;
  rankName: string;
  updatedAt: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PLAYER_ID = /^[A-Za-z0-9-]{16,64}$/;

function playerIdOf(value: unknown): string {
  if (typeof value !== 'string' || !PLAYER_ID.test(value)) throw new ApiError(400, 'Bad player id');
  return value;
}

function nameOf(value: unknown): string {
  const name = cleanName(value);
  if (!name) throw new ApiError(400, 'Please pick a different name (2–16 letters or numbers)');
  return name;
}

function wordsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) throw new ApiError(400, 'Bad word list');
  return [...new Set(value.filter((w): w is string => typeof w === 'string').map((w) => w.toLowerCase()))];
}

function score(puzzle: Puzzle, submitted: string[], name: string, now: number): Entry {
  const answers = answerIndex(puzzle);
  const valid = submitted.filter((w) => answers.has(w));
  const p = progress(puzzle, answers, valid);
  return { name, score: p.score, words: valid.length, pangrams: p.pangramsFound, rankName: p.rank.name, updatedAt: now };
}

/** Today's date could be yesterday or tomorrow somewhere, so allow one day either side of UTC. */
function checkDailyDate(date: unknown, now: number): string {
  if (typeof date !== 'string' || !isDateKey(date) || date < EPOCH) throw new ApiError(400, 'Bad date');
  const today = new Date(now).toISOString().slice(0, 10);
  if (date < shiftDateKey(today, -1) || date > shiftDateKey(today, 1)) throw new ApiError(400, 'That puzzle is closed');
  return date;
}

async function readBoard(kv: KV, prefix: string, playerId: string | null) {
  const { blobs } = await kv.list({ prefix });
  const rows = (
    await Promise.all(blobs.map(async ({ key }) => ({ key, entry: (await kv.get(key, { type: 'json' })) as Entry | null })))
  ).filter((r): r is { key: string; entry: Entry } => !!r.entry);
  rows.sort((a, b) => b.entry.score - a.entry.score || a.entry.updatedAt - b.entry.updatedAt);
  const toRow = (r: (typeof rows)[number], i: number) => {
    const { name, score, words, pangrams, rankName } = r.entry;
    return { position: i + 1, name, score, words, pangrams, rankName, you: !!playerId && r.key === prefix + playerId };
  };
  const all = rows.map(toRow);
  return { total: rows.length, top: all.slice(0, TOP_N), you: all.find((r) => r.you) ?? null };
}

// Puzzles are deterministic, so they can be cached for the life of the function instance.
const puzzleCache = new Map<string, Puzzle>();
async function puzzleFor(deps: Deps, key: string, make: (dict: Dawg, seeds: string[]) => Puzzle) {
  let p = puzzleCache.get(key);
  if (!p) {
    const { dict, seeds } = await deps.loadDictionary();
    p = make(dict, seeds);
    if (puzzleCache.size > 50) puzzleCache.clear();
    puzzleCache.set(key, p);
  }
  return p;
}

// ---- daily --------------------------------------------------------------------

export async function submitDaily(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  const date = checkDailyDate(body.date, deps.now());
  const puzzle = await puzzleFor(deps, `daily:${date}`, (d, s) => generateDaily(d, s, date));
  const entry = score(puzzle, wordsOf(body.words), name, deps.now());

  const key = `daily/${date}/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
  // Progress only moves forward; a stale device can't lower your score.
  if (!prev || entry.score > prev.score || entry.name !== prev.name) {
    await deps.kv.setJSON(key, !prev || entry.score >= prev.score ? entry : { ...prev, name });
  }
  await deps.kv.setJSON(`players/${playerId}`, { name });
  return { ok: true, score: entry.score, ...(await readBoard(deps.kv, `daily/${date}/`, playerId)) };
}

export async function getDaily(deps: Deps, date: string | null, playerId: string | null) {
  if (!isDateKey(date)) throw new ApiError(400, 'Bad date');
  return readBoard(deps.kv, `daily/${date}/`, playerId && PLAYER_ID.test(playerId) ? playerId : null);
}

// ---- blitz --------------------------------------------------------------------

interface BlitzGame {
  playerId: string;
  startedAt: number;
  finished: boolean;
}

export async function startBlitz(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const seed = deps.randomId();
  const game: BlitzGame = { playerId, startedAt: deps.now(), finished: false };
  await deps.kv.setJSON(`blitz-games/${seed}`, game);
  return { seed, seconds: BLITZ_SECONDS };
}

export async function finishBlitz(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  if (typeof body.seed !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.seed)) throw new ApiError(400, 'Bad game');
  const seed = body.seed;
  const game = (await deps.kv.get(`blitz-games/${seed}`, { type: 'json' })) as BlitzGame | null;
  if (!game || game.playerId !== playerId) throw new ApiError(404, 'Unknown game');
  if (game.finished) throw new ApiError(409, 'Game already submitted');
  if (deps.now() - game.startedAt > (BLITZ_SECONDS + BLITZ_GRACE_SECONDS) * 1000) throw new ApiError(410, 'Too late to submit');
  await deps.kv.setJSON(`blitz-games/${seed}`, { ...game, finished: true });

  const puzzle = await puzzleFor(deps, `blitz:${seed}`, (d, s) => generateBlitz(d, s, seed));
  const entry = score(puzzle, wordsOf(body.words), name, deps.now());
  const key = `blitz-best/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
  const best = !prev || entry.score > prev.score;
  if (best) await deps.kv.setJSON(key, entry);
  else if (prev.name !== name) await deps.kv.setJSON(key, { ...prev, name });
  await deps.kv.setJSON(`players/${playerId}`, { name });
  return { ok: true, score: entry.score, personalBest: best, ...(await readBoard(deps.kv, 'blitz-best/', playerId)) };
}

export async function getBlitz(deps: Deps, playerId: string | null) {
  return readBoard(deps.kv, 'blitz-best/', playerId && PLAYER_ID.test(playerId) ? playerId : null);
}

// ---- names --------------------------------------------------------------------

export async function saveName(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  await deps.kv.setJSON(`players/${playerId}`, { name });
  return { ok: true, name };
}
