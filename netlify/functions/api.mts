import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { parseDawg } from '../../src/engine/dawg';
import { ApiError, finishBlitz, getBlitz, getDaily, saveName, startBlitz, submitDaily, type Deps } from '../../server/leaderboard';

// The game is served from GitHub Pages as well as this site, so it calls the API cross-origin.
const ALLOWED_ORIGINS = [/^https:\/\/onthedcl\.github\.io$/, /^https:\/\/([a-z0-9-]+--)?dpiyf-lettertown\.netlify\.app$/, /^http:\/\/localhost:\d+$/];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  if (!ALLOWED_ORIGINS.some((re) => re.test(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

let dictionary: ReturnType<Deps['loadDictionary']> | null = null;
function loadDictionary(origin: string): ReturnType<Deps['loadDictionary']> {
  dictionary ??= (async () => {
    const [dawg, pangrams] = await Promise.all(
      ['words.dawg', 'pangrams.txt'].map(async (f) => {
        const res = await fetch(`${origin}/dict/${f}`);
        if (!res.ok) throw new Error(`Could not load ${f}`);
        return res.text();
      }),
    );
    return { dict: parseDawg(dawg), seeds: pangrams.split('\n').filter(Boolean) };
  })().catch((err) => {
    dictionary = null;
    throw err;
  });
  return dictionary;
}

export default async (req: Request, context: Context) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

  // Keep test deploys (previews, branches) out of the real leaderboards.
  const production = context.deploy?.context === 'production';
  const deps: Deps = {
    kv: getStore({ name: production ? 'leaderboard' : `leaderboard-${context.deploy?.context ?? 'dev'}`, consistency: 'strong' }),
    loadDictionary: () => loadDictionary(new URL(req.url).origin),
    now: () => Date.now(),
    randomId: () => crypto.randomUUID(),
  };

  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
  try {
    const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    switch (route) {
      case 'GET /api/daily':
        return json(await getDaily(deps, url.searchParams.get('date'), url.searchParams.get('player')));
      case 'POST /api/daily':
        return json(await submitDaily(deps, body));
      case 'GET /api/blitz':
        return json(await getBlitz(deps, url.searchParams.get('player')));
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
};

export const config: Config = { path: '/api/*' };
