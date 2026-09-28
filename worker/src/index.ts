// DPIYF Lettertown leaderboard (Cloudflare Worker + Durable Object).
//
// The Worker handles CORS and forwards every API call to a single Durable
// Object, which stores the leaderboards and runs the rules in
// server/leaderboard.ts. One object means every write is applied in order, so
// there are no lost updates.
import { DurableObject } from 'cloudflare:workers';
import {
  ApiError, claimName, finishBlitz, getBlitz, getDaily, hello, me, progressOf, saveName, startBlitz, submitDaily,
  type Deps, type Place,
} from '../../server/leaderboard';
import type { AnswerTable } from '../../server/tables';
import { buildDigest, type Notification } from '../../server/digest';

interface Env {
  BOARD: DurableObjectNamespace<Leaderboard>;
  SCORES_BASE: string;
  ALLOWED_ORIGINS: string;
  /** Private ntfy.sh topic for "someone is playing" notifications (a Worker secret). */
  NTFY_TOPIC?: string;
  /**
   * ntfy.sh access token (a Worker secret). ntfy rate-limits anonymous senders by IP,
   * and Cloudflare Workers share IPs, so anonymous pushes from here are refused with 429.
   */
  NTFY_TOKEN?: string;
  /**
   * GitHub token allowed to trigger this repo's workflows (a Worker secret). When set,
   * pings go through GitHub Actions (.github/workflows/notify.yml), whose servers ntfy accepts.
   */
  GH_NOTIFY_TOKEN?: string;
}

const NOTIFY_REPO = 'onthedcl/word-game-';

const MISSING_RETRY_MS = 10 * 60 * 1000;
/** Pings are collected and sent as one summary this often. */
const DIGEST_MS = 60 * 60 * 1000;
const DIGEST_QUEUE = 'digest-queue';

interface NotifyStatus {
  sent: number;
  failed: number;
  lastStatus?: number;
  lastError?: string;
  lastAt?: string;
  via?: 'github' | 'ntfy';
}
/** Set by the Worker (never trusted from the client): Cloudflare's rough location for the player. */
const PLACE_HEADER = 'X-Lettertown-Place';

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
      notify: this.env.NTFY_TOPIC ? (n) => this.ctx.waitUntil(this.queueNotification(n)) : undefined,
    };
  }

  /** Hold a ping for the next digest (sent by alarm(), about an hour after the first one). */
  private async queueNotification(n: Notification) {
    const queue = ((await this.ctx.storage.get(DIGEST_QUEUE)) as Notification[] | undefined) ?? [];
    queue.push(n);
    await this.ctx.storage.put(DIGEST_QUEUE, queue);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + DIGEST_MS);
  }

  async alarm() {
    const queue = ((await this.ctx.storage.get(DIGEST_QUEUE)) as Notification[] | undefined) ?? [];
    await this.ctx.storage.delete(DIGEST_QUEUE);
    const digest = buildDigest(queue);
    if (digest) await this.sendNotification(digest);
  }

  /** Push to ntfy.sh and keep a tally (no message contents) so delivery can be checked. */
  private async sendNotification({ title, message, tags }: Notification) {
    const status = ((await this.ctx.storage.get('notify-status')) as NotifyStatus | undefined) ?? { sent: 0, failed: 0 };
    try {
      // ntfy.sh refuses free-plan pushes from Cloudflare's shared IPs (429), so when a
      // GitHub token is set, ask GitHub Actions to send the ping instead.
      const viaGitHub = !!this.env.GH_NOTIFY_TOKEN;
      const res = viaGitHub
        ? await fetch(`https://api.github.com/repos/${NOTIFY_REPO}/dispatches`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.env.GH_NOTIFY_TOKEN}`,
              Accept: 'application/vnd.github+json',
              'Content-Type': 'application/json',
              'User-Agent': 'dpiyf-lettertown-leaderboard',
            },
            body: JSON.stringify({ event_type: 'notify', client_payload: { title, message, tags: (tags ?? []).join(',') } }),
          })
        : await fetch('https://ntfy.sh/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(this.env.NTFY_TOKEN ? { Authorization: `Bearer ${this.env.NTFY_TOKEN}` } : {}),
            },
            body: JSON.stringify({ topic: this.env.NTFY_TOPIC, title, message, tags, click: 'https://onthedcl.github.io/word-game-/' }),
          });
      if (res.ok) status.sent += 1;
      else {
        status.failed += 1;
        status.lastError = `${viaGitHub ? 'GitHub' : 'ntfy'} answered ${res.status}`;
      }
      status.lastStatus = res.status;
      status.via = viaGitHub ? 'github' : 'ntfy';
    } catch (err) {
      status.failed += 1;
      status.lastError = err instanceof Error ? err.message : String(err);
    }
    status.lastAt = new Date().toISOString();
    await this.ctx.storage.put('notify-status', status);
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
        case 'POST /api/claim':
          return json(await claimName(deps, body));
        case 'GET /api/me':
          return json(await me(deps, url.searchParams.get('player')));
        case 'GET /api/progress':
          return json(await progressOf(deps, url.searchParams.get('date'), url.searchParams.get('player')));
        case 'GET /api/notify-status': {
          // Delivery health only: counts and the last error, never message contents.
          const status = (await this.ctx.storage.get('notify-status')) ?? { sent: 0, failed: 0 };
          return json({
            configured: !!this.env.NTFY_TOPIC,
            token: !!this.env.NTFY_TOKEN,
            github: !!this.env.GH_NOTIFY_TOKEN,
            ...(status as object),
          });
        }
        case 'POST /api/notify-test':
          // Only someone who knows the private topic can trigger a test ping.
          if (!this.env.NTFY_TOPIC || body.topic !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          await this.sendNotification({ title: 'DPIYF Lettertown', message: 'Test from the leaderboard server: notifications are on.', tags: ['white_check_mark'] });
          return json({ ok: true, ...((await this.ctx.storage.get('notify-status')) as object) });
        case 'POST /api/hello': {
          const place = req.headers.get(PLACE_HEADER);
          return json(await hello(deps, body, place ? (JSON.parse(place) as Place) : null));
        }
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
    // Pass Cloudflare's approximate location (city/region/country, not the IP) to the leaderboard.
    const forwarded = new Request(req);
    forwarded.headers.delete(PLACE_HEADER);
    const cf = req.cf as { city?: string; regionCode?: string; region?: string; country?: string } | undefined;
    if (cf) {
      const place: Place = { city: cf.city, region: cf.regionCode ?? cf.region, country: cf.country };
      forwarded.headers.set(PLACE_HEADER, JSON.stringify(place));
    }
    const res = await env.BOARD.get(env.BOARD.idFromName('global')).fetch(forwarded);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
