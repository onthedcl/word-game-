// Leaderboard rules. Scores are never trusted from the client: the server looks
// up the puzzle's answer table and scores the submitted words itself.
import { rankFor, scorePath, TOP_RANK } from '../src/engine/scoring';
import { CENTER, isValidRoute } from '../src/engine/hexgrid';
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
  /** The words found (with traced routes), so progress can follow the player to another device. */
  found?: Submitted[];
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

/** A submitted word, with the route it was traced along when the client sent one. */
interface Submitted {
  word: string;
  route: number[] | null;
}

function wordsOf(value: unknown): Submitted[] {
  if (!Array.isArray(value) || value.length > 500) throw new ApiError(400, 'Bad word list');
  const out = new Map<string, Submitted>();
  for (const item of value) {
    if (typeof item === 'string') out.set(item.toLowerCase(), { word: item.toLowerCase(), route: null });
    else if (item && typeof item === 'object' && typeof item.w === 'string') {
      const route = Array.isArray(item.p) && item.p.length <= 19 && item.p.every((n: unknown) => Number.isInteger(n))
        ? (item.p as number[])
        : null;
      out.set(item.w.toLowerCase(), { word: item.w.toLowerCase(), route });
    }
  }
  return [...out.values()];
}

/** Points for one word: along its traced route if that route is genuine, else its best route. */
function wordPoints(table: AnswerTable, { word, route }: Submitted, best: number): number {
  if (!route || !table.board) return best;
  const board = table.board;
  const genuine =
    route.every((id) => id >= 0 && id < board.letters.length) &&
    isValidRoute(route) &&
    route.includes(CENTER) &&
    route.map((id) => board.letters[id]).join('') === word;
  // A bogus route is scored as the lowest the word could be worth: never an advantage.
  return genuine ? scorePath(route, board).score : 0;
}

function score(table: AnswerTable, submitted: Submitted[], name: string, now: number): Entry {
  let total = 0;
  let words = 0;
  let pangrams = 0;
  for (const s of submitted) {
    const hit = Object.hasOwn(table.words, s.word) ? table.words[s.word] : undefined;
    if (!hit) continue;
    total += wordPoints(table, s, hit[0]);
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
  const table = await tableFor(deps, `daily/${date}`);
  const submitted = wordsOf(body.words);
  const entry = score(table, submitted, name, deps.now());

  const key = `daily/${date}/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
  if (entry.words === Object.keys(table.words).length && (prev?.words ?? 0) < entry.words) {
    deps.notify?.({
      title: entry.rankName === TOP_RANK ? `${TOP_RANK}!` : 'Every word found!',
      message: `${name} found all ${entry.words} words today (${entry.score} pts)`,
      tags: ['crown'],
    });
  }
  // Progress only moves forward; a stale device can't lower your score.
  const found = mergeFound(prev?.found, submitted.filter((s) => Object.hasOwn(table.words, s.word)));
  if (!prev || entry.score > prev.score || entry.words > prev.words || entry.name !== prev.name || found.length > (prev.found?.length ?? 0)) {
    await deps.kv.setJSON(key, { ...(!prev || entry.score >= prev.score ? entry : { ...prev, name }), found });
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

// Names work like a login: each belongs to one player and is protected by a
// 4-digit PIN, so a player can pick up where they left off on another device.
interface NameOwner {
  playerId: string;
  pin: string | null;
  failed?: { count: number; since: number };
}

const nameKey = (name: string) => `names/${name.toLowerCase()}`;
const newPin = (deps: Deps) => String(Math.floor(deps.random() * 10000)).padStart(4, '0');
const PIN_TRIES = 5;
const PIN_LOCK_MS = 60 * 60 * 1000;

/** Who owns a name. Names picked before PINs existed are found by scanning players. */
async function ownerOf(deps: Deps, name: string): Promise<NameOwner | null> {
  const owner = (await deps.kv.get(nameKey(name), { type: 'json' })) as NameOwner | null;
  if (owner) return owner;
  const { blobs } = await deps.kv.list({ prefix: 'players/' });
  for (const { key } of blobs) {
    const p = (await deps.kv.get(key, { type: 'json' })) as { name?: string } | null;
    if (p?.name?.toLowerCase() === name.toLowerCase()) return { playerId: key.slice('players/'.length), pin: null };
  }
  return null;
}

export async function saveName(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = nameOf(body.name);
  const owner = await ownerOf(deps, name);
  if (owner && owner.playerId !== playerId) throw new ApiError(409, 'That name is taken');
  const prev = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  const pin = owner?.pin ?? newPin(deps);
  await deps.kv.setJSON(nameKey(name), { playerId, pin } satisfies NameOwner);
  if (prev && prev.name.toLowerCase() !== name.toLowerCase()) await deps.kv.setJSON(nameKey(prev.name), null);
  await deps.kv.setJSON(`players/${playerId}`, { name });
  if (!prev) deps.notify?.({ title: 'Joined the leaderboard', message: `${name} picked their leaderboard name`, tags: ['trophy'] });
  else if (prev.name !== name) deps.notify?.({ title: 'Name change', message: `${prev.name} is now ${name}`, tags: ['pencil2'] });
  return { ok: true, name, pin };
}

/** Continue as an existing player on this device: their name plus PIN. */
export async function claimName(deps: Deps, body: Record<string, unknown>) {
  const name = nameOf(body.name);
  const owner = await ownerOf(deps, name);
  if (!owner) throw new ApiError(404, 'No player has that name yet');
  const now = deps.now();
  const failed = owner.failed && now - owner.failed.since < PIN_LOCK_MS ? owner.failed : { count: 0, since: now };
  if (failed.count >= PIN_TRIES) throw new ApiError(429, 'Too many wrong PINs. Try again in an hour');
  // Names from before PINs existed can be claimed once without one; they get a PIN now.
  if (owner.pin && body.pin !== owner.pin) {
    await deps.kv.setJSON(nameKey(name), { ...owner, failed: { count: failed.count + 1, since: failed.since } });
    throw new ApiError(403, 'Wrong PIN');
  }
  const pin = owner.pin ?? newPin(deps);
  await deps.kv.setJSON(nameKey(name), { playerId: owner.playerId, pin } satisfies NameOwner);
  const player = (await deps.kv.get(`players/${owner.playerId}`, { type: 'json' })) as { name: string } | null;
  return { ok: true, playerId: owner.playerId, name: player?.name ?? name, pin };
}

/** The player's own details (only their device knows the player id). */
export async function me(deps: Deps, playerId: string | null) {
  const id = playerIdOf(playerId);
  const player = (await deps.kv.get(`players/${id}`, { type: 'json' })) as { name: string } | null;
  if (!player) return { name: null, pin: null };
  const owner = (await deps.kv.get(nameKey(player.name), { type: 'json' })) as NameOwner | null;
  return { name: player.name, pin: owner?.playerId === id ? owner.pin : null };
}

/** Words this player has found on a daily board (to restore progress on another device). */
export async function progressOf(deps: Deps, date: string | null, playerId: string | null) {
  const id = playerIdOf(playerId);
  const { boardId } = boardIdOf(date);
  const entry = (await deps.kv.get(`daily/${boardId}/${id}`, { type: 'json' })) as Entry | null;
  return { found: (entry?.found ?? []).map((s) => (s.route ? { w: s.word, p: s.route } : s.word)) };
}

function mergeFound(prev: Submitted[] | undefined, next: Submitted[]): Submitted[] {
  const out = new Map((prev ?? []).map((s) => [s.word, s]));
  for (const s of next) if (!out.has(s.word)) out.set(s.word, s);
  return [...out.values()];
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
  // Without a notification channel there's nothing to do, and marking the player
  // as seen would swallow today's ping once notifications are switched on.
  if (!deps.notify) return { ok: true };
  const mode = body.mode === 'blitz' ? 'Blitz' : 'the daily puzzle';
  // "Today" is the player's own calendar day (sent by the game), within a day of UTC.
  const utc = new Date(deps.now()).toISOString().slice(0, 10);
  const local = typeof body.date === 'string' && isDateKey(body.date) ? body.date : null;
  const day = local && local >= shiftDateKey(utc, -1) && local <= shiftDateKey(utc, 1) ? local : utc;
  const key = `seen-v2/${day}/${playerId}`;
  if (await deps.kv.get(key, { type: 'json' })) return { ok: true };
  await deps.kv.setJSON(key, { at: deps.now() });

  let player = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  // The game sends the nickname saved on the device; remember it if the server hadn't heard it yet.
  const sentName = cleanName(body.name);
  const sentOwner = sentName ? await deps.kv.get(nameKey(sentName), { type: 'json' }) as NameOwner | null : null;
  if (sentName && player?.name !== sentName && (!sentOwner || sentOwner.playerId === playerId)) {
    player = { name: sentName };
    await deps.kv.setJSON(`players/${playerId}`, player);
  }

  // Count the different days this player has shown up, so regulars stand out.
  const history = ((await deps.kv.get(`player-days/${playerId}`, { type: 'json' })) as { days: number } | null) ??
    ((await deps.kv.get(`first-seen/${playerId}`, { type: 'json' })) ? { days: 1 } : { days: 0 });
  const days = history.days + 1;
  await deps.kv.setJSON(`player-days/${playerId}`, { days, last: day });

  const today = (await deps.kv.list({ prefix: `seen-v2/${day}/` })).blobs.length;
  const where = describePlace(place);
  const from = where ? ` from ${where}` : '';
  const count = `${today} ${today === 1 ? 'player' : 'players'} today`;
  const name = player?.name;
  const message =
    days === 1
      ? `${name ?? 'A new player'} opened ${mode}${from} for the first time · ${count}`
      : `${name ?? 'A returning player (no name)'} is back for day ${days} · opened ${mode}${from} · ${count}`;
  deps.notify?.({ title: days === 1 ? 'New player!' : 'Someone is playing', message, tags: [days === 1 ? 'tada' : 'wave'] });
  return { ok: true };
}
