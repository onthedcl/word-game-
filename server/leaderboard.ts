// Leaderboard rules. Scores are never trusted from the client: the server looks
// up the puzzle's answer table and scores the submitted words itself.
import { rankFor } from '../src/engine/scoring';
import { EPOCH, isDateKey, shiftDateKey } from '../src/engine/dates';
import { cleanName } from './names';
import type { AnswerTable } from './tables';
import { parseBoardId } from '../src/engine/rerolls';

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
  /** Answer table for `daily/<date>` or `blitz/<seed>`, or null if there isn't one. */
  answers(key: string): Promise<AnswerTable | null>;
  /** Seeds of the pre-built Blitz boards the server hands out. */
  blitzSeeds(): Promise<string[]>;
  now(): number;
  randomId(): string;
  random(): number;
  /** Send the owner a notification (fire and forget). */
  notify?(n: { title: string; message: string; tags?: string[] }): void;
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

function score(table: AnswerTable, submitted: string[], name: string, now: number): Entry {
  let total = 0;
  let words = 0;
  let pangrams = 0;
  for (const w of submitted) {
    const hit = Object.hasOwn(table.words, w) ? table.words[w] : undefined;
    if (!hit) continue;
    total += hit[0];
    words += 1;
    pangrams += hit[1];
  }
  return { name, score: total, words, pangrams, rankName: rankFor(total, table.maxScore).name, updatedAt: now };
}

async function tableFor(deps: Deps, key: string): Promise<AnswerTable> {
  const table = await deps.answers(key);
  if (!table) throw new ApiError(404, 'Unknown puzzle');
  return table;
}

/** A daily board id ("2026-09-26" or "2026-09-26~v1" after a reroll). */
function boardIdOf(value: unknown): { boardId: string; dateKey: string } {
  const parsed = typeof value === 'string' ? parseBoardId(value) : null;
  if (!parsed || !isDateKey(parsed.dateKey) || parsed.dateKey < EPOCH) throw new ApiError(400, 'Bad date');
  return { boardId: value as string, dateKey: parsed.dateKey };
}

/** Today's date could be yesterday or tomorrow somewhere, so allow one day either side of UTC. */
function checkDailyDate(value: unknown, now: number): string {
  const { boardId, dateKey } = boardIdOf(value);
  const today = new Date(now).toISOString().slice(0, 10);
  if (dateKey < shiftDateKey(today, -1) || dateKey > shiftDateKey(today, 1)) throw new ApiError(400, 'That puzzle is closed');
  return boardId;
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

// ---- daily --------------------------------------------------------------------

export async function submitDaily(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  const date = checkDailyDate(body.date, deps.now());
  const entry = score(await tableFor(deps, `daily/${date}`), wordsOf(body.words), name, deps.now());

  const key = `daily/${date}/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
  if (entry.rankName === 'Hexmaster' && prev?.rankName !== 'Hexmaster') {
    deps.notify?.({ title: 'Every word found!', message: `${name} found all ${entry.words} words today (${entry.score} pts)`, tags: ['crown'] });
  }
  // Progress only moves forward; a stale device can't lower your score.
  if (!prev || entry.score > prev.score || entry.name !== prev.name) {
    await deps.kv.setJSON(key, !prev || entry.score >= prev.score ? entry : { ...prev, name });
  }
  await deps.kv.setJSON(`players/${playerId}`, { name });
  return { ok: true, score: entry.score, ...(await readBoard(deps.kv, `daily/${date}/`, playerId)) };
}

export async function getDaily(deps: Deps, date: string | null, playerId: string | null) {
  boardIdOf(date);
  return readBoard(deps.kv, `daily/${date}/`, playerId && PLAYER_ID.test(playerId) ? playerId : null);
}

// ---- blitz --------------------------------------------------------------------

interface BlitzGame {
  playerId: string;
  seed: string;
  startedAt: number;
  finished: boolean;
}

export async function startBlitz(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const pool = await deps.blitzSeeds();
  if (!pool.length) throw new ApiError(503, 'No Blitz boards available');
  const seed = pool[Math.floor(deps.random() * pool.length)];
  const game = deps.randomId();
  await deps.kv.setJSON(`blitz-games/${game}`, { playerId, seed, startedAt: deps.now(), finished: false } satisfies BlitzGame);
  return { game, seed, seconds: BLITZ_SECONDS };
}

export async function finishBlitz(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  if (typeof body.game !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(body.game)) throw new ApiError(400, 'Bad game');
  const id = body.game;
  const game = (await deps.kv.get(`blitz-games/${id}`, { type: 'json' })) as BlitzGame | null;
  if (!game || game.playerId !== playerId) throw new ApiError(404, 'Unknown game');
  if (game.finished) throw new ApiError(409, 'Game already submitted');
  if (deps.now() - game.startedAt > (BLITZ_SECONDS + BLITZ_GRACE_SECONDS) * 1000) throw new ApiError(410, 'Too late to submit');
  await deps.kv.setJSON(`blitz-games/${id}`, { ...game, finished: true });

  const entry = score(await tableFor(deps, `blitz/${game.seed}`), wordsOf(body.words), name, deps.now());
  const key = `blitz-best/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
  const best = !prev || entry.score > prev.score;
  if (best) await deps.kv.setJSON(key, entry);
  else if (prev.name !== name) await deps.kv.setJSON(key, { ...prev, name });
  await deps.kv.setJSON(`players/${playerId}`, { name });
  const board = await readBoard(deps.kv, 'blitz-best/', playerId);
  deps.notify?.({
    title: 'Blitz finished',
    message: `${name} scored ${entry.score} (${entry.words} words)${best ? ` · personal best, #${board.you?.position} of ${board.total}` : ''}`,
    tags: ['zap'],
  });
  return { ok: true, score: entry.score, personalBest: best, ...board };
}

export async function getBlitz(deps: Deps, playerId: string | null) {
  return readBoard(deps.kv, 'blitz-best/', playerId && PLAYER_ID.test(playerId) ? playerId : null);
}

// ---- names --------------------------------------------------------------------

export async function saveName(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  const prev = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  await deps.kv.setJSON(`players/${playerId}`, { name });
  if (!prev) deps.notify?.({ title: 'New player', message: `${name} joined the leaderboard`, tags: ['tada'] });
  else if (prev.name !== name) deps.notify?.({ title: 'Name change', message: `${prev.name} is now ${name}`, tags: ['pencil2'] });
  return { ok: true, name };
}

// ---- presence -----------------------------------------------------------------

/** Approximate location of a request, as worked out by the hosting platform (never the IP). */
export interface Place {
  city?: string;
  region?: string;
  country?: string;
}

/** "🇺🇸 Brooklyn, NY", or null when nothing is known. */
export function describePlace(place: Place | null | undefined): string | null {
  if (!place) return null;
  const country = place.country && /^[A-Z]{2}$/.test(place.country) ? place.country : undefined;
  const flag = country ? String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
  const parts = [place.city, place.region && place.region !== place.city ? place.region : undefined].filter(Boolean);
  const text = parts.length ? parts.join(', ') : country ?? '';
  return text ? `${flag} ${text}`.trim() : null;
}

/** Called when someone opens the game. Notifies the owner once per player per day. */
export async function hello(deps: Deps, body: Record<string, unknown>, place?: Place | null) {
  const playerId = playerIdOf(body.playerId);
  const mode = body.mode === 'blitz' ? 'Blitz' : 'the daily puzzle';
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  const key = `seen/${day}/${playerId}`;
  if (await deps.kv.get(key, { type: 'json' })) return { ok: true };
  await deps.kv.setJSON(key, { at: deps.now() });
  const player = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  const everSeen = await deps.kv.get(`first-seen/${playerId}`, { type: 'json' });
  if (!everSeen) await deps.kv.setJSON(`first-seen/${playerId}`, { at: deps.now() });
  const today = (await deps.kv.list({ prefix: `seen/${day}/` })).blobs.length;
  const who = player?.name ?? (everSeen ? 'A returning player (no name)' : 'A new player');
  const where = describePlace(place);
  deps.notify?.({
    title: 'Someone is playing',
    message: `${who} opened ${mode}${where ? ` from ${where}` : ''} · ${today} ${today === 1 ? 'player' : 'players'} today`,
    tags: ['wave'],
  });
  return { ok: true };
}
