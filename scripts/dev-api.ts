// A local stand-in for the leaderboard server, for trying the game in a browser:
//   BOARD_SECRET=… npx vite-node scripts/dev-api.ts [port] [tablesDir]
// then build or run the game with VITE_API_BASE=http://localhost:<port>.
// Uses answer tables from scripts/build-scores.ts and keeps everything in memory.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as lb from '../server/leaderboard';
import * as boards from '../server/boards';
import type { AnswerTable } from '../server/tables';

const port = Number(process.argv[2] ?? 8787);
const dir = process.argv[3] ?? 'private/scores';
const data = new Map<string, unknown>();
const clock = process.env.DEV_NOW ? Date.parse(process.env.DEV_NOW) - Date.now() : 0;

const deps: lb.Deps = {
  kv: {
    get: async (key) => structuredClone(data.get(key) ?? null),
    setJSON: async (key, value) => void (value === null ? data.delete(key) : data.set(key, structuredClone(value))),
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  },
  answers: async (key) => {
    const file = join(dir, `${key}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as AnswerTable) : null;
  },
  blitzSeeds: async () => JSON.parse(readFileSync(join(dir, 'blitz-pool.json'), 'utf8')) as string[],
  now: () => Date.now() + clock,
  // REQUIRE_FROM=2026-10-01 to try required sign-in locally.
  requireAccountsFrom: process.env.REQUIRE_FROM ? Date.parse(`${process.env.REQUIRE_FROM}T04:00:00Z`) : undefined,
  randomId: () => crypto.randomUUID(),
  random: () => Math.random(),
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const q = (k: string) => url.searchParams.get(k);
  const routes: Record<string, () => Promise<unknown>> = {
    'GET /api/board': () => boards.dailyBoard(deps, q('date'), q('player')),
    'GET /api/blitz/board': () => boards.blitzBoard(deps, q('game'), q('player')),
    'POST /api/check': () => boards.checkWord(deps, body),
    'POST /api/catch-up': () => boards.catchUp(deps, body),
    'GET /api/daily': () => lb.getDaily(deps, q('date'), q('player')),
    'POST /api/daily': () => lb.submitDaily(deps, body),
    'GET /api/progress': () => lb.progressOf(deps, q('date'), q('player')),
    'GET /api/blitz': () => lb.getBlitz(deps, q('player')),
    'POST /api/blitz/start': () => lb.startBlitz(deps, body),
    'POST /api/blitz/finish': () => lb.finishBlitz(deps, body),
    'POST /api/name': () => lb.saveName(deps, body),
    'POST /api/hello': () => lb.hello(deps, body),
    'GET /api/me': () => lb.me(deps, q('player')),
  };
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    const result = route ? await route() : { ok: true, leagues: [], rooms: [], total: 0, top: [], you: null };
    res.writeHead(200, cors).end(JSON.stringify(result));
  } catch (err) {
    const status = err instanceof lb.ApiError ? err.status : 500;
    if (status === 500) console.error(err);
    res.writeHead(status, cors).end(JSON.stringify({ error: err instanceof Error ? err.message : 'error' }));
  }
}).listen(port, () => console.log(`Dev API on http://localhost:${port}`));
