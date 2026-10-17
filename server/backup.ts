// Backups: the owner-only export the nightly Backup workflow saves (encrypted), and the import
// that puts a backup back. Everything is copied except the answer tables, which the build
// re-uploads anyway. Works page by page so memory stays small however big the game gets.

/** The parts of Durable Object storage a backup needs. */
export interface BackupStore {
  list(opts: { startAfter?: string; limit: number }): Promise<Map<string, unknown>>;
  put(entries: Record<string, unknown>): Promise<void>;
}

const SKIP = 'tables/';
const MAX_PAGE = 1000;

/** One page of everything, in key order, from just after `after`. `next` is null at the end. */
export async function exportPage(store: BackupStore, after: string | null, limit = MAX_PAGE) {
  const size = Math.min(Math.max(1, limit), MAX_PAGE);
  const page = await store.list({ ...(after ? { startAfter: after } : {}), limit: size });
  const entries: Record<string, unknown> = {};
  let last: string | null = null;
  for (const [key, value] of page) {
    last = key;
    if (!key.startsWith(SKIP)) entries[key] = value;
  }
  return { entries, next: page.size === size ? last : null };
}

/** Puts entries from a backup back (Durable Objects take at most 128 keys per write). */
export async function importEntries(store: BackupStore, entries: Record<string, unknown>) {
  const keys = Object.keys(entries).filter((k) => !k.startsWith(SKIP));
  for (let i = 0; i < keys.length; i += 100) {
    await store.put(Object.fromEntries(keys.slice(i, i + 100).map((k) => [k, entries[k]])));
  }
  return { ok: true, restored: keys.length };
}
