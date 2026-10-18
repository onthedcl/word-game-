// DPIYF Lettertown leaderboard (Cloudflare Worker + Durable Object).
//
// The Worker handles CORS and forwards every API call to a single Durable
// Object, which stores the leaderboards and runs the rules in
// server/leaderboard.ts. One object means every write is applied in order, so
// there are no lost updates.
import { DurableObject } from 'cloudflare:workers';
import {
  ApiError, cheatReport, claimName, deletePlayer, lostCode, setCode, ownerMessageSeen, describeFunnel, finishBlitz, funnelFor, recordEvent, getBlitz, getDaily, hello, me, moderateName, progressOf, reportName, saveName,
  startBlitz, submitDaily,
  type Deps, type Place,
} from '../../server/leaderboard';
import type { AnswerTable } from '../../server/tables';
import { buildDigest, type Notification } from '../../server/digest';
import { claimIntoAccount, linkAccount } from '../../server/accounts';
import { cachedKV } from '../../server/kvcache';
import { exportPage, importEntries, type BackupStore } from '../../server/backup';
import { boardLocksAt, dateKeyFor, shiftDateKey } from '../../src/engine/dates';
import { PER_CONNECTION, rateLimit } from '../../server/ratelimit';
import { blitzBoard, boardSecret, catchUp, checkWord, dailyBoard, ownerAnswers, storeTables, tableKey } from '../../server/boards';
import { verifyFirebaseToken } from '../../server/firebaseToken';
import { sendSignInEmail } from '../../server/signInEmail';
import { describeSignIns, signInStatsFor } from '../../server/signInStats';
import { makeMailer } from './mailer';
import {
  createLeague, deleteChat, deleteLeague, getChat, joinLeague, leagueBoard, leagueInfo, leaveLeague, myLeagues, postChat, publicLeagues,
  reportChat, setLeaguePublic,
} from '../../server/leagues';

interface Env {
  BOARD: DurableObjectNamespace<Leaderboard>;
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
  /** Firebase project whose sign-ins (Apple, Google, email link) are accepted. Empty until set up. */
  FIREBASE_PROJECT_ID?: string;
  /** Date sign-in became required (e.g. 2026-11-01), or empty while it's optional. */
  REQUIRE_ACCOUNTS_FROM?: string;
  /**
   * Firebase service account key, as JSON (a Worker secret), and a Resend API key (another):
   * with both, sign-in emails go out in Lettertown's own design instead of Firebase's.
   */
  FIREBASE_SERVICE_ACCOUNT?: string;
  RESEND_API_KEY?: string;
}

const NOTIFY_REPO = 'onthedcl/word-game-';

/** Pings are collected and sent as one summary this often. */
const DIGEST_QUEUE = 'digest-queue';
/** Pings held for the summary, at most (beyond that they're only counted). */
const DIGEST_CAP = 600;
const HOUR = 3600 * 1000;
/** Cloudflare's free plan, per day (roughly): requests, and rows written. */
const FREE_REQUESTS = 100_000;
const FREE_WRITES = 100_000;

/** The next 8 PM Eastern, when the owner's daily summary goes out. */
function nextSummaryAt(now: number): number {
  const today = dateKeyFor(new Date(now));
  const tonight = boardLocksAt(today) - 4 * HOUR; // midnight Eastern, less four hours
  return tonight > now ? tonight : boardLocksAt(shiftDateKey(today, 1)) - 4 * HOUR;
}

type Queue = { items: Notification[]; extra: number };
const asQueue = (raw: unknown): Queue =>
  Array.isArray(raw) ? { items: raw as Notification[], extra: 0 } : ((raw as Queue | undefined) ?? { items: [], extra: 0 });

interface Usage {
  day: string;
  requests: number;
  writes: number;
}

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
/** Set by the Worker: a one-way scramble of the player's connection, for rate limits. Never the IP itself. */
const CLIENT_HEADER = 'X-Lettertown-Client';

export class Leaderboard extends DurableObject<Env> {
  // Answer tables live only in this object's storage (uploaded by the build), cached in memory.
  private tables = new Map<string, AnswerTable | null>();
  private pool: string[] | null = null;

  // Storage behind a memory cache, kept for as long as this object stays in memory.
  private kvCache: ReturnType<typeof cachedKV> | null = null;
  private get kv() {
    const storage = this.ctx.storage;
    return (this.kvCache ??= cachedKV({
      get: (key) => storage.get(key),
      put: (key, value) => storage.put(key, value),
      delete: (key) => storage.delete(key),
      keys: async (prefix) => [...(await storage.list({ prefix })).keys()],
    }));
  }

  private get backupStore(): BackupStore {
    const storage = this.ctx.storage;
    return {
      list: (opts) => storage.list(opts),
      put: (entries) => storage.put(entries),
    };
  }

  private deps(): Deps {
    const storage = this.ctx.storage;
    return {
      kv: this.kv,
      requireAccountsFrom: this.env.REQUIRE_ACCOUNTS_FROM ? Date.parse(`${this.env.REQUIRE_ACCOUNTS_FROM}T04:00:00Z`) || undefined : undefined,
      answers: async (key) => {
        if (this.tables.has(key)) return this.tables.get(key)!;
        const table = ((await storage.get(tableKey(key))) as AnswerTable | undefined) ?? null;
        if (table) this.tables.set(key, table);
        return table;
      },
      blitzSeeds: async () => {
        this.pool ??= ((await storage.get(tableKey('blitz-pool'))) as string[] | undefined) ?? null;
        return this.pool ?? [];
      },
      now: () => Date.now(),
      randomId: () => crypto.randomUUID(),
      random: () => Math.random(),
      verifyIdToken: this.env.FIREBASE_PROJECT_ID
        ? (token) => verifyFirebaseToken(token, this.env.FIREBASE_PROJECT_ID!)
        : undefined,
      notify: this.env.NTFY_TOPIC
        ? (n) => this.ctx.waitUntil(n.urgent ? this.sendNotification(n) : this.queueNotification(n))
        : undefined,
    };
  }

  /** Hold a ping for the daily summary (sent by alarm() at 8 PM Eastern). */
  private async queueNotification(n: Notification) {
    const queue = asQueue(await this.ctx.storage.get(DIGEST_QUEUE));
    if (queue.items.length < DIGEST_CAP) queue.items.push(n);
    else queue.extra += 1;
    await this.ctx.storage.put(DIGEST_QUEUE, queue);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(nextSummaryAt(Date.now()));
  }

  // How busy the server is today, against the free plan (kept in memory, saved now and then).
  private usage: Usage = { day: '', requests: 0, writes: 0 };
  private writesSeen = 0;
  private async countRequest() {
    const day = easternDay();
    if (this.usage.day !== day) {
      this.usage = ((await this.ctx.storage.get(`usage/${day}`)) as Usage | undefined) ?? { day, requests: 0, writes: 0 };
    }
    this.usage.requests += 1;
    const writes = this.kv.stats.writes;
    this.usage.writes += writes - this.writesSeen;
    this.writesSeen = writes;
    if (this.usage.requests % 200 === 0) await this.ctx.storage.put(`usage/${day}`, this.usage);
  }

  async alarm() {
    const queue = asQueue(await this.ctx.storage.get(DIGEST_QUEUE));
    await this.ctx.storage.delete(DIGEST_QUEUE);
    const digest = buildDigest(queue.items);
    if (!digest) return;
    if (queue.extra) digest.message += `\n…and ${queue.extra} more pings`;
    // Add how today's visitors are getting on (owner-only numbers).
    const funnel = await funnelFor(this.deps(), easternDay()).catch(() => null);
    if (funnel?.opened) digest.message += `\n${describeFunnel(funnel)}`;
    const signIns = describeSignIns(await signInStatsFor(this.deps(), easternDay()).catch(() => ({})));
    if (signIns) digest.message += `\n${signIns}`;
    // And how close the server is to the free plan's daily limits.
    if (this.usage.day !== easternDay()) {
      this.usage = ((await this.ctx.storage.get(`usage/${easternDay()}`)) as Usage | undefined) ?? this.usage;
    }
    if (this.usage.day === easternDay() && this.usage.requests) {
      const pct = (n: number, of: number) => Math.round((100 * n) / of);
      const busiest = Math.max(pct(this.usage.requests, FREE_REQUESTS), pct(this.usage.writes, FREE_WRITES));
      digest.message += `\n🖥️ Server today: ${this.usage.requests.toLocaleString('en-US')} requests (${pct(this.usage.requests, FREE_REQUESTS)}% of the free daily limit), ${this.usage.writes.toLocaleString('en-US')} saves (${pct(this.usage.writes, FREE_WRITES)}%)`;
      if (busiest >= 50) digest.message += `\n⚠️ Time to switch Cloudflare Workers to the $5/month plan, before a busy day hits the free limit.`;
    }
    await this.sendNotification(digest);
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
    await this.countRequest().catch(() => {});
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
    const deps = this.deps();
    try {
      // Flood limit per connection for everything except the owner's and the build's own calls.
      const client = req.headers.get(CLIENT_HEADER);
      if (client && !url.pathname.startsWith('/api/admin/')) {
        rateLimit(`all:${req.method}:${client}`, req.method === 'POST' ? PER_CONNECTION.POST : PER_CONNECTION.GET, Date.now());
      }
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
        case 'POST /api/lost-code':
          return json(await lostCode(deps, body));
        case 'POST /api/account/link':
          return json(await linkAccount(deps, body));
        case 'POST /api/account/claim':
          return json(await claimIntoAccount(deps, body));
        case 'POST /api/code':
          return json(await setCode(deps, body));
        case 'POST /api/message-seen':
          return json(await ownerMessageSeen(deps, body));
        case 'GET /api/me':
          return json(await me(deps, url.searchParams.get('player')));
        case 'GET /api/progress':
          return json(await progressOf(deps, url.searchParams.get('date'), url.searchParams.get('player')));
        case 'POST /api/league/create':
          return json(await createLeague(deps, body));
        case 'POST /api/league/join':
          return json(await joinLeague(deps, body));
        case 'POST /api/league/leave':
          return json(await leaveLeague(deps, body));
        case 'GET /api/league/mine':
          return json(await myLeagues(deps, player));
        case 'POST /api/league/delete':
          return json(await deleteLeague(deps, body));
        case 'GET /api/league/chat':
          return json(await getChat(deps, url.searchParams.get('id'), player));
        case 'POST /api/league/chat':
          return json(await postChat(deps, body));
        case 'POST /api/league/chat/delete':
          return json(await deleteChat(deps, body));
        case 'POST /api/league/chat/report':
          return json(await reportChat(deps, body));
        case 'GET /api/league/public':
          return json(await publicLeagues(deps, player));
        case 'POST /api/league/visibility':
          return json(await setLeaguePublic(deps, body));
        case 'GET /api/league/info':
          return json(await leagueInfo(deps, url.searchParams.get('id')));
        case 'GET /api/league':
          return json(await leagueBoard(deps, url.searchParams.get('id'), url.searchParams.get('date'), player));
        case 'POST /api/event':
          return json(await recordEvent(deps, body));
        case 'POST /api/admin/funnel':
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          return json(await funnelFor(deps, typeof body.day === 'string' ? body.day : easternDay()));
        case 'POST /api/admin/cheat-report':
          // Owner only (the nightly Cheat check workflow): who stood out on a closed board.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          return json(await cheatReport(deps, typeof body.day === 'string' ? body.day : ''));
        case 'GET /api/board':
          return json(await dailyBoard(deps, url.searchParams.get('date'), player));
        case 'GET /api/blitz/board':
          return json(await blitzBoard(deps, url.searchParams.get('game'), player));
        case 'POST /api/signin-email':
          return json(await sendSignInEmail(deps, makeMailer(this.env.FIREBASE_SERVICE_ACCOUNT, this.env.RESEND_API_KEY), {
            ...body,
            client: req.headers.get(CLIENT_HEADER) ?? undefined,
          }));
        case 'POST /api/check':
          return json(await checkWord(deps, { ...body, client: req.headers.get(CLIENT_HEADER) ?? undefined }));
        case 'POST /api/catch-up':
          return json(await catchUp(deps, body));
        case 'POST /api/admin/board-secret':
          // The build only: the secret new boards are made with.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          return json({ secret: await boardSecret(deps) });
        case 'POST /api/admin/tables': {
          // The build only: upload answer tables.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          const result = await storeTables(deps, body);
          this.tables.clear();
          this.pool = null;
          return json(result);
        }
        case 'POST /api/admin/export': {
          // Owner only (the nightly Backup workflow): everything, page by page.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          const after = typeof body.after === 'string' ? body.after : null;
          return json(await exportPage(this.backupStore, after, typeof body.limit === 'number' ? body.limit : undefined));
        }
        case 'POST /api/admin/import': {
          // Owner only, to put a backup back. Needs an explicit confirmation.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          if (body.confirm !== 'restore' || !body.entries || typeof body.entries !== 'object') return json({ error: 'Bad restore' }, 400);
          const result = await importEntries(this.backupStore, body.entries as Record<string, unknown>);
          this.kvCache = null; // forget anything remembered from before the restore
          this.tables.clear();
          return json(result);
        }
        case 'POST /api/admin/answers':
          // Owner only (the Answers workflow): a board's answers, for the owner's phone.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          return json({ report: await ownerAnswers(deps, typeof body.date === 'string' ? body.date : easternDay()) });
        case 'POST /api/delete':
          return json(await deletePlayer(deps, body));
        case 'POST /api/report':
          return json(await reportName(deps, body));
        case 'POST /api/admin/moderate':
          // Owner only: the Moderate workflow sends the private ntfy topic as its key.
          if (!this.env.NTFY_TOPIC || body.key !== this.env.NTFY_TOPIC) return json({ error: 'Not allowed' }, 403);
          return json(await moderateName(deps, body));
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
          return json(await hello(deps, body, place ? (JSON.parse(place) as Place) : null, isBot(req)));
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

/** Search engines, link previews, scanners and scripts, by what they call themselves. */
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|python|curl|wget|httpclient|scanner|monitor|uptime/i;
function isBot(req: Request): boolean {
  const ua = req.headers.get('User-Agent') ?? '';
  return !ua || BOT.test(ua);
}

/** Today's date in New York, where most players are. */
function easternDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
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
    forwarded.headers.delete(CLIENT_HEADER);
    const ip = req.headers.get('CF-Connecting-IP');
    if (ip) {
      // Scrambled with today's date, so it can't be turned back into an address or followed across days.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${easternDay()}|${ip}`));
      forwarded.headers.set(CLIENT_HEADER, [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    }
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
