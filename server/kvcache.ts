// A memory cache in front of the leaderboard's storage. The one Durable Object handles every
// request in turn, so it can safely remember what it has read and written: the same
// leaderboard asked for by many players costs one read, not one per player per poll.
import type { KV } from './leaderboard';

export interface RawStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
  /** Keys starting with `prefix`, in order. */
  keys(prefix: string): Promise<string[]>;
}

/** Past this many remembered values the cache starts over (keeps memory use small). */
const MAX_VALUES = 40_000;
/** And past this many remembered key lists (every write checks each list). */
const MAX_LISTS = 2_000;

export function cachedKV(store: RawStore): KV & { stats: { reads: number; hits: number; writes: number } } {
  const values = new Map<string, unknown>(); // undefined = not cached; null = known missing
  const lists = new Map<string, string[]>();
  const stats = { reads: 0, hits: 0, writes: 0 };

  function remember(key: string, value: unknown) {
    if (values.size >= MAX_VALUES) {
      values.clear();
      lists.clear();
    }
    values.set(key, value);
  }

  /** Keep cached key lists right after a write or delete, instead of throwing them away. */
  function touchLists(key: string, exists: boolean) {
    for (const [prefix, keys] of lists) {
      if (!key.startsWith(prefix)) continue;
      let lo = 0;
      let hi = keys.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keys[mid] < key) lo = mid + 1;
        else hi = mid;
      }
      const there = keys[lo] === key;
      if (exists && !there) keys.splice(lo, 0, key);
      if (!exists && there) keys.splice(lo, 1);
    }
  }

  return {
    stats,
    async get(key) {
      stats.reads += 1;
      if (values.has(key)) {
        stats.hits += 1;
        return structuredClone(values.get(key) ?? null);
      }
      const value = (await store.get(key)) ?? null;
      remember(key, value);
      return structuredClone(value);
    },
    async setJSON(key, value) {
      stats.writes += 1;
      // Writing null deletes the key, so deleted data really is gone (and isn't listed or counted).
      if (value === null) await store.delete(key);
      else await store.put(key, value);
      remember(key, value === null ? null : structuredClone(value));
      touchLists(key, value !== null);
    },
    async list({ prefix }) {
      let keys = lists.get(prefix);
      if (!keys) {
        keys = await store.keys(prefix);
        if (lists.size >= MAX_LISTS) lists.clear();
        lists.set(prefix, keys);
      }
      return { blobs: keys.map((key) => ({ key })) };
    },
  };
}
