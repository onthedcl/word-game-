// Accounts: signing in with Apple, Google or an email link (Firebase Authentication) ties a
// player to a person, so their name, scores, streak and rooms follow them to any device and
// can't be taken over. Playing without signing in still works exactly as before.
import { ApiError, claimName, playerIdOf, type Deps } from './leaderboard';
import { countSignIn } from './signInStats';

/** account/<uid> → the player that person plays as. We keep no email: Firebase holds that. */
interface Account {
  playerId: string;
  provider: string;
  linkedAt: number;
}

export const accountKey = (uid: string) => `account/${uid}`;
/** player-account/<playerId> → uid, the reverse link. */
export const playerAccountKey = (playerId: string) => `player-account/${playerId}`;

/**
 * Sign this device in. If the person already has an account, the device switches to that
 * player (their progress comes back). Otherwise the device's current player becomes theirs.
 */
export async function linkAccount(deps: Deps, body: Record<string, unknown>) {
  if (!deps.verifyIdToken) throw new ApiError(503, 'Signing in isn’t set up yet');
  const playerId = playerIdOf(body.playerId);
  const who = await deps.verifyIdToken(typeof body.idToken === 'string' ? body.idToken : '');
  if (!who) throw new ApiError(401, 'Could not confirm your sign-in. Please try again');

  const existing = (await deps.kv.get(accountKey(who.uid), { type: 'json' })) as Account | null;
  if (existing) {
    await countSignIn(deps, 'returning');
    const player = (await deps.kv.get(`players/${existing.playerId}`, { type: 'json' })) as { name: string } | null;
    return { ok: true, playerId: existing.playerId, name: player?.name ?? null, switched: existing.playerId !== playerId, isNew: false, provider: existing.provider };
  }
  // This device's player already belongs to someone else's account: start this person afresh.
  const taken = (await deps.kv.get(playerAccountKey(playerId), { type: 'json' })) as string | null;
  const target = taken && taken !== who.uid ? deps.randomId() : playerId;
  await deps.kv.setJSON(accountKey(who.uid), { playerId: target, provider: who.provider, linkedAt: deps.now() } satisfies Account);
  await deps.kv.setJSON(playerAccountKey(target), who.uid);
  await countSignIn(deps, who.provider === 'google.com' ? 'google' : who.provider === 'password' || who.provider === 'emailLink' ? 'email' : 'other');
  const player = (await deps.kv.get(`players/${target}`, { type: 'json' })) as { name: string } | null;
  return { ok: true, playerId: target, name: player?.name ?? null, switched: target !== playerId, isNew: true, provider: who.provider };
}

/** How this player signs in, if they do ('google.com', 'apple.com', 'password'), else null. */
export async function accountOf(deps: Deps, playerId: string): Promise<string | null> {
  const uid = (await deps.kv.get(playerAccountKey(playerId), { type: 'json' })) as string | null;
  if (!uid) return null;
  return ((await deps.kv.get(accountKey(uid), { type: 'json' })) as Account | null)?.provider ?? null;
}

/** When a player's data is deleted: forget their account link too. */
export async function unlinkAccount(deps: Deps, playerId: string) {
  const uid = (await deps.kv.get(playerAccountKey(playerId), { type: 'json' })) as string | null;
  if (!uid) return;
  await deps.kv.setJSON(accountKey(uid), null);
  await deps.kv.setJSON(playerAccountKey(playerId), null);
}

/** When the owner moves a player to a fresh id (give back): the account follows. */
export async function moveAccount(deps: Deps, from: string, to: string) {
  const uid = (await deps.kv.get(playerAccountKey(from), { type: 'json' })) as string | null;
  if (!uid) return;
  const account = (await deps.kv.get(accountKey(uid), { type: 'json' })) as Account | null;
  if (account) await deps.kv.setJSON(accountKey(uid), { ...account, playerId: to });
  await deps.kv.setJSON(playerAccountKey(to), uid);
  await deps.kv.setJSON(playerAccountKey(from), null);
}

/**
 * Signed in on a new device, a current player types their username and their 4-digit code
 * once: the account then belongs to that player (name, scores, streak, rooms), and the code
 * isn't needed again. Same protection as continuing with a code (wrong tries pause the name).
 */
export async function claimIntoAccount(deps: Deps, body: Record<string, unknown>) {
  if (!deps.verifyIdToken) throw new ApiError(503, 'Signing in isn’t set up yet');
  const who = await deps.verifyIdToken(typeof body.idToken === 'string' ? body.idToken : '');
  if (!who) throw new ApiError(401, 'Could not confirm your sign-in. Please try again');
  const claimed = await claimName(deps, { name: body.name, code: body.code });
  const current = (await deps.kv.get(accountKey(who.uid), { type: 'json' })) as Account | null;
  if (current && current.playerId !== claimed.playerId) {
    // Only an account that hasn't got a name of its own yet can take over a name.
    const named = await deps.kv.get(`players/${current.playerId}`, { type: 'json' });
    if (named) throw new ApiError(409, 'This account already has a name');
    await deps.kv.setJSON(playerAccountKey(current.playerId), null);
  }
  await deps.kv.setJSON(accountKey(who.uid), { playerId: claimed.playerId, provider: who.provider, linkedAt: deps.now() } satisfies Account);
  await deps.kv.setJSON(playerAccountKey(claimed.playerId), who.uid);
  return { ok: true, playerId: claimed.playerId, name: claimed.name };
}

// ---- requiring sign-in ------------------------------------------------------------
// Off until the owner switches it on (REQUIRE_ACCOUNTS_FROM). From then, new players sign in
// before they play; everyone who played before keeps playing for GRACE_DAYS while they're
// reminded to sign in, then needs to as well.
export const GRACE_DAYS = 30;
const DAY = 24 * 3600 * 1000;

/**
 * Once everyone has had their grace period to sign in, accounts are how players prove who they
 * are, and the old 4-digit codes retire: they're no longer shown, changed or accepted.
 */
export function codesRetired(deps: Deps): boolean {
  const from = deps.requireAccountsFrom;
  return !!from && deps.now() >= from + GRACE_DAYS * DAY;
}

export interface SignInStatus {
  /** Sign-in is needed before this player can play. */
  required: boolean;
  /** For players from before sign-in was required: until when they can play without it. */
  signInBy: number | null;
}

export async function signInStatus(deps: Deps, playerId: string): Promise<SignInStatus> {
  const from = deps.requireAccountsFrom;
  if (!from || (await deps.kv.get(playerAccountKey(playerId), { type: 'json' }))) return { required: false, signInBy: null };
  const days = (await deps.kv.get(`player-days/${playerId}`, { type: 'json' })) as { since?: number } | null;
  const named = await deps.kv.get(`players/${playerId}`, { type: 'json' });
  // Before the start date nobody is held up; after it, players who first came before it (or
  // whose records predate first visits being dated) count as long-standing players.
  const earlier = deps.now() < from || (days?.since !== undefined ? days.since < from : !!(days || named));
  const until = from + GRACE_DAYS * DAY;
  if (earlier && deps.now() < until) return { required: false, signInBy: until };
  return { required: true, signInBy: null };
}

/** For playing, saving a name and chatting: refuse if this player has to sign in first. */
export async function requireSignIn(deps: Deps, playerId: string) {
  if ((await signInStatus(deps, playerId)).required) throw new ApiError(401, 'Sign in to play');
}
