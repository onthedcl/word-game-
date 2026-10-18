// Daily sign-in numbers for the owner's 8 PM summary: who signed in and how, and whether the
// sign-in emails went out. Counts only; no names or addresses.
import { dateKeyFor } from '../src/engine/dates';
import type { Deps } from './leaderboard';

export interface SignInStats {
  /** New accounts, by how they signed in. */
  google?: number;
  email?: number;
  other?: number;
  /** Sign-ins to an account made before (another device, or after signing out). */
  returning?: number;
  /** Designed sign-in emails sent, and ones that fell back to Firebase's plain email. */
  sent?: number;
  failed?: number;
}

const key = (deps: Deps) => `signin-stats/${dateKeyFor(new Date(deps.now()))}`;

export async function countSignIn(deps: Deps, field: keyof SignInStats) {
  const stats = ((await deps.kv.get(key(deps), { type: 'json' })) as SignInStats | null) ?? {};
  stats[field] = (stats[field] ?? 0) + 1;
  await deps.kv.setJSON(key(deps), stats);
}

export const signInStatsFor = async (deps: Deps, day: string) =>
  ((await deps.kv.get(`signin-stats/${day}`, { type: 'json' })) as SignInStats | null) ?? {};

/** One summary line, or null on a day nobody signed in or asked for an email. */
export function describeSignIns(s: SignInStats): string | null {
  const created = (s.google ?? 0) + (s.email ?? 0) + (s.other ?? 0);
  const parts: string[] = [];
  if (created) {
    const how = [s.google && `${s.google} Google`, s.email && `${s.email} email`, s.other && `${s.other} other`].filter(Boolean).join(', ');
    parts.push(`${created} new account${created === 1 ? '' : 's'} (${how})`);
  }
  if (s.returning) parts.push(`${s.returning} signed back in`);
  if (s.sent || s.failed) parts.push(`${s.sent ?? 0} sign-in email${s.sent === 1 ? '' : 's'} sent${s.failed ? `, ⚠️ ${s.failed} failed (Firebase's plain email went instead)` : ''}`);
  return parts.length ? `🔑 Sign-ins today: ${parts.join(' · ')}` : null;
}
