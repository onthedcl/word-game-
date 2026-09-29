// Leaderboard rules. Scores are never trusted from the client: the server looks
// up the puzzle's answer table and scores the submitted words itself.
import { rankFor, scorePath, TOP_RANK } from '../src/engine/scoring';
import { CENTER, isValidRoute } from '../src/engine/hexgrid';
import { boardLocksAt, boardOpensAt, EPOCH, isDateKey, shiftDateKey } from '../src/engine/dates';
import { cleanName } from './names';
import type { AnswerTable } from './tables';
import type { Notification } from './digest';
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
  notify?(n: Notification): void;
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

/** How many words a board counts toward "every word" (bonus words don't count). */
const countedWords = (table: AnswerTable) => Object.values(table.words).filter((w) => !w[2]).length;

function score(table: AnswerTable, submitted: Submitted[], name: string, now: number): Entry & { allFound: boolean } {
  let total = 0;
  let words = 0;
  let counted = 0;
  let pangrams = 0;
  for (const s of submitted) {
    const hit = Object.hasOwn(table.words, s.word) ? table.words[s.word] : undefined;
    if (!hit) continue;
    total += wordPoints(table, s, hit[0]);
    words += 1;
    if (!hit[2]) counted += 1;
    pangrams += hit[1];
  }
  const allFound = counted === countedWords(table);
  return { name, score: total, words, pangrams, rankName: rankFor(total, table.maxScore, allFound).name, updatedAt: now, allFound };
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

/** A board takes scores from when its date starts anywhere until midnight Pacific at the end of that date. */
function checkDailyDate(value: unknown, now: number): string {
  const { boardId, dateKey } = boardIdOf(value);
  if (now < boardOpensAt(dateKey) || now >= boardLocksAt(dateKey)) throw new ApiError(400, 'That puzzle is closed');
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

/**
 * The name a player's score is posted under. A name someone else already owns is
 * refused (409), so two players can't show up under the same name; a name nobody
 * owns yet becomes this player's.
 */
async function postingName(deps: Deps, playerId: string, raw: unknown): Promise<string> {
  const name = nameOf(raw);
  const owner = await ownerOf(deps, name);
  if (owner && owner.playerId !== playerId) throw new ApiError(409, 'That name is taken');
  if (!owner || !owner.pin) await deps.kv.setJSON(nameKey(name), { playerId, pin: owner?.pin ?? newPin(deps) } satisfies NameOwner);
  return name;
}

// ---- streaks ------------------------------------------------------------------

export interface Streak {
  /** Consecutive days with at least one word found, ending on `last`. */
  count: number;
  best: number;
  last: string;
}

export const streakOf = async (deps: Deps, playerId: string) =>
  ((await deps.kv.get(`streak/${playerId}`, { type: 'json' })) as Streak | null) ?? null;

/** Count a day toward the player's streak (idempotent within a day). */
async function bumpStreak(deps: Deps, playerId: string, dateKey: string): Promise<Streak> {
  const key = `streak/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Streak | null;
  if (prev && prev.last >= dateKey) return prev;
  const count = prev && prev.last === shiftDateKey(dateKey, -1) ? prev.count + 1 : 1;
  const next = { count, best: Math.max(count, prev?.best ?? 0), last: dateKey };
  await deps.kv.setJSON(key, next);
  return next;
}

export async function submitDaily(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const name = await postingName(deps, playerId, body.name);
  const date = checkDailyDate(body.date, deps.now());
  const table = await tableFor(deps, `daily/${date}`);
  const submitted = wordsOf(body.words);
  const entry = score(table, submitted, name, deps.now());

  const key = `daily/${date}/${playerId}`;
  const prev = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
  if (entry.allFound && !(prev as (Entry & { allFound?: boolean }) | null)?.allFound) {
    const all = countedWords(table);
    deps.notify?.({
      title: entry.rankName === TOP_RANK ? `${TOP_RANK}!` : 'Every word found!',
      message: `${name} found all ${all} words today (${entry.score} pts)`,
      tags: ['crown'],
      event: { kind: 'allwords', who: name, words: all, score: entry.score },
    });
  }
  // Progress only moves forward; a stale device can't lower your score.
  const found = mergeFound(prev?.found, submitted.filter((s) => Object.hasOwn(table.words, s.word)));
  if (!prev || entry.score > prev.score || entry.words > prev.words || entry.name !== prev.name || found.length > (prev.found?.length ?? 0)) {
    await deps.kv.setJSON(key, { ...(!prev || entry.score >= prev.score ? entry : { ...prev, name }), found });
  }
  await deps.kv.setJSON(`players/${playerId}`, { name });
  const streak = entry.words > 0 ? await bumpStreak(deps, playerId, boardIdOf(date).dateKey) : await streakOf(deps, playerId);
  return { ok: true, score: entry.score, streak, ...(await readBoard(deps.kv, `daily/${date}/`, playerId)) };
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
  const name = await postingName(deps, playerId, body.name);
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
    event: { kind: 'blitz', who: name, score: entry.score, best },
  });
  return { ok: true, score: entry.score, personalBest: best, ...board };
}

export async function getBlitz(deps: Deps, playerId: string | null) {
  return readBoard(deps.kv, 'blitz-best/', playerId && PLAYER_ID.test(playerId) ? playerId : null);
}

// ---- names --------------------------------------------------------------------

// Names work like a login: each belongs to one player, and typing it on another
// device picks up where they left off. (The PIN is still stored but not checked.)
interface NameOwner {
  playerId: string;
  pin: string | null;
}

const nameKey = (name: string) => `names/${name.toLowerCase()}`;
const newPin = (deps: Deps) => String(Math.floor(deps.random() * 10000)).padStart(4, '0');

/**
 * Who owns a name. Names picked before PINs existed are found by scanning players;
 * back then two players could share a name, so the one with the most points wins.
 */
async function ownerOf(deps: Deps, name: string): Promise<NameOwner | null> {
  const owner = (await deps.kv.get(nameKey(name), { type: 'json' })) as NameOwner | null;
  if (owner) return owner;
  const matches: string[] = [];
  for (const { key } of (await deps.kv.list({ prefix: 'players/' })).blobs) {
    const p = (await deps.kv.get(key, { type: 'json' })) as { name?: string } | null;
    if (p?.name?.toLowerCase() === name.toLowerCase()) matches.push(key.slice('players/'.length));
  }
  if (matches.length <= 1) return matches.length ? { playerId: matches[0], pin: null } : null;
  const points = new Map(matches.map((id) => [id, 0]));
  for (const { key } of (await deps.kv.list({ prefix: 'daily/' })).blobs) {
    const id = key.slice(key.lastIndexOf('/') + 1);
    if (!points.has(id)) continue;
    const entry = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
    points.set(id, points.get(id)! + (entry?.score ?? 0));
  }
  const best = matches.reduce((a, b) => (points.get(b)! > points.get(a)! ? b : a));
  return { playerId: best, pin: null };
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
  if (!prev) deps.notify?.({ title: 'Joined the leaderboard', message: `${name} picked their leaderboard name`, tags: ['trophy'], event: { kind: 'joined', who: name } });
  else if (prev.name !== name) {
    deps.notify?.({ title: 'Name change', message: `${prev.name} is now ${name}`, tags: ['pencil2'], event: { kind: 'renamed', from: prev.name, who: name } });
  }
  return { ok: true, name, pin };
}

/**
 * Continue as an existing player on this device: typing their name is enough.
 * (PINs turned out to lock real players out, so they're no longer checked.)
 */
export async function claimName(deps: Deps, body: Record<string, unknown>) {
  const name = nameOf(body.name);
  const owner = await ownerOf(deps, name);
  if (!owner) throw new ApiError(404, 'No player has that name yet');
  const pin = owner.pin ?? newPin(deps);
  await deps.kv.setJSON(nameKey(name), { playerId: owner.playerId, pin } satisfies NameOwner);
  const player = (await deps.kv.get(`players/${owner.playerId}`, { type: 'json' })) as { name: string } | null;
  deps.notify?.({ title: 'Back on another device', message: `${player?.name ?? name} picked up their game on another device`, tags: ['iphone'], event: { kind: 'device', who: player?.name ?? name } });
  return { ok: true, playerId: owner.playerId, name: player?.name ?? name, pin };
}

/** The player's own details (only their device knows the player id). */
export async function me(deps: Deps, playerId: string | null) {
  const id = playerIdOf(playerId);
  const player = (await deps.kv.get(`players/${id}`, { type: 'json' })) as { name: string } | null;
  if (!player) return { name: null, pin: null, streak: await streakOf(deps, id) };
  const owner = (await deps.kv.get(nameKey(player.name), { type: 'json' })) as NameOwner | null;
  return { name: player.name, pin: owner?.playerId === id ? owner.pin : null, streak: await streakOf(deps, id) };
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
  deps.notify?.({
    title: days === 1 ? 'New player!' : 'Someone is playing',
    message,
    tags: [days === 1 ? 'tada' : 'wave'],
    event: days === 1 ? { kind: 'new', who: name, place: where ?? undefined, today } : { kind: 'back', who: name, days, place: where ?? undefined, today },
  });
  return { ok: true };
}

// ---- privacy & moderation ------------------------------------------------------

/** Delete everything the server keeps about a player: name, scores, found words, visit history. */
export async function deletePlayer(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const player = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  if (player) {
    const owner = (await deps.kv.get(nameKey(player.name), { type: 'json' })) as NameOwner | null;
    if (owner?.playerId === playerId) await deps.kv.setJSON(nameKey(player.name), null);
  }
  const mine = (prefix: string) => deps.kv.list({ prefix }).then(({ blobs }) => blobs.filter((b) => b.key.endsWith(`/${playerId}`)));
  const keys = [
    ...(await mine('daily/')), ...(await mine('seen-v2/')), ...(await mine('seen/')),
  ].map((b) => b.key);
  keys.push(`players/${playerId}`, `blitz-best/${playerId}`, `player-days/${playerId}`, `first-seen/${playerId}`, `streak/${playerId}`);
  for (const key of keys) await deps.kv.setJSON(key, null);
  return { ok: true };
}

/** A player flags a leaderboard name as offensive; the owner is told right away. */
export async function reportName(deps: Deps, body: Record<string, unknown>) {
  const reporter = playerIdOf(body.playerId);
  const name = typeof body.name === 'string' ? body.name.slice(0, 32) : '';
  if (!name) throw new ApiError(400, 'Bad name');
  const key = `reports/${name.toLowerCase()}/${reporter}`;
  if (!(await deps.kv.get(key, { type: 'json' }))) {
    await deps.kv.setJSON(key, { at: deps.now() });
    const count = (await deps.kv.list({ prefix: `reports/${name.toLowerCase()}/` })).blobs.length;
    deps.notify?.({
      title: 'Name reported',
      message: `“${name}” was reported as offensive (${count} ${count === 1 ? 'report' : 'reports'}). Rename or remove it with the Moderate workflow.`,
      tags: ['warning'],
      urgent: true,
    });
  }
  return { ok: true };
}

/**
 * Owner-only: rename a player (to "Player 1234" if no new name is given) wherever
 * their name shows, and free the old name. Scores are kept.
 */
export async function moderateName(deps: Deps, body: Record<string, unknown>) {
  const name = nameOf(body.name);
  const owner = await ownerOf(deps, name);
  if (!owner) throw new ApiError(404, 'No player has that name');
  const to = body.to ? nameOf(body.to) : `Player ${String(Math.floor(deps.random() * 9000) + 1000)}`;
  const taken = await ownerOf(deps, to);
  if (taken && taken.playerId !== owner.playerId) throw new ApiError(409, 'That new name is taken');
  const id = owner.playerId;
  for (const { key } of (await deps.kv.list({ prefix: 'daily/' })).blobs.filter((b) => b.key.endsWith(`/${id}`))) {
    const entry = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
    if (entry) await deps.kv.setJSON(key, { ...entry, name: to });
  }
  const blitz = (await deps.kv.get(`blitz-best/${id}`, { type: 'json' })) as Entry | null;
  if (blitz) await deps.kv.setJSON(`blitz-best/${id}`, { ...blitz, name: to });
  await deps.kv.setJSON(`players/${id}`, { name: to });
  await deps.kv.setJSON(nameKey(name), null);
  await deps.kv.setJSON(nameKey(to), { playerId: id, pin: owner.pin ?? newPin(deps) } satisfies NameOwner);
  return { ok: true, name: to };
}
