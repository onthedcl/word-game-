// DPIYF Lettertown leaderboard (Cloudflare Worker + Durable Object).
//
// The Worker handles CORS and forwards every API call to a single Durable
// Object, which stores the leaderboards and runs the rules in
// server/leaderboard.ts. One object means every write is applied in order, so
// there are no lost updates.
import { DurableObject } from 'cloudflare:workers';
import {
  ApiError, finishBlitz, getBlitz, getDaily, saveName, startBlitz, submitDaily, type Deps,
} from '../../server/leaderboard';
import type { AnswerTable } from '../../server/tables';

interface Env {
  BOARD: DurableObjectNamespace<Leaderboard>;
  SCORES_BASE: string;
  ALLOWED_ORIGINS: string;
}

const MISSING_RETRY_MS = 10 * 60 * 1000;

export class Leaderboard extends DurableObject<Env> {
  private tables = new Map<string, { table: AnswerTable | null; at: number }>();
  private pool: string[] | null = null;

  private async fetchJSON<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.env.SCORES_BASE}/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    return (await res.json()) as T;
  }

  private deps(): Deps {
    const storage = this.ctx.storage;
    return {
      kv: {
        get: async (key) => (await storage.get(key)) ?? null,
        setJSON: (key, value) => storage.put(key, value),
        list: async ({ prefix }) => ({ blobs: [...(await storage.list({ prefix })).keys()].map((key) => ({ key })) }),
      },
      answers: async (key) => {
        const hit = this.tables.get(key);
        // Tables never change; a missing one is retried now and then in case a new build added it.
        if (hit && (hit.table || Date.now() - hit.at < MISSING_RETRY_MS)) return hit.table;
        const table = await this.fetchJSON<AnswerTable>(`${key}.json`);
        this.tables.set(key, { table, at: Date.now() });
        return table;
      },
      blitzSeeds: async () => (this.pool ??= (await this.fetchJSON<string[]>('blitz-pool.json')) ?? []),
      now: () => Date.now(),
      randomId: () => crypto.randomUUID(),
      random: () => Math.random(),
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
    const deps = this.deps();
    try {
      const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
      const player = url.searchParams.get('player');
      switch (route) {
        case 'GET /api/daily':
          return json(await getDaily(deps, url.searchParams.get('date'), player));
        case 'POST /api/daily':
          return json(await submitDaily(deps, body));
        case 'GET /api/blitz':
          return json(await getBlitz(deps, player));
        case 'POST /api/blitz/start':
          return json(await startBlitz(deps, body));
        case 'POST /api/blitz/finish':
          return json(await finishBlitz(deps, body));
        case 'POST /api/name':
          return json(await saveName(deps, body));
        default:
          return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong' }, 500);
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (!allowed.includes(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('DPIYF Lettertown leaderboard is running.', { headers: cors });
    }
    const res = await env.BOARD.get(env.BOARD.idFromName('global')).fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
