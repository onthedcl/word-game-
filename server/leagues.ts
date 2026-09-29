// Private leagues: a named group of players with its own leaderboard for each daily
// board, joined by invite link, plus a short news feed ("Sam passed you").
import { ApiError, playerIdOf, readBoard, type Deps, type Entry } from './leaderboard';
import { cleanName } from './names';
import { dailyBoardId, parseBoardId } from '../src/engine/rerolls';
import { boardLocksAt, isDateKey, shiftDateKey } from '../src/engine/dates';

export interface League {
  name: string;
  owner: string;
  created: number;
  members: string[];
}

export interface NewsItem {
  at: number;
  text: string;
  /** Players the item is about (so the feed can say "you"). */
  about?: string[];
}

const MAX_MEMBERS = 200;
const MAX_LEAGUES = 20;
const MAX_NEWS = 30;
const LEAGUE_ID = /^[a-z0-9]{8}$/;

const leagueKey = (id: string) => `leagues/${id}`;
const mineKey = (playerId: string) => `player-leagues/${playerId}`;
const newsKey = (id: string) => `league-news/${id}`;

function leagueIdOf(value: unknown): string {
  if (typeof value !== 'string' || !LEAGUE_ID.test(value)) throw new ApiError(400, 'Bad league');
  return value;
}

async function load(deps: Deps, id: string): Promise<League> {
  const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
  if (!league) throw new ApiError(404, 'That league no longer exists');
  return league;
}

async function playerName(deps: Deps, playerId: string): Promise<string> {
  const p = (await deps.kv.get(`players/${playerId}`, { type: 'json' })) as { name: string } | null;
  if (!p) throw new ApiError(403, 'Pick a leaderboard name first');
  return p.name;
}

const myLeagueIds = async (deps: Deps, playerId: string) =>
  ((await deps.kv.get(mineKey(playerId), { type: 'json' })) as string[] | null) ?? [];

async function addNews(deps: Deps, id: string, item: NewsItem) {
  const news = ((await deps.kv.get(newsKey(id), { type: 'json' })) as NewsItem[] | null) ?? [];
  await deps.kv.setJSON(newsKey(id), [item, ...news].slice(0, MAX_NEWS));
}

function newId(deps: Deps): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(deps.random() * chars.length)]).join('');
}

export async function createLeague(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const who = await playerName(deps, playerId);
  const name = cleanName(body.name, 24);
  if (!name) throw new ApiError(400, 'Please pick a different league name (2–24 letters or numbers)');
  const mine = await myLeagueIds(deps, playerId);
  if (mine.length >= MAX_LEAGUES) throw new ApiError(409, `You can be in up to ${MAX_LEAGUES} leagues`);
  let id = newId(deps);
  while (await deps.kv.get(leagueKey(id), { type: 'json' })) id = newId(deps);
  await deps.kv.setJSON(leagueKey(id), { name, owner: playerId, created: deps.now(), members: [playerId] } satisfies League);
  await deps.kv.setJSON(mineKey(playerId), [...mine, id]);
  await addNews(deps, id, { at: deps.now(), text: `${who} started ${name}`, about: [playerId] });
  deps.notify?.({ title: 'New league', message: `${who} started the league “${name}”`, tags: ['house'], event: { kind: 'league', who, league: name } });
  return { id, name };
}

/** Name and size only, for the "Join this league?" screen. */
export async function leagueInfo(deps: Deps, rawId: unknown) {
  const league = await load(deps, leagueIdOf(rawId));
  return { name: league.name, members: league.members.length };
}

export async function joinLeague(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const id = leagueIdOf(body.id);
  const who = await playerName(deps, playerId);
  const league = await load(deps, id);
  if (!league.members.includes(playerId)) {
    if (league.members.length >= MAX_MEMBERS) throw new ApiError(409, 'That league is full');
    const mine = await myLeagueIds(deps, playerId);
    if (mine.length >= MAX_LEAGUES) throw new ApiError(409, `You can be in up to ${MAX_LEAGUES} leagues`);
    await deps.kv.setJSON(leagueKey(id), { ...league, members: [...league.members, playerId] });
    await deps.kv.setJSON(mineKey(playerId), [...mine, id]);
    await addNews(deps, id, { at: deps.now(), text: `${who} joined`, about: [playerId] });
    deps.notify?.({ title: 'League join', message: `${who} joined “${league.name}”`, tags: ['handshake'], event: { kind: 'league-join', who, league: league.name } });
  }
  return { id, name: league.name, members: league.members.length + (league.members.includes(playerId) ? 0 : 1) };
}

export async function leaveLeague(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const id = leagueIdOf(body.id);
  await removeMember(deps, id, playerId);
  return { ok: true };
}

async function removeMember(deps: Deps, id: string, playerId: string) {
  const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
  if (league?.members.includes(playerId)) {
    const members = league.members.filter((m) => m !== playerId);
    await deps.kv.setJSON(leagueKey(id), members.length ? { ...league, members } : null);
    if (!members.length) await deps.kv.setJSON(newsKey(id), null);
  }
  await deps.kv.setJSON(mineKey(playerId), (await myLeagueIds(deps, playerId)).filter((l) => l !== id));
}

/** When a player deletes their data: leave every league. */
export async function leaveAllLeagues(deps: Deps, playerId: string) {
  for (const id of await myLeagueIds(deps, playerId)) await removeMember(deps, id, playerId);
  await deps.kv.setJSON(mineKey(playerId), null);
}

export async function myLeagues(deps: Deps, rawPlayer: unknown) {
  const playerId = playerIdOf(rawPlayer);
  const out: { id: string; name: string; members: number; latestNews: number }[] = [];
  for (const id of await myLeagueIds(deps, playerId)) {
    const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
    if (!league) continue;
    const news = ((await deps.kv.get(newsKey(id), { type: 'json' })) as NewsItem[] | null) ?? [];
    // The player's own doings (starting, joining, passing someone) aren't news to them.
    const latest = news.find((n) => n.about?.[0] !== playerId)?.at ?? 0;
    out.push({ id, name: league.name, members: league.members.length, latestNews: latest });
  }
  return { leagues: out };
}

/** A league's leaderboard for one daily board, with its news. Members only. */
export async function leagueBoard(deps: Deps, rawId: unknown, rawDate: unknown, rawPlayer: unknown) {
  const playerId = playerIdOf(rawPlayer);
  const id = leagueIdOf(rawId);
  const league = await load(deps, id);
  if (!league.members.includes(playerId)) throw new ApiError(403, "You're not in this league");
  const boardId = typeof rawDate === 'string' && parseBoardId(rawDate) ? rawDate : null;
  if (!boardId) throw new ApiError(400, 'Bad date');
  const members = new Set(league.members);
  await announceYesterday(deps, id, league, parseBoardId(boardId)!.dateKey);
  const board = await readBoard(deps.kv, `daily/${boardId}/`, playerId, members);
  const news = ((await deps.kv.get(newsKey(id), { type: 'json' })) as NewsItem[] | null) ?? [];
  return { id, name: league.name, members: league.members.length, owner: league.owner === playerId, board, news };
}

/** Once the day before `today` has locked, post its league winner to the news (once). */
async function announceYesterday(deps: Deps, id: string, league: League, today: string) {
  const day = shiftDateKey(today, -1);
  if (!isDateKey(day) || deps.now() < boardLocksAt(day)) return;
  const key = `league-winner/${id}/${day}`;
  if (await deps.kv.get(key, { type: 'json' })) return;
  await deps.kv.setJSON(key, 1);
  const board = await readBoard(deps.kv, `daily/${dailyBoardId(day)}/`, null, new Set(league.members));
  const top = board.top[0];
  if (top && board.total >= 2) await addNews(deps, id, { at: deps.now(), text: `🏆 ${top.name} won yesterday with ${top.score} points` });
}

/**
 * After a player's score goes up: in each of their leagues, note anyone they just passed.
 * `before`/`after` are the player's score before and after this submission.
 */
export async function notePasses(deps: Deps, playerId: string, name: string, boardId: string, before: number, after: number) {
  if (after <= before) return;
  for (const id of await myLeagueIds(deps, playerId)) {
    const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
    if (!league) continue;
    for (const other of league.members) {
      if (other === playerId) continue;
      const e = (await deps.kv.get(`daily/${boardId}/${other}`, { type: 'json' })) as Entry | null;
      if (e && e.score >= before && e.score < after) {
        await addNews(deps, id, { at: deps.now(), text: `${name} passed ${e.name} (${after} to ${e.score})`, about: [playerId, other] });
      }
    }
  }
}
