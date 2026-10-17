// Boards are dealt by the server. Players get a board's letters and its totals, and each word
// they enter is checked here; the answers themselves never leave the server until the board
// has closed (or a Blitz game is over). Only the owner can see a live board's answers.
import { CENTER, isValidRoute } from '../src/engine/hexgrid';
import { findPaths } from '../src/engine/solver';
import { boardLocksAt, boardOpensAt, puzzleNumber } from '../src/engine/dates';
import { MIN_WORD_LENGTH, scorePath, type Board } from '../src/engine/scoring';
import { OPEN_LETTERS_FROM, weekdayIndex } from '../src/engine/generator';
import { dailyBoardId } from '../src/engine/rerolls';
import {
  ApiError, BLITZ_GRACE_SECONDS, BLITZ_SECONDS, boardIdOf, countedWords, PLAYER_ID, playerIdOf, tableFor,
  type BlitzGame, type Deps, type Entry,
} from './leaderboard';
import type { AnswerTable } from './tables';
import { rateLimit } from './ratelimit';
import { requireSignIn } from './accounts';

/** A word the player is allowed to know about: one they found, or any word once the board is over. */
export interface WordInfo {
  word: string;
  /** Its best score on this board. */
  score: number;
  pangram: boolean;
  bonus?: boolean;
}

export interface BoardView {
  kind: 'daily' | 'blitz';
  /** Daily: the board id ("2026-10-14", or "…~v1" after a reroll). */
  boardId: string | null;
  dateKey: string | null;
  number: number | null;
  difficulty: number | null;
  board: Board;
  /** How many words count toward "every word" (bonus words don't). */
  total: number;
  maxScore: number;
  pangrams: number;
  /** Words to find by first letter and length, for the hint grid. */
  hints: Record<string, Record<number, number>>;
  /** One short word to show a brand-new player how tracing works. */
  starter: { word: string; path: number[] } | null;
  /** The player's own words so far, so progress follows them to another device. */
  found: WordInfo[];
  /** Every word, only once the board has closed. */
  answers?: WordInfo[];
}

const info = (word: string, hit: AnswerTable['words'][string]): WordInfo => ({
  word, score: hit[0], pangram: hit[1] === 1, ...(hit[2] ? { bonus: true } : {}),
});

function view(
  table: AnswerTable, base: Pick<BoardView, 'kind' | 'boardId' | 'dateKey' | 'number' | 'difficulty'>, found: string[], over: boolean,
): BoardView {
  if (!table.board) throw new ApiError(500, 'Board missing');
  const hints: BoardView['hints'] = {};
  let pangrams = 0;
  for (const [word, hit] of Object.entries(table.words)) {
    if (hit[2]) continue;
    (hints[word[0]] ??= {})[word.length] = (hints[word[0]][word.length] ?? 0) + 1;
    pangrams += hit[1];
  }
  return {
    ...base,
    board: table.board,
    total: countedWords(table),
    maxScore: table.maxScore,
    pangrams,
    hints,
    starter: table.starter ?? null,
    found: found.filter((w) => Object.hasOwn(table.words, w)).map((w) => info(w, table.words[w])),
    ...(over ? { answers: Object.entries(table.words).map(([w, hit]) => info(w, hit)).sort((a, b) => a.word.localeCompare(b.word)) } : {}),
  };
}

/** A daily board, by date or board id. Not before it opens; with every answer once it has closed. */
export async function dailyBoard(deps: Deps, rawDate: string | null, rawPlayer: string | null): Promise<BoardView> {
  const id = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? dailyBoardId(rawDate) : rawDate;
  const { boardId, dateKey } = boardIdOf(id);
  if (deps.now() < boardOpensAt(dateKey)) throw new ApiError(404, 'That board isn’t open yet');
  const table = await tableFor(deps, `daily/${boardId}`);
  const playerId = rawPlayer && PLAYER_ID.test(rawPlayer) ? rawPlayer : null;
  const entry = playerId ? ((await deps.kv.get(`daily/${boardId}/${playerId}`, { type: 'json' })) as Entry | null) : null;
  return view(
    table,
    { kind: 'daily', boardId, dateKey, number: puzzleNumber(dateKey), difficulty: dateKey >= OPEN_LETTERS_FROM ? weekdayIndex(dateKey) : null },
    (entry?.found ?? []).map((f) => f.word),
    deps.now() >= boardLocksAt(dateKey),
  );
}

/** The board for a Blitz game the player started, with every answer once its time is up. */
export async function blitzBoard(deps: Deps, rawGame: unknown, rawPlayer: unknown): Promise<BoardView> {
  const { game } = await blitzGameOf(deps, rawGame, rawPlayer);
  const table = await tableFor(deps, `blitz/${game.seed}`);
  const over = game.finished || deps.now() - game.startedAt > BLITZ_SECONDS * 1000;
  return view(table, { kind: 'blitz', boardId: null, dateKey: null, number: null, difficulty: null }, [], over);
}

async function blitzGameOf(deps: Deps, rawGame: unknown, rawPlayer: unknown) {
  const playerId = playerIdOf(rawPlayer);
  if (typeof rawGame !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(rawGame)) throw new ApiError(400, 'Bad game');
  const game = (await deps.kv.get(`blitz-games/${rawGame}`, { type: 'json' })) as BlitzGame | null;
  if (!game || game.playerId !== playerId) throw new ApiError(404, 'Unknown game');
  return { game, playerId };
}

// Word checks are generous for people but not for scripts trying every word in a dictionary.
// Counted per player and per connection (a script could make up new player ids; a classroom
// shares one connection, so that limit is much higher).
const CHECKS_PER_MINUTE = 60;
const CHECKS_PER_CONNECTION = 400;

/**
 * Is this traced word an answer on the board? The route must be a real path through the key
 * tile spelling the word. Says nothing about any other word.
 */
export async function checkWord(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  let table: AnswerTable;
  if (body.game !== undefined) {
    const { game } = await blitzGameOf(deps, body.game, body.playerId);
    if (game.finished || deps.now() - game.startedAt > (BLITZ_SECONDS + BLITZ_GRACE_SECONDS) * 1000) {
      throw new ApiError(410, 'Time’s up');
    }
    table = await tableFor(deps, `blitz/${game.seed}`);
  } else {
    const { boardId, dateKey } = boardIdOf(body.board);
    if (deps.now() < boardOpensAt(dateKey)) throw new ApiError(404, 'That board isn’t open yet');
    table = await tableFor(deps, `daily/${boardId}`);
  }
  rateLimit(`check:p:${playerId}`, CHECKS_PER_MINUTE, deps.now());
  await requireSignIn(deps, playerId);
  // Set by the Worker (a one-way scramble of the connection, never the address itself).
  if (typeof body.client === 'string') rateLimit(`check:c:${body.client}`, CHECKS_PER_CONNECTION, deps.now());
  const word = typeof body.word === 'string' ? body.word.toLowerCase() : '';
  const route = Array.isArray(body.route) && body.route.every((n) => Number.isInteger(n)) ? (body.route as number[]) : null;
  const board = table.board!;
  if (!/^[a-z]+$/.test(word) || word.length < MIN_WORD_LENGTH) return { ok: false, reason: 'Too short' };
  if (
    !route || !route.every((id) => id >= 0 && id < board.letters.length) || !isValidRoute(route) ||
    route.map((id) => board.letters[id]).join('') !== word
  ) {
    return { ok: false, reason: 'Not on board' };
  }
  if (!route.includes(CENTER)) return { ok: false, reason: 'Must use the key tile' };
  const hit = Object.hasOwn(table.words, word) ? table.words[word] : undefined;
  if (!hit) return { ok: false, reason: 'Not a word' };
  return { ok: true, ...info(word, hit), points: scorePath(route, board).score };
}

/**
 * Words a player already found on this device (before boards came from the server, or while
 * the server didn't hear about them): the ones that are answers, along the routes they were
 * traced. Once per player per board, so it can't be used to try out a list of words.
 */
export async function catchUp(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const { boardId, dateKey } = boardIdOf(body.board);
  if (deps.now() < boardOpensAt(dateKey)) throw new ApiError(404, 'That board isn’t open yet');
  await requireSignIn(deps, playerId);
  const key = `caught-up/${boardId}/${playerId}`;
  if (await deps.kv.get(key, { type: 'json' })) return { words: [] as WordInfo[] };
  await deps.kv.setJSON(key, 1);
  const table = await tableFor(deps, `daily/${boardId}`);
  const board = table.board!;
  const words = (Array.isArray(body.words) ? body.words : []).slice(0, 300);
  const out: WordInfo[] = [];
  for (const raw of words) {
    const w: { w?: unknown; p?: unknown } = raw && typeof raw === 'object' ? (raw as { w?: unknown; p?: unknown }) : { w: raw };
    const word = typeof w.w === 'string' ? w.w.toLowerCase() : '';
    if (!Object.hasOwn(table.words, word)) continue;
    const route = Array.isArray(w.p) ? (w.p as number[]) : findPaths(word, board, { requireCenter: true, limit: 1 })[0];
    const real = route && route.every((id) => Number.isInteger(id) && id >= 0 && id < board.letters.length) &&
      isValidRoute(route) && route.includes(CENTER) && route.map((id) => board.letters[id]).join('') === word;
    if (real) out.push(info(word, table.words[word]));
  }
  return { words: out };
}

/** Owner only: a board's answers, for the owner's phone. */
export async function ownerAnswers(deps: Deps, rawDate: string): Promise<string> {
  const id = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? dailyBoardId(rawDate) : rawDate;
  const { boardId } = boardIdOf(id);
  const table = await tableFor(deps, `daily/${boardId}`);
  const words = Object.entries(table.words);
  const counted = words.filter(([, h]) => !h[2]).map(([w, h]) => `${w}${h[1] ? ' 🌟' : ''}`).sort();
  const bonus = words.filter(([, h]) => h[2]).map(([w]) => w).sort();
  return [
    `${boardId}: ${counted.length} words, ${table.maxScore} points`,
    counted.join(', '),
    ...(bonus.length ? ['', `Bonus ★ (${bonus.length}): ${bonus.join(', ')}`] : []),
  ].join('\n');
}

// ---- storage (owner/build only) -------------------------------------------------

export const tableKey = (key: string) => `tables/${key}`;
const TABLE_NAME = /^(daily\/\d{4}-\d{2}-\d{2}(~v\d{1,2})?|blitz\/[A-Za-z0-9-]{1,40}|blitz-pool)$/;

/** The build uploads answer tables (and the Blitz pool) here. Unchanged ones aren't rewritten. */
export async function storeTables(deps: Deps, body: Record<string, unknown>) {
  const tables = body.tables;
  if (!tables || typeof tables !== 'object') throw new ApiError(400, 'No tables');
  let stored = 0;
  for (const [name, value] of Object.entries(tables as Record<string, unknown>)) {
    if (!TABLE_NAME.test(name)) throw new ApiError(400, `Bad table name ${name}`);
    const old = await deps.kv.get(tableKey(name), { type: 'json' });
    if (JSON.stringify(old) === JSON.stringify(value)) continue;
    await deps.kv.setJSON(tableKey(name), value);
    stored += 1;
  }
  return { ok: true, stored, received: Object.keys(tables).length };
}

/** The secret new boards are made with. Made once, then kept; only the build asks for it. */
export async function boardSecret(deps: Deps): Promise<string> {
  const have = (await deps.kv.get('board-secret', { type: 'json' })) as string | null;
  if (have) return have;
  const secret = `${deps.randomId()}${deps.randomId()}`.replace(/-/g, '');
  await deps.kv.setJSON('board-secret', secret);
  return secret;
}
