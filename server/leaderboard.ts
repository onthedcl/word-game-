// Leaderboard rules. Scores are never trusted from the client: the server looks
// up the puzzle's answer table and scores the submitted words itself.
import { rankFor, scorePath, TOP_RANK } from '../src/engine/scoring';
import { CENTER, isValidRoute } from '../src/engine/hexgrid';
import { boardLocksAt, boardOpensAt, EPOCH, isDateKey, shiftDateKey } from '../src/engine/dates';
import { cleanName, maskText } from './names';
import type { AnswerTable } from './tables';
import type { Notification } from './digest';
import { leaveAllLeagues, movePlayerInLeagues, notePasses, roomsSummary } from './leagues';
import { dailyBoardId, parseBoardId } from '../src/engine/rerolls';

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
  /** Tries that weren't accepted (not a word, too short, already found), as counted by the game. */
  misses?: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const PLAYER_ID = /^[A-Za-z0-9-]{16,64}$/;

export function playerIdOf(value: unknown): string {
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
  /** When the server first heard of this word (for the owner's play check). */
  at?: number;
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

/** A leaderboard from the entries under `prefix`, optionally only for some players (a league). */
export async function readBoard(kv: KV, prefix: string, playerId: string | null, only?: ReadonlySet<string>) {
  const blocked = await blockedPlayers(kv);
  // Blocked players still see themselves; nobody else sees them.
  const shown = (id: string) => (!only || only.has(id)) && (!blocked.has(id) || id === playerId);
  const blobs = (await kv.list({ prefix })).blobs.filter((b) => shown(b.key.slice(prefix.length)));
  const rows = (
    await Promise.all(blobs.map(async ({ key }) => ({ key, entry: (await kv.get(key, { type: 'json' })) as Entry | null })))
  ).filter((r): r is { key: string; entry: Entry } => !!r.entry);
  rows.sort((a, b) => b.entry.score - a.entry.score || a.entry.updatedAt - b.entry.updatedAt);
  const all = rows.map((r, i) => {
    const { name, score, words, pangrams, rankName } = r.entry;
    return { position: i + 1, name, score, words, pangrams, rankName, you: !!playerId && r.key === prefix + playerId };
  });
  return { total: rows.length, top: all.slice(0, TOP_N), you: all.find((r) => r.you) ?? null };
}

// ---- blocking (owner only) -----------------------------------------------------

const BLOCKED_KEY = 'blocked-players';

/** Players the owner has blocked: hidden from everyone else's leaderboards and room chat. */
export async function blockedPlayers(kv: KV): Promise<Set<string>> {
  return new Set(((await kv.get(BLOCKED_KEY, { type: 'json' })) as string[] | null) ?? []);
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
  /** 2 once counted from the player's whole history (streaks started out counting from launch day). */
  v?: number;
}

const STREAK_VERSION = 2;

/** Work a streak out from every daily board the player has found a word on. */
async function streakFromHistory(deps: Deps, playerId: string): Promise<Streak | null> {
  const days = new Set<string>();
  for (const { key } of (await deps.kv.list({ prefix: 'daily/' })).blobs) {
    if (!key.endsWith(`/${playerId}`)) continue;
    const day = parseBoardId(key.split('/')[1])?.dateKey;
    const entry = day ? ((await deps.kv.get(key, { type: 'json' })) as Entry | null) : null;
    if (day && entry && entry.words > 0) days.add(day);
  }
  if (!days.size) return null;
  let count = 0;
  let best = 0;
  let prev = '';
  for (const day of [...days].sort()) {
    count = prev && shiftDateKey(prev, 1) === day ? count + 1 : 1;
    best = Math.max(best, count);
    prev = day;
  }
  return { count, best, last: prev, v: STREAK_VERSION };
}

/** The player's streak (last played day included); older records are recounted from history once. */
export async function streakOf(deps: Deps, playerId: string): Promise<Streak | null> {
  const key = `streak/${playerId}`;
  const stored = (await deps.kv.get(key, { type: 'json' })) as Streak | null;
  if (stored?.v === STREAK_VERSION) return stored;
  const counted = await streakFromHistory(deps, playerId);
  if (!counted) return stored;
  const streak = { ...counted, best: Math.max(counted.best, stored?.best ?? 0) };
  await deps.kv.setJSON(key, streak);
  return streak;
}

/** Count a day toward the player's streak (idempotent within a day). */
async function bumpStreak(deps: Deps, playerId: string, dateKey: string): Promise<Streak> {
  const key = `streak/${playerId}`;
  const prev = await streakOf(deps, playerId);
  if (prev && prev.last >= dateKey) return prev;
  const count = prev && prev.last === shiftDateKey(dateKey, -1) ? prev.count + 1 : 1;
  const next = { count, best: Math.max(count, prev?.best ?? 0), last: dateKey, v: STREAK_VERSION };
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
  const found = mergeFound(prev?.found, submitted.filter((s) => Object.hasOwn(table.words, s.word)), deps.now());
  const sentMisses = Number.isInteger(body.misses) && (body.misses as number) >= 0 ? Math.min(body.misses as number, 100000) : 0;
  const misses = Math.max(prev?.misses ?? 0, sentMisses);
  if (
    !prev || entry.score > prev.score || entry.words > prev.words || entry.name !== prev.name ||
    found.length > (prev.found?.length ?? 0) || misses > (prev.misses ?? 0)
  ) {
    await deps.kv.setJSON(key, { ...(!prev || entry.score >= prev.score ? entry : { ...prev, name }), found, misses });
  }
  await deps.kv.setJSON(`players/${playerId}`, { name });
  await notePasses(deps, playerId, name, date, prev?.score ?? 0, Math.max(entry.score, prev?.score ?? 0));
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

// Names work like a login: each belongs to one player, and their name plus 4-digit code
// picks up where they left off on another device.
interface NameOwner {
  playerId: string;
  pin: string | null;
  /** The player picked this code themselves. Until then they're asked to, once they open the game. */
  chosen?: boolean;
  /** The owner gave this code out (Moderate workflow), so it works even though the player didn't pick it. */
  issued?: boolean;
}

/**
 * Only codes the player chose (or the owner handed out) let someone continue as a name.
 * The codes made up automatically before players could choose were reset this way.
 */
const codeWorks = (owner: NameOwner) => !!owner.pin && (!!owner.chosen || !!owner.issued);

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
  // A new name keeps the player's code (and whether they chose it).
  const old = prev ? ((await deps.kv.get(nameKey(prev.name), { type: 'json' })) as NameOwner | null) : null;
  const record: NameOwner =
    owner?.pin ? { ...owner, playerId } : old?.playerId === playerId && old.pin ? { ...old } : { playerId, pin: newPin(deps) };
  const pin = record.pin;
  await deps.kv.setJSON(nameKey(name), record);
  if (prev && prev.name.toLowerCase() !== name.toLowerCase()) await deps.kv.setJSON(nameKey(prev.name), null);
  await deps.kv.setJSON(`players/${playerId}`, { name });
  if (!prev) deps.notify?.({ title: 'Joined the leaderboard', message: `${name} picked their leaderboard name`, tags: ['trophy'], event: { kind: 'joined', who: name } });
  else if (prev.name !== name) {
    deps.notify?.({ title: 'Name change', message: `${prev.name} is now ${name}`, tags: ['pencil2'], event: { kind: 'renamed', from: prev.name, who: name } });
  }
  return { ok: true, name, pin };
}

/** Wrong codes allowed per name before claiming is paused for an hour. */
const CLAIM_TRIES = 5;
const CLAIM_PAUSE_MS = 60 * 60 * 1000;

/**
 * Continue as an existing player on this device. Needs the name's 4-digit code,
 * which the player sees on their own device (Leaderboard), so nobody else can
 * take over a name just by typing it.
 */
export async function claimName(deps: Deps, body: Record<string, unknown>) {
  const name = nameOf(body.name);
  const owner = await ownerOf(deps, name);
  if (!owner) throw new ApiError(404, 'No player has that name yet');
  const triesKey = `claim-tries/${name.toLowerCase()}`;
  const tries = (await deps.kv.get(triesKey, { type: 'json' })) as { count: number; since: number } | null;
  const fresh = tries && deps.now() - tries.since < CLAIM_PAUSE_MS ? tries : null;
  if (fresh && fresh.count >= CLAIM_TRIES) throw new ApiError(429, 'Too many tries. Please wait an hour and try again.');
  if (!codeWorks(owner)) {
    throw new ApiError(403, `“${name}” hasn’t set up a code yet. Open the game where you usually play to choose one.`);
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (code !== owner.pin) {
    const count = (fresh?.count ?? 0) + 1;
    await deps.kv.setJSON(triesKey, { count, since: fresh?.since ?? deps.now() });
    if (count === CLAIM_TRIES) {
      deps.notify?.({ title: 'Wrong codes', message: `Someone entered the wrong code for ${name} ${count} times`, tags: ['lock'], urgent: true });
    }
    throw new ApiError(403, 'That code doesn’t match');
  }
  if (tries) await deps.kv.setJSON(triesKey, null);
  const player = (await deps.kv.get(`players/${owner.playerId}`, { type: 'json' })) as { name: string } | null;
  deps.notify?.({ title: 'Back on another device', message: `${player?.name ?? name} picked up their game on another device`, tags: ['iphone'], event: { kind: 'device', who: player?.name ?? name } });
  return { ok: true, playerId: owner.playerId, name: player?.name ?? name, pin: owner.pin };
}

/** Too easy to guess: all one digit, or a straight run like 1234 / 9876. */
function guessable(code: string): boolean {
  const d = [...code].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/** A player picks their own 4-digit code (only their device knows their player id). */
export async function setCode(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{4}$/.test(code)) throw new ApiError(400, 'Your code needs to be 4 digits');
  if (guessable(code)) throw new ApiError(400, 'That one’s too easy to guess. Try another');
  const player = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  if (!player) throw new ApiError(403, 'Pick a leaderboard name first');
  const owner = (await deps.kv.get(nameKey(player.name), { type: 'json' })) as NameOwner | null;
  if (owner && owner.playerId !== playerId) throw new ApiError(403, 'That name belongs to another player');
  await deps.kv.setJSON(nameKey(player.name), { playerId, pin: code, chosen: true } satisfies NameOwner);
  return { ok: true, pin: code };
}

/** A player can't find their code: the owner is told right away and can help with the Moderate workflow. */
export async function lostCode(deps: Deps, body: Record<string, unknown>) {
  const name = nameOf(body.name);
  // Optional words from the player so the owner can tell it's them (masked like chat, never stored).
  const note = typeof body.note === 'string' ? maskText(body.note.replace(/\s+/g, ' ').trim().slice(0, 140)) : '';
  if (!(await ownerOf(deps, name))) throw new ApiError(404, 'No player has that name yet');
  const key = `lost-code/${name.toLowerCase()}/${new Date(deps.now()).toISOString().slice(0, 10)}`;
  // Up to three pings a day per name (so a note added later still arrives), never a flood.
  const sent = ((await deps.kv.get(key, { type: 'json' })) as { count: number } | null)?.count ?? 0;
  if (sent < 3) {
    await deps.kv.setJSON(key, { at: deps.now(), count: sent + 1 });
    deps.notify?.({
      title: 'Lost code',
      message: `Someone playing as “${name}” is locked out and can’t find their code.${note ? ` They say: “${note}”.` : ''} If it’s really them, run Moderate → “send code”.`,
      tags: ['key'],
      urgent: true,
    });
  }
  return { ok: true };
}

/**
 * Every named player needs a code to move to another device; names from before codes
 * existed get one here. Null if someone else owns the name.
 */
async function ensureCode(deps: Deps, playerId: string, name: string): Promise<string | null> {
  const owner = (await deps.kv.get(nameKey(name), { type: 'json' })) as NameOwner | null;
  if (owner && owner.playerId !== playerId) return null;
  if (owner?.pin) return owner.pin;
  const pin = newPin(deps);
  await deps.kv.setJSON(nameKey(name), { playerId, pin } satisfies NameOwner);
  return pin;
}

/** The player's own details (only their device knows the player id). */
export async function me(deps: Deps, playerId: string | null) {
  const id = playerIdOf(playerId);
  const player = (await deps.kv.get(`players/${id}`, { type: 'json' })) as { name: string } | null;
  if (!player) return { name: null, pin: null, codeChosen: false, streak: await streakOf(deps, id) };
  const pin = await ensureCode(deps, id, player.name);
  const owner = (await deps.kv.get(nameKey(player.name), { type: 'json' })) as NameOwner | null;
  // Players who haven't picked their own code yet are asked to, the next time they open the game.
  const codeChosen = !!pin && !!owner?.chosen;
  return { name: player.name, pin, codeChosen, streak: await streakOf(deps, id), ownerMessage: await ownerMessageFor(deps, id) };
}

// ---- messages from the owner ----------------------------------------------------

interface OwnerMessage {
  text: string;
  at: number;
}

const ownerMessageKey = (playerId: string) => `owner-message/${playerId}`;

/** A note from the owner the player hasn't dismissed yet, shown when they next open the game. */
async function ownerMessageFor(deps: Deps, playerId: string): Promise<OwnerMessage | null> {
  return ((await deps.kv.get(ownerMessageKey(playerId), { type: 'json' })) as OwnerMessage | null) ?? null;
}

/** The player has read the owner's note. */
export async function ownerMessageSeen(deps: Deps, body: Record<string, unknown>) {
  await deps.kv.setJSON(ownerMessageKey(playerIdOf(body.playerId)), null);
  return { ok: true };
}

/** Words this player has found on a daily board (to restore progress on another device). */
export async function progressOf(deps: Deps, date: string | null, playerId: string | null) {
  const id = playerIdOf(playerId);
  const { boardId } = boardIdOf(date);
  const entry = (await deps.kv.get(`daily/${boardId}/${id}`, { type: 'json' })) as Entry | null;
  return { found: (entry?.found ?? []).map((s) => (s.route ? { w: s.word, p: s.route } : s.word)) };
}

function mergeFound(prev: Submitted[] | undefined, next: Submitted[], now: number): Submitted[] {
  const out = new Map((prev ?? []).map((s) => [s.word, s]));
  for (const s of next) if (!out.has(s.word)) out.set(s.word, { ...s, at: now });
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

  if (player?.name) await ensureCode(deps, playerId, player.name);

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
    ...(await mine('daily/')), ...(await mine('seen-v2/')), ...(await mine('seen/')), ...(await mine('funnel/')),
  ].map((b) => b.key);
  keys.push(`players/${playerId}`, `blitz-best/${playerId}`, `player-days/${playerId}`, `first-seen/${playerId}`, `streak/${playerId}`, ownerMessageKey(playerId));
  for (const key of keys) await deps.kv.setJSON(key, null);
  await leaveAllLeagues(deps, playerId);
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
  // The owner can pick the code (4 digits); otherwise one is made up.
  const chosen = typeof body.code === 'string' && /^\d{4}$/.test(body.code) ? body.code : null;
  if (body.code && !chosen) throw new ApiError(400, 'A code is 4 digits');
  if (body.action === 'send code') {
    const pin = chosen ?? owner.pin ?? newPin(deps);
    // A code the owner hands out works for claiming, even if it was one made up automatically.
    await deps.kv.setJSON(nameKey(name), { ...owner, pin, issued: true, chosen: pin === owner.pin && !!owner.chosen } satisfies NameOwner);
    return { ok: true, name, code: pin };
  }
  if (body.action === 'give back') return giveBack(deps, name, owner.playerId, chosen);
  if (body.action === 'look up') return { ok: true, name, report: await lookUp(deps, name, owner.playerId) };
  if (body.action === 'check play') return { ok: true, name, report: await checkPlay(deps, name, owner.playerId) };
  if (body.action === 'message') {
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (!text) throw new ApiError(400, 'Write a message to send');
    await deps.kv.setJSON(ownerMessageKey(owner.playerId), { text, at: deps.now() } satisfies OwnerMessage);
    return { ok: true, name, sent: true };
  }
  if (body.action === 'block' || body.action === 'unblock') {
    const blocked = await blockedPlayers(deps.kv);
    if (body.action === 'block') blocked.add(owner.playerId);
    else blocked.delete(owner.playerId);
    await deps.kv.setJSON(BLOCKED_KEY, [...blocked]);
    return { ok: true, name, blocked: body.action === 'block' };
  }
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
  await deps.kv.setJSON(nameKey(to), { ...owner, playerId: id, pin: owner.pin ?? newPin(deps) } satisfies NameOwner);
  return { ok: true, name: to };
}

// ---- onboarding funnel (owner only) --------------------------------------------

/** The game reports a player's first word of the day, so players without a name are counted too. */
export async function recordEvent(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  if (body.kind !== 'first-word') throw new ApiError(400, 'Bad event');
  const day = typeof body.date === 'string' && isDateKey(body.date) ? body.date : null;
  if (!day) throw new ApiError(400, 'Bad date');
  await deps.kv.setJSON(`funnel/${day}/first-word/${playerId}`, 1);
  return { ok: true };
}

export interface Funnel {
  day: string;
  opened: number;
  foundWord: number;
  onLeaderboard: number;
  /** Players who also opened the game the day before. */
  cameBack: number;
}

/** How a day's visitors got on: opened → found a word → on the leaderboard, and who came back. */
export async function funnelFor(deps: Deps, day: string): Promise<Funnel> {
  const ids = async (prefix: string) =>
    new Set((await deps.kv.list({ prefix })).blobs.map((b) => b.key.slice(b.key.lastIndexOf('/') + 1)));
  const today = await ids(`seen-v2/${day}/`);
  const yesterday = await ids(`seen-v2/${shiftDateKey(day, -1)}/`);
  return {
    day,
    opened: today.size,
    foundWord: (await ids(`funnel/${day}/first-word/`)).size,
    onLeaderboard: (await ids(`daily/${dailyBoardId(day)}/`)).size,
    cameBack: [...today].filter((id) => yesterday.has(id)).length,
  };
}

export const describeFunnel = (f: Funnel) =>
  `📊 ${f.opened} opened → ${f.foundWord} found a word → ${f.onLeaderboard} on the leaderboard · ${f.cameBack} came back from yesterday`;

/**
 * Owner-only, after a takeover: move a player's scores, streak and rooms to a new
 * private player id with a new code. Whoever was using the old id (the rightful
 * player and anyone who took the name) is signed out of it; the rightful player
 * gets back in with the name and the new code.
 */
async function giveBack(deps: Deps, name: string, from: string, code: string | null) {
  const to = deps.randomId();
  const move = async (fromKey: string, toKey: string) => {
    const value = await deps.kv.get(fromKey, { type: 'json' });
    if (value == null) return;
    await deps.kv.setJSON(toKey, value);
    await deps.kv.setJSON(fromKey, null);
  };
  for (const prefix of ['daily/', 'funnel/', 'seen-v2/']) {
    for (const { key } of (await deps.kv.list({ prefix })).blobs.filter((b) => b.key.endsWith(`/${from}`))) {
      await move(key, key.slice(0, -from.length) + to);
    }
  }
  for (const prefix of ['players/', 'blitz-best/', 'player-days/', 'first-seen/', 'streak/']) await move(prefix + from, prefix + to);
  await movePlayerInLeagues(deps, from, to);
  const pin = code ?? newPin(deps);
  await deps.kv.setJSON(nameKey(name), { playerId: to, pin, issued: true } satisfies NameOwner);
  return { ok: true, name, code: pin };
}

/** Owner-only: what the server knows about a player, to send to the owner's phone. Never an IP. */
async function lookUp(deps: Deps, name: string, playerId: string): Promise<string> {
  const player = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  const lines = [player?.name ?? name];
  const played: { day: string; entry: Entry }[] = [];
  for (const { key } of (await deps.kv.list({ prefix: 'daily/' })).blobs) {
    if (!key.endsWith(`/${playerId}`)) continue;
    const entry = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
    if (entry) played.push({ day: key.split('/')[1], entry });
  }
  played.sort((a, b) => a.day.localeCompare(b.day));
  const visits = (await deps.kv.get(`player-days/${playerId}`, { type: 'json' })) as { days: number; last?: string } | null;
  lines.push(`First board played: ${played[0]?.day ?? 'none'} · opened the game on ${visits?.days ?? 0} days${visits?.last ? `, last ${visits.last}` : ''}`);
  lines.push(`Daily boards: ${played.length ? played.slice(-7).map((p) => `${p.day.slice(5)} ${p.entry.score} pts/${p.entry.words} words`).join(', ') : 'none'}`);
  const streak = await streakOf(deps, playerId);
  lines.push(`Streak: ${streak ? `${streak.count} days to ${streak.last} (best ${streak.best})` : 'none'}`);
  const blitz = (await deps.kv.get(`blitz-best/${playerId}`, { type: 'json' })) as Entry | null;
  if (blitz) lines.push(`Blitz best: ${blitz.score} pts`);
  lines.push(...(await roomsSummary(deps, playerId)));
  const reports = (await deps.kv.list({ prefix: `reports/${name.toLowerCase()}/` })).blobs.length;
  lines.push(`Reported: ${reports} ${reports === 1 ? 'time' : 'times'} · Blocked: ${(await blockedPlayers(deps.kv)).has(playerId) ? 'yes' : 'no'}`);
  return lines.join('\n');
}

/** "4:05pm" in Pacific time (the game's day ends at midnight Pacific). */
const pacificTime = (at: number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(at).replace(' ', '').toLowerCase();

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Owner-only: how a player's recent boards compare with everyone else's, with anything
 * unusual flagged. Signs, not proof: a strong player can trip one; a cheater usually trips several.
 */
async function checkPlay(deps: Deps, name: string, playerId: string): Promise<string> {
  const boards = (await deps.kv.list({ prefix: 'daily/' })).blobs
    .filter((b) => b.key.endsWith(`/${playerId}`))
    .map((b) => b.key.split('/')[1])
    .sort()
    .slice(-4);
  const shown = ((await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null)?.name ?? name;
  const lines = [`Play check: ${shown} (last ${boards.length} ${boards.length === 1 ? 'board' : 'boards'})`];
  const flags = new Set<string>();
  for (const board of boards) {
    const table = await deps.answers(`daily/${board}`);
    const rows: { id: string; entry: Entry }[] = [];
    for (const { key } of (await deps.kv.list({ prefix: `daily/${board}/` })).blobs) {
      const entry = (await deps.kv.get(key, { type: 'json' })) as Entry | null;
      if (entry) rows.push({ id: key.slice(key.lastIndexOf('/') + 1), entry });
    }
    const me = rows.find((r) => r.id === playerId)?.entry;
    if (!me || !table) continue;
    const others = rows.filter((r) => r.id !== playerId && r.entry.words > 0);
    const words = (me.found ?? []).map((f) => f.word);
    const total = countedWords(table);
    const rank = 1 + rows.filter((r) => r.entry.score > me.score).length;
    lines.push('');
    lines.push(`${board.slice(5)}: #${rank} of ${rows.length} · ${me.words} words (${Math.round((100 * me.words) / total)}% of the board) · others' median ${Math.round(median(others.map((o) => o.entry.words)))}`);

    // Words nobody else found, against how many such words other players usually have.
    const seenBy = new Map<string, number>();
    for (const r of rows) for (const f of r.entry.found ?? []) seenBy.set(f.word, (seenBy.get(f.word) ?? 0) + 1);
    const onlyThem = words.filter((w) => seenBy.get(w) === 1);
    const othersOnly = median(others.map((o) => (o.entry.found ?? []).filter((f) => seenBy.get(f.word) === 1).length));
    lines.push(`Words nobody else found: ${onlyThem.length}${onlyThem.length ? ` (${onlyThem.slice(0, 6).join(', ')}${onlyThem.length > 6 ? '…' : ''})` : ''} · others' median ${othersOnly}`);
    if (onlyThem.length >= 6 && onlyThem.length >= 3 * Math.max(1, othersOnly)) flags.add('finds many words nobody else finds');

    // Copying from a solver's list tends to come out in alphabetical or length order.
    if (words.length >= 15) {
      const pairs = words.length - 1;
      const abc = words.slice(1).filter((w, i) => w >= words[i]).length / pairs;
      const byLength = words.slice(1).filter((w, i) => w.length >= words[i].length).length / pairs;
      lines.push(`Order found: ${Math.round(abc * 100)}% alphabetical, ${Math.round(byLength * 100)}% shortest-first (people usually land near 50% and 60%)`);
      if (abc >= 0.85) flags.add('words entered in alphabetical order');
      if (byLength >= 0.92) flags.add('words entered shortest to longest');
    }

    // Timing: when they opened the game that day, and when words arrived.
    const opened = (await deps.kv.get(`seen-v2/${board.slice(0, 10)}/${playerId}`, { type: 'json' })) as { at: number } | null;
    const times = (me.found ?? []).map((f) => f.at).filter((t): t is number => typeof t === 'number').sort((a, b) => a - b);
    const first = times[0];
    const last = times.length ? times[times.length - 1] : me.updatedAt;
    const start = first ?? opened?.at;
    if (start) {
      const minutes = Math.max(1, (last - start) / 60000);
      const pace = words.length / minutes;
      lines.push(`Time: ${opened ? `opened ${pacificTime(opened.at)}, ` : ''}${first ? `first word ${pacificTime(first)}, ` : ''}last ${pacificTime(last)} (${Math.round(minutes)} min, ${pace.toFixed(1)} words/min)`);
      if (words.length >= 20 && pace > 6) flags.add('very fast pace');
    }
    if (times.length >= 10) {
      let burst = 0;
      for (let i = 0, j = 0; j < times.length; j++) {
        while (times[j] - times[i] > 60000) i++;
        burst = Math.max(burst, j - i + 1);
      }
      lines.push(`Most words in any one minute: ${burst}`);
      if (burst >= 15) flags.add(`${burst} words within one minute`);
    }
    if (typeof me.misses === 'number' && words.length) {
      lines.push(`Tries that didn't count: ${me.misses} (${(me.misses / words.length).toFixed(2)} per word found)`);
      if (words.length >= 30 && me.misses / words.length < 0.1) flags.add('almost never enters a wrong word');
    }
  }
  lines.push('');
  lines.push(flags.size ? `⚠️ Unusual: ${[...flags].join('; ')}.` : 'Nothing unusual found.');
  if (!lines.some((l) => l.startsWith('Most words'))) {
    lines.push('Wrong tries and per-word times are recorded from now on, so later checks show more.');
  }
  return lines.join('\n');
}
