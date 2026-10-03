// Checks a Firebase Authentication ID token (a signed JWT) without any SDK: the signature
// against Google's published keys, plus who issued it, for which project, and when.

export interface Identity {
  /** Firebase's id for the person (stable across devices). */
  uid: string;
  /** How they signed in: 'google.com', 'apple.com', 'password' (email link), ... */
  provider: string;
}

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

type Jwks = { keys: (JsonWebKey & { kid: string })[] };

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

let cached: { jwks: Jwks; until: number } | null = null;
async function googleKeys(now: number): Promise<Jwks> {
  if (cached && cached.until > now) return cached.jwks;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`Could not load sign-in keys (${res.status})`);
  const jwks = (await res.json()) as Jwks;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cached = { jwks, until: now + maxAge * 1000 };
  return jwks;
}

/**
 * The person behind a valid token, or null. `keys` is only swapped out in tests.
 * See https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  now = Date.now(),
  keys: (now: number) => Promise<Jwks> = googleKeys,
): Promise<Identity | null> {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  try {
    const header = json(parts[0]) as { alg?: string; kid?: string };
    const p = json(parts[1]) as {
      aud?: string; iss?: string; sub?: string; exp?: number; iat?: number; auth_time?: number;
      firebase?: { sign_in_provider?: string };
    };
    const secs = now / 1000;
    if (header.alg !== 'RS256' || !header.kid) return null;
    if (p.aud !== projectId || p.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!p.sub || p.sub.length > 128) return null;
    if (!p.exp || p.exp < secs || !p.iat || p.iat > secs + 300 || (p.auth_time ?? 0) > secs + 300) return null;
    const jwk = (await keys(now)).keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return ok ? { uid: p.sub, provider: p.firebase?.sign_in_provider ?? 'unknown' } : null;
  } catch {
    return null;
  }
}
