import { beforeEach, describe, expect, it } from 'vitest';
import { verifyFirebaseToken, type Identity } from './firebaseToken';
import { linkAccount } from './accounts';
import { ApiError, claimName, deletePlayer, me, moderateName, saveName, setCode, submitDaily, type Deps, type KV } from './leaderboard';
import { answerTable } from './tables';
import { generateDaily } from '../src/engine/generator';
import { dict, seeds } from '../src/engine/node-dict';

const PROJECT = 'lettertown-test';
const b64url = (b: ArrayBuffer | Uint8Array) =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('Firebase token check', () => {
  let keys: CryptoKeyPair;
  let jwk: JsonWebKey & { kid: string };
  const now = Date.parse('2026-10-03T12:00:00Z');
  const sign = async (payload: Record<string, unknown>, kid = 'k1') => {
    const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid })));
    const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
  };
  const good = () => ({
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user-123',
    iat: now / 1000 - 60, exp: now / 1000 + 3000, auth_time: now / 1000 - 60, firebase: { sign_in_provider: 'google.com' },
  });
  const jwks = async () => ({ keys: [jwk] });
  beforeEach(async () => {
    keys = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
    )) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
  });

  it('accepts a genuine token and says who it is', async () => {
    expect(await verifyFirebaseToken(await sign(good()), PROJECT, now, jwks)).toEqual({ uid: 'user-123', provider: 'google.com' });
  });

  it('refuses tokens for another project, expired, unknown keys or tampered', async () => {
    expect(await verifyFirebaseToken(await sign({ ...good(), aud: 'other' }), PROJECT, now, jwks)).toBeNull();
    expect(await verifyFirebaseToken(await sign({ ...good(), iss: 'https://evil' }), PROJECT, now, jwks)).toBeNull();
    expect(await verifyFirebaseToken(await sign({ ...good(), exp: now / 1000 - 1 }), PROJECT, now, jwks)).toBeNull();
    expect(await verifyFirebaseToken(await sign(good(), 'k2'), PROJECT, now, jwks)).toBeNull();
    const [h, , s] = (await sign(good())).split('.');
    const forged = b64url(new TextEncoder().encode(JSON.stringify({ ...good(), sub: 'someone-else' })));
    expect(await verifyFirebaseToken(`${h}.${forged}.${s}`, PROJECT, now, jwks)).toBeNull();
    expect(await verifyFirebaseToken('not-a-token', PROJECT, now, jwks)).toBeNull();
  });
});

function memoryKV(): KV {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => structuredClone(data.get(key) ?? null),
    setJSON: async (key, value) => void (value === null ? data.delete(key) : data.set(key, structuredClone(value))),
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  };
}

describe('accounts', () => {
  const P1 = 'player-one-aaaaaaaaaaaa';
  const P2 = 'player-two-bbbbbbbbbbbb';
  const D = '2026-09-27';
  const table = answerTable(generateDaily(dict, seeds, D));
  let deps: Deps;
  let ids = 0;
  // Tokens in these tests are just "uid:provider".
  const verify = async (t: string): Promise<Identity | null> => (t.includes(':') ? { uid: t.split(':')[0], provider: t.split(':')[1] } : null);
  beforeEach(() => {
    deps = {
      kv: memoryKV(), answers: async (k) => (k === `daily/${D}` ? table : null), blitzSeeds: async () => [],
      now: () => Date.parse(`${D}T15:00:00Z`), randomId: () => `fresh-${++ids}-xxxxxxxxxxxx`, random: () => 0, verifyIdToken: verify,
    };
  });
  const rejects = async (p: Promise<unknown>, status: number) => {
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status });
  };

  it('saves a player to their account, and brings them back on another device', async () => {
    await saveName(deps, { playerId: P1, name: 'Dcl' });
    await submitDaily(deps, { playerId: P1, name: 'Dcl', date: D, words: Object.keys(table.words).slice(0, 3) });
    expect(await linkAccount(deps, { playerId: P1, idToken: 'u1:google.com' })).toMatchObject({ playerId: P1, switched: false, isNew: true });
    expect(await me(deps, P1)).toMatchObject({ account: 'google.com' });
    // A new phone: signing in switches it to the same player, name and all.
    expect(await linkAccount(deps, { playerId: P2, idToken: 'u1:google.com' })).toMatchObject({ playerId: P1, name: 'Dcl', switched: true });
  });

  it('protects a saved name from code claims, and refuses bad tokens', async () => {
    await saveName(deps, { playerId: P1, name: 'Dcl' });
    await setCode(deps, { playerId: P1, code: '4719' });
    await linkAccount(deps, { playerId: P1, idToken: 'u1:password' });
    await rejects(claimName(deps, { name: 'dcl', code: '4719' }), 403);
    await rejects(linkAccount(deps, { playerId: P2, idToken: 'garbage' }), 401);
  });

  it('gives a second person on a shared device a fresh player', async () => {
    await saveName(deps, { playerId: P1, name: 'Dcl' });
    await linkAccount(deps, { playerId: P1, idToken: 'u1:google.com' });
    const other = await linkAccount(deps, { playerId: P1, idToken: 'u2:apple.com' });
    expect(other).toMatchObject({ switched: true, name: null });
    expect(other.playerId).not.toBe(P1);
  });

  it('forgets the account when the player deletes their data, and follows a give back', async () => {
    await saveName(deps, { playerId: P1, name: 'Dcl' });
    await linkAccount(deps, { playerId: P1, idToken: 'u1:google.com' });
    const moved = await moderateName(deps, { name: 'dcl', action: 'give back' });
    expect(moved.ok).toBe(true);
    const back = await linkAccount(deps, { playerId: P2, idToken: 'u1:google.com' });
    expect(back).toMatchObject({ name: 'Dcl', switched: true });
    await deletePlayer(deps, { playerId: back.playerId });
    expect(await linkAccount(deps, { playerId: P2, idToken: 'u1:google.com' })).toMatchObject({ playerId: P2, isNew: true });
  });

  it('says sign-in is not set up when there is no project', async () => {
    delete deps.verifyIdToken;
    await rejects(linkAccount(deps, { playerId: P1, idToken: 'u1:google.com' }), 503);
  });
});
