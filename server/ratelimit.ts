// Simple in-memory flood limits (the one Durable Object sees every request). Counted per
// minute; nothing is stored, and connections are only ever a one-way scramble, never an address.
import { ApiError } from './leaderboard';

const recent = new Map<string, number[]>();

/** Throws 429 once `key` has been seen `limit` times in the last minute. */
export function rateLimit(key: string, limit: number, now: number) {
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= limit) throw new ApiError(429, 'Slow down a little');
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 20_000) recent.clear();
}

/**
 * Per connection, across the whole API. Generous: a classroom on one school network stays far
 * below it; a script hammering the server doesn't.
 */
export const PER_CONNECTION = { GET: 1200, POST: 600 } as const;
