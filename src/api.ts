// Leaderboard API client (Cloudflare Worker; see worker/src/index.ts).
// Off unless the build sets VITE_API_BASE (the deploy workflow does).
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export interface BoardRow {
  position: number;
  name: string;
  score: number;
  words: number;
  pangrams: number;
  rankName: string;
  you: boolean;
  /** Bonus words found; `words` counts only the board's own words. */
  bonus?: number;
  /** Found every word: 1 = first to finish, 2 = second, ... */
  finished?: number;
}

/** A found word, with the route it was traced along when known (the server scores that route). */
export type Submitted = string | { w: string; p: number[] };

export interface LeagueSummary {
  id: string;
  name: string;
  members: number;
  /** When the newest news item not caused by this player was posted (ms). */
  latestNews: number;
  /** When the newest chat message from someone else was sent (ms). */
  latestChat?: number;
}

export interface ChatMessage {
  id: string;
  at: number;
  name: string;
  text: string;
  mine: boolean;
}

export interface LeagueView {
  id: string;
  name: string;
  members: number;
  owner: boolean;
  public?: boolean;
  board: Board;
  news: { at: number; text: string }[];
}

/** Consecutive days with a word found, ending on `last` (a date key). */
export interface Streak {
  count: number;
  best: number;
  last: string;
}

export interface Board {
  total: number;
  top: BoardRow[];
  you: BoardRow | null;
}

/** A word the player may know about: one they found, or any word once the board is over. */
export interface WordInfo {
  word: string;
  /** Its best score on the board. */
  score: number;
  pangram: boolean;
  bonus?: boolean;
}

/** A board as the server deals it (see server/boards.ts). */
export interface BoardView {
  kind: 'daily' | 'blitz';
  boardId: string | null;
  dateKey: string | null;
  number: number | null;
  difficulty: number | null;
  board: { letters: string[]; premiums: ('DL' | 'TL' | 'DW' | null)[] };
  total: number;
  maxScore: number;
  pangrams: number;
  hints: Record<string, Record<number, number>>;
  starter: { word: string; path: number[] } | null;
  found: WordInfo[];
  answers?: WordInfo[];
}

/** The server answered with an error (as opposed to being unreachable). */
export class ApiRejected extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** The name already belongs to a player; if it is you, you can continue as them. */
export class NameTaken extends Error {
  constructor(public name: string) {
    super(`“${name}” is taken`);
  }
}

/** Same rules the server applies, so names can be checked while offline. */
export function looksLikeName(raw: string): boolean {
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 16 && /^[\p{L}\p{N} _.'-]+$/u.test(name);
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiRejected((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Is the game server answering? Boards come from it, so the game needs it to play. */
export async function leaderboardOnline(): Promise<boolean> {
  if (!API_BASE) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${API_BASE}/api/blitz?player=ping`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  daily: (date: string, player: string) => call<Board>('GET', `/api/daily?date=${date}&player=${encodeURIComponent(player)}`),
  submitDaily: (b: { playerId: string; name: string; date: string; words: Submitted[]; misses?: number }) =>
    call<Board & { score: number; streak?: Streak | null }>('POST', '/api/daily', b),
  hello: (playerId: string, mode: 'daily' | 'blitz', name: string, date: string) =>
    call<{ ok: true }>('POST', '/api/hello', { playerId, mode, name: name || undefined, date }),
  saveName: (playerId: string, name: string) => call<{ ok: true; name: string; pin: string }>('POST', '/api/name', { playerId, name }),
  claim: (name: string, code: string) => call<{ ok: true; playerId: string; name: string; pin: string }>('POST', '/api/claim', { name, code }),
  lostCode: (name: string, note = '') => call<{ ok: true }>('POST', '/api/lost-code', { name, note }),
  messageSeen: (playerId: string) => call<{ ok: true }>('POST', '/api/message-seen', { playerId }),
  setCode: (playerId: string, code: string) => call<{ ok: true; pin: string }>('POST', '/api/code', { playerId, code }),
  me: (player: string) =>
    call<{
      name: string | null; pin: string | null; codeChosen?: boolean; account?: string | null;
      /** Whether this player must sign in to play, or until when they can play without it. */
      signIn?: { required: boolean; signInBy: number | null };
      streak?: Streak | null; ownerMessage?: { text: string; at: number } | null;
    }>('GET', `/api/me?player=${encodeURIComponent(player)}`),
  progress: (date: string, player: string) =>
    call<{ found: Submitted[] }>('GET', `/api/progress?date=${encodeURIComponent(date)}&player=${encodeURIComponent(player)}`),
  blitz: (player: string) => call<Board>('GET', `/api/blitz?player=${encodeURIComponent(player)}`),
  startBlitz: (playerId: string) => call<{ game: string; seconds: number; board: BoardView }>('POST', '/api/blitz/start', { playerId }),
  blitzBoard: (game: string, player: string) =>
    call<BoardView>('GET', `/api/blitz/board?game=${encodeURIComponent(game)}&player=${encodeURIComponent(player)}`),
  board: (date: string, player: string) =>
    call<BoardView>('GET', `/api/board?date=${encodeURIComponent(date)}&player=${encodeURIComponent(player)}`),
  catchUp: (playerId: string, board: string, words: Submitted[]) =>
    call<{ words: WordInfo[] }>('POST', '/api/catch-up', { playerId, board, words }),
  check: (b: { playerId: string; board?: string; game?: string; word: string; route: number[] }) =>
    call<({ ok: true; points: number } & WordInfo) | { ok: false; reason: string }>('POST', '/api/check', b),
  finishBlitz: (b: { playerId: string; name: string; game: string; words: Submitted[] }) =>
    call<Board & { score: number; personalBest: boolean }>('POST', '/api/blitz/finish', b),
  /** Erase this player's name, scores and history from the server. */
  deleteMe: (playerId: string) => call<{ ok: true }>('POST', '/api/delete', { playerId }),
  /** Signed in on a new device: take over an existing name with its code (once). */
  claimAccount: (idToken: string, name: string, code: string) =>
    call<{ ok: true; playerId: string; name: string }>('POST', '/api/account/claim', { idToken, name, code }),
  linkAccount: (playerId: string, idToken: string) =>
    call<{ ok: true; playerId: string; name: string | null; switched: boolean; isNew: boolean; provider: string }>('POST', '/api/account/link', { playerId, idToken }),
  leagueCreate: (playerId: string, name: string, isPublic: boolean) =>
    call<{ id: string; name: string; public: boolean }>('POST', '/api/league/create', { playerId, name, public: isPublic }),
  deleteRoom: (playerId: string, id: string) => call<{ ok: true }>('POST', '/api/league/delete', { playerId, id }),
  chat: (id: string, player: string) =>
    call<{ messages: ChatMessage[]; host: boolean }>('GET', `/api/league/chat?id=${encodeURIComponent(id)}&player=${encodeURIComponent(player)}`),
  sendChat: (playerId: string, id: string, text: string) => call<{ message: ChatMessage }>('POST', '/api/league/chat', { playerId, id, text }),
  deleteChat: (playerId: string, id: string, message: string) => call<{ ok: true }>('POST', '/api/league/chat/delete', { playerId, id, message }),
  reportChat: (playerId: string, id: string, message: string) => call<{ ok: true }>('POST', '/api/league/chat/report', { playerId, id, message }),
  publicRooms: (player: string) =>
    call<{ rooms: { id: string; name: string; members: number; joined: boolean }[] }>('GET', `/api/league/public?player=${encodeURIComponent(player)}`),
  setRoomPublic: (playerId: string, id: string, isPublic: boolean) =>
    call<{ ok: true; public: boolean }>('POST', '/api/league/visibility', { playerId, id, public: isPublic }),
  leagueJoin: (playerId: string, id: string) => call<{ id: string; name: string; members: number }>('POST', '/api/league/join', { playerId, id }),
  leagueLeave: (playerId: string, id: string) => call<{ ok: true }>('POST', '/api/league/leave', { playerId, id }),
  leagueInfo: (id: string) => call<{ name: string; members: number; public?: boolean }>('GET', `/api/league/info?id=${encodeURIComponent(id)}`),
  myLeagues: (player: string) => call<{ leagues: LeagueSummary[] }>('GET', `/api/league/mine?player=${encodeURIComponent(player)}`),
  league: (id: string, date: string, player: string) =>
    call<LeagueView>('GET', `/api/league?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}&player=${encodeURIComponent(player)}`),
  /** First word of the day (counts players without a name in the owner's onboarding numbers). */
  event: (playerId: string, kind: 'first-word', date: string) => call<{ ok: true }>('POST', '/api/event', { playerId, kind, date }),
  report: (playerId: string, name: string) => call<{ ok: true }>('POST', '/api/report', { playerId, name }),
};
