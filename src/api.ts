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
}

/** A found word, with the route it was traced along when known (the server scores that route). */
export type Submitted = string | { w: string; p: number[] };

export interface Board {
  total: number;
  top: BoardRow[];
  you: BoardRow | null;
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

/** Is a leaderboard server answering? The game works fully without one. */
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
  submitDaily: (b: { playerId: string; name: string; date: string; words: Submitted[] }) =>
    call<Board & { score: number }>('POST', '/api/daily', b),
  hello: (playerId: string, mode: 'daily' | 'blitz', name: string, date: string) =>
    call<{ ok: true }>('POST', '/api/hello', { playerId, mode, name: name || undefined, date }),
  saveName: (playerId: string, name: string) => call<{ ok: true; name: string; pin: string }>('POST', '/api/name', { playerId, name }),
  claim: (name: string) => call<{ ok: true; playerId: string; name: string; pin: string }>('POST', '/api/claim', { name }),
  me: (player: string) => call<{ name: string | null; pin: string | null }>('GET', `/api/me?player=${encodeURIComponent(player)}`),
  progress: (date: string, player: string) =>
    call<{ found: Submitted[] }>('GET', `/api/progress?date=${encodeURIComponent(date)}&player=${encodeURIComponent(player)}`),
  blitz: (player: string) => call<Board>('GET', `/api/blitz?player=${encodeURIComponent(player)}`),
  startBlitz: (playerId: string) => call<{ game: string; seed: string; seconds: number }>('POST', '/api/blitz/start', { playerId }),
  finishBlitz: (b: { playerId: string; name: string; game: string; words: Submitted[] }) =>
    call<Board & { score: number; personalBest: boolean }>('POST', '/api/blitz/finish', b),
};
