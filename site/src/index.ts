// dpiyf.com: serves the game's files with HTTPS only, sends www.dpiyf.com to dpiyf.com, and adds
// security headers to every response.
interface Env {
  ASSETS: Fetcher;
}

const API = 'https://word-game-leaderboard.danlagstein.workers.dev';

const SECURITY_HEADERS: Record<string, string> = {
  // Only this site's own code runs, and it only talks to itself and the game server.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${API}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // One address, always over HTTPS (Cloudflare says how the visitor actually connected).
    const plainHttp = (req.headers.get('cf-visitor') ?? '').includes('"http"');
    if (plainHttp || url.hostname === 'www.dpiyf.com') {
      url.protocol = 'https:';
      if (url.hostname === 'www.dpiyf.com') url.hostname = 'dpiyf.com';
      return Response.redirect(url.toString(), 301);
    }
    // The copy of the game at the old address asks this before sending a player here.
    if (url.pathname === '/moved.json') {
      return new Response('{"lettertown":true}', {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': 'https://onthedcl.github.io',
          ...SECURITY_HEADERS,
        },
      });
    }
    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    // Built files have a fingerprint in their name, so they can be cached for good; the page
    // itself is always checked, so a new version reaches players right away.
    if (url.pathname.startsWith('/assets/')) out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (url.pathname === '/' || url.pathname.endsWith('.html')) out.headers.set('Cache-Control', 'no-cache');
    return out;
  },
} satisfies ExportedHandler<Env>;
