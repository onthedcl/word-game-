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

export interface Board {
  total: number;
  top: BoardRow[];
  you: BoardRow | null;
}

/** The server answered with an error (as opposed to being unreachable). */
export class ApiRejected extends Error {}

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
    if (!res.ok) throw new ApiRejected((data as { error?: string }).error ?? `Request failed (${res.status})`);
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
  submitDaily: (b: { playerId: string; name: string; date: string; words: string[] }) =>
    call<Board & { score: number }>('POST', '/api/daily', b),
  hello: (playerId: string, mode: 'daily' | 'blitz') => call<{ ok: true }>('POST', '/api/hello', { playerId, mode }),
  saveName: (playerId: string, name: string) => call<{ ok: true; name: string }>('POST', '/api/name', { playerId, name }),
  blitz: (player: string) => call<Board>('GET', `/api/blitz?player=${encodeURIComponent(player)}`),
  startBlitz: (playerId: string) => call<{ game: string; seed: string; seconds: number }>('POST', '/api/blitz/start', { playerId }),
  finishBlitz: (b: { playerId: string; name: string; game: string; words: string[] }) =>
    call<Board & { score: number; personalBest: boolean }>('POST', '/api/blitz/finish', b),
};
