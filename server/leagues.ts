// Private leagues: a named group of players with its own leaderboard for each daily
// board, joined by invite link, plus a short news feed ("Sam passed you").
import { ApiError, blockedPlayers, playerIdOf, readBoard, type Deps, type Entry } from './leaderboard';
import { cleanName, maskText } from './names';
import { dailyBoardId, parseBoardId } from '../src/engine/rerolls';
import { boardLocksAt, isDateKey, shiftDateKey } from '../src/engine/dates';

export interface League {
  name: string;
  owner: string;
  created: number;
  members: string[];
  /** Listed in the public rooms anyone can browse and join (otherwise invite link only). */
  public?: boolean;
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
const chatKey = (id: string) => `league-chat/${id}`;

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
  const isPublic = body.public === true;
  await deps.kv.setJSON(leagueKey(id), { name, owner: playerId, created: deps.now(), members: [playerId], public: isPublic } satisfies League);
  await deps.kv.setJSON(mineKey(playerId), [...mine, id]);
  await addNews(deps, id, { at: deps.now(), text: `${who} started ${name}`, about: [playerId] });
  deps.notify?.({
    title: 'New room',
    message: `${who} started the ${isPublic ? 'public' : 'private'} room “${name}”`,
    tags: ['house'],
    // The owner wants to hear about new rooms right away, not in the hourly digest.
    urgent: true,
  });
  return { id, name, public: isPublic };
}

/** Name and size only, for the "Join this league?" screen. */
export async function leagueInfo(deps: Deps, rawId: unknown) {
  const league = await load(deps, leagueIdOf(rawId));
  return { name: league.name, members: league.members.length, public: !!league.public };
}

/** Public rooms anyone can join, busiest first. */
export async function publicLeagues(deps: Deps, rawPlayer: unknown) {
  const playerId = typeof rawPlayer === 'string' ? rawPlayer : '';
  const rooms: { id: string; name: string; members: number; joined: boolean }[] = [];
  const blocked = await blockedPlayers(deps.kv);
  for (const { key } of (await deps.kv.list({ prefix: 'leagues/' })).blobs) {
    const league = (await deps.kv.get(key, { type: 'json' })) as League | null;
    if (!league?.public || (blocked.has(league.owner) && league.owner !== playerId)) continue;
    rooms.push({ id: key.slice('leagues/'.length), name: league.name, members: league.members.length, joined: league.members.includes(playerId) });
  }
  rooms.sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
  return { rooms: rooms.slice(0, 50) };
}

/** The host can list a room publicly or make it invite-only. */
export async function setLeaguePublic(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const id = leagueIdOf(body.id);
  const league = await load(deps, id);
  if (league.owner !== playerId) throw new ApiError(403, 'Only the host can change this');
  await deps.kv.setJSON(leagueKey(id), { ...league, public: body.public === true });
  return { ok: true, public: body.public === true };
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
    if (!members.length) {
      await deps.kv.setJSON(newsKey(id), null);
      await deps.kv.setJSON(chatKey(id), null);
    }
  }
  await deps.kv.setJSON(mineKey(playerId), (await myLeagueIds(deps, playerId)).filter((l) => l !== id));
}

/** After a takeover the owner moves a player to a new id: carry their rooms, news and chat along. */
export async function movePlayerInLeagues(deps: Deps, from: string, to: string) {
  const swap = (p: string) => (p === from ? to : p);
  const ids = await myLeagueIds(deps, from);
  for (const id of ids) {
    const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
    if (league) await deps.kv.setJSON(leagueKey(id), { ...league, owner: swap(league.owner), members: league.members.map(swap) });
    const news = (await deps.kv.get(newsKey(id), { type: 'json' })) as NewsItem[] | null;
    if (news) await deps.kv.setJSON(newsKey(id), news.map((n) => (n.about ? { ...n, about: n.about.map(swap) } : n)));
    const chat = (await deps.kv.get(chatKey(id), { type: 'json' })) as ChatMessage[] | null;
    if (chat) await deps.kv.setJSON(chatKey(id), chat.map((m) => ({ ...m, from: swap(m.from) })));
  }
  await deps.kv.setJSON(mineKey(to), ids);
  await deps.kv.setJSON(mineKey(from), null);
}

/** Owner look-up: the rooms a player is in and what they've said lately. */
export async function roomsSummary(deps: Deps, playerId: string): Promise<string[]> {
  const lines: string[] = [];
  const said: ChatMessage[] = [];
  const rooms: string[] = [];
  for (const id of await myLeagueIds(deps, playerId)) {
    const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
    if (!league) continue;
    rooms.push(`${league.name}${league.owner === playerId ? ' (host)' : ''}, ${league.members.length} members`);
    said.push(...(await chatOf(deps, id)).filter((m) => m.from === playerId));
  }
  lines.push(`Rooms: ${rooms.length ? rooms.join('; ') : 'none'}`);
  said.sort((a, b) => b.at - a.at);
  lines.push(`Chat messages: ${said.length}${said.length ? `. Latest: ${said.slice(0, 3).map((m) => `“${m.text}”`).join(' ')}` : ''}`);
  return lines;
}

/** When a player deletes their data: leave every league. */
export async function leaveAllLeagues(deps: Deps, playerId: string) {
  for (const id of await myLeagueIds(deps, playerId)) {
    const chat = ((await deps.kv.get(chatKey(id), { type: 'json' })) as ChatMessage[] | null) ?? [];
    if (chat.some((m) => m.from === playerId)) await deps.kv.setJSON(chatKey(id), chat.filter((m) => m.from !== playerId));
    await removeMember(deps, id, playerId);
  }
  await deps.kv.setJSON(mineKey(playerId), null);
}

export async function myLeagues(deps: Deps, rawPlayer: unknown) {
  const playerId = playerIdOf(rawPlayer);
  const out: { id: string; name: string; members: number; latestNews: number; latestChat: number }[] = [];
  for (const id of await myLeagueIds(deps, playerId)) {
    const league = (await deps.kv.get(leagueKey(id), { type: 'json' })) as League | null;
    if (!league) continue;
    const news = ((await deps.kv.get(newsKey(id), { type: 'json' })) as NewsItem[] | null) ?? [];
    // The player's own doings (starting, joining, passing someone) aren't news to them.
    const latest = news.find((n) => n.about?.[0] !== playerId)?.at ?? 0;
    const chat = ((await deps.kv.get(chatKey(id), { type: 'json' })) as ChatMessage[] | null) ?? [];
    const latestChat = [...chat].reverse().find((m) => m.from !== playerId)?.at ?? 0;
    out.push({ id, name: league.name, members: league.members.length, latestNews: latest, latestChat });
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
  const board = await readBoard(deps.kv, `daily/${boardId}/`, playerId, members, () => deps.answers(`daily/${boardId}`));
  const news = ((await deps.kv.get(newsKey(id), { type: 'json' })) as NewsItem[] | null) ?? [];
  return { id, name: league.name, members: league.members.length, owner: league.owner === playerId, public: !!league.public, board, news };
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

// ---- deleting a room -----------------------------------------------------------

/** The host deletes the room for everyone: its leaderboard view, news and chat. Scores are kept. */
export async function deleteLeague(deps: Deps, body: Record<string, unknown>) {
  const playerId = playerIdOf(body.playerId);
  const id = leagueIdOf(body.id);
  const league = await load(deps, id);
  if (league.owner !== playerId) throw new ApiError(403, 'Only the host can delete this room');
  for (const member of league.members) {
    await deps.kv.setJSON(mineKey(member), (await myLeagueIds(deps, member)).filter((l) => l !== id));
  }
  for (const key of [leagueKey(id), newsKey(id), chatKey(id)]) await deps.kv.setJSON(key, null);
  return { ok: true };
}

// ---- room chat -----------------------------------------------------------------

export interface ChatMessage {
  id: string;
  at: number;
  from: string;
  name: string;
  text: string;
}

const MAX_CHAT = 150;
const MAX_CHAT_LENGTH = 300;
const CHAT_GAP_MS = 2000;

/** Chat messages are only shown with the sender's name, never their player id. */
const publicMessage = (m: ChatMessage, playerId: string) => ({ id: m.id, at: m.at, name: m.name, text: m.text, mine: m.from === playerId });

async function member(deps: Deps, rawId: unknown, rawPlayer: unknown) {
  const playerId = playerIdOf(rawPlayer);
  const id = leagueIdOf(rawId);
  const league = await load(deps, id);
  if (!league.members.includes(playerId)) throw new ApiError(403, "You're not in this room");
  return { playerId, id, league };
}

const chatOf = async (deps: Deps, id: string) => ((await deps.kv.get(chatKey(id), { type: 'json' })) as ChatMessage[] | null) ?? [];

export async function getChat(deps: Deps, rawId: unknown, rawPlayer: unknown) {
  const { playerId, id, league } = await member(deps, rawId, rawPlayer);
  const blocked = await blockedPlayers(deps.kv);
  const shown = (await chatOf(deps, id)).filter((m) => m.from === playerId || !blocked.has(m.from));
  return { messages: shown.map((m) => publicMessage(m, playerId)), host: league.owner === playerId };
}

export async function postChat(deps: Deps, body: Record<string, unknown>) {
  const { playerId, id } = await member(deps, body.id, body.playerId);
  const name = await playerName(deps, playerId);
  const raw = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!raw) throw new ApiError(400, 'Say something!');
  if (raw.length > MAX_CHAT_LENGTH) throw new ApiError(400, `Keep it under ${MAX_CHAT_LENGTH} characters`);
  const chat = await chatOf(deps, id);
  const last = [...chat].reverse().find((m) => m.from === playerId);
  if (last && deps.now() - last.at < CHAT_GAP_MS) throw new ApiError(429, 'Slow down a little');
  const message: ChatMessage = { id: newId(deps), at: deps.now(), from: playerId, name, text: maskText(raw) };
  await deps.kv.setJSON(chatKey(id), [...chat, message].slice(-MAX_CHAT));
  return { message: publicMessage(message, playerId) };
}

/** Anyone can delete their own message; the host can delete any. */
export async function deleteChat(deps: Deps, body: Record<string, unknown>) {
  const { playerId, id, league } = await member(deps, body.id, body.playerId);
  const chat = await chatOf(deps, id);
  const target = chat.find((m) => m.id === body.message);
  if (!target) return { ok: true };
  if (target.from !== playerId && league.owner !== playerId) throw new ApiError(403, 'You can only delete your own messages');
  await deps.kv.setJSON(chatKey(id), chat.filter((m) => m !== target));
  return { ok: true };
}

/** A member reports a message: the owner is told right away, with the text. */
export async function reportChat(deps: Deps, body: Record<string, unknown>) {
  const { id, league } = await member(deps, body.id, body.playerId);
  const target = (await chatOf(deps, id)).find((m) => m.id === body.message);
  if (target) {
    deps.notify?.({
      title: 'Chat message reported',
      message: `In “${league.name}”, ${target.name} wrote: “${target.text}”. Delete it from the room chat as host, or ask me to remove it.`,
      tags: ['warning'],
      urgent: true,
    });
  }
  return { ok: true };
}
