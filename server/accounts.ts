// Accounts: signing in with Apple, Google or an email link (Firebase Authentication) ties a
// player to a person, so their name, scores, streak and rooms follow them to any device and
// can't be taken over. Playing without signing in still works exactly as before.
import { ApiError, playerIdOf, type Deps } from './leaderboard';

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
    const player = (await deps.kv.get(`players/${existing.playerId}`, { type: 'json' })) as { name: string } | null;
    return { ok: true, playerId: existing.playerId, name: player?.name ?? null, switched: existing.playerId !== playerId, isNew: false, provider: existing.provider };
  }
  // This device's player already belongs to someone else's account: start this person afresh.
  const taken = (await deps.kv.get(playerAccountKey(playerId), { type: 'json' })) as string | null;
  const target = taken && taken !== who.uid ? deps.randomId() : playerId;
  await deps.kv.setJSON(accountKey(who.uid), { playerId: target, provider: who.provider, linkedAt: deps.now() } satisfies Account);
  await deps.kv.setJSON(playerAccountKey(target), who.uid);
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
