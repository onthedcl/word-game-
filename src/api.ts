// Leaderboard API client (Netlify Functions; see netlify/functions/api.mts).
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://dpiyf-lettertown.netlify.app';

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
    if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  daily: (date: string, player: string) => call<Board>('GET', `/api/daily?date=${date}&player=${encodeURIComponent(player)}`),
  submitDaily: (b: { playerId: string; name: string; date: string; words: string[] }) =>
    call<Board & { score: number }>('POST', '/api/daily', b),
  saveName: (playerId: string, name: string) => call<{ ok: true; name: string }>('POST', '/api/name', { playerId, name }),
  blitz: (player: string) => call<Board>('GET', `/api/blitz?player=${encodeURIComponent(player)}`),
  startBlitz: (playerId: string) => call<{ seed: string; seconds: number }>('POST', '/api/blitz/start', { playerId }),
  finishBlitz: (b: { playerId: string; name: string; seed: string; words: string[] }) =>
    call<Board & { score: number; personalBest: boolean }>('POST', '/api/blitz/finish', b),
};
