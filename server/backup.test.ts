import { describe, expect, it } from 'vitest';
import { exportPage, importEntries, type BackupStore } from './backup';

function store(data = new Map<string, unknown>()): BackupStore & { data: Map<string, unknown> } {
  return {
    data,
    list: async ({ startAfter, limit }) => {
      const keys = [...data.keys()].sort().filter((k) => !startAfter || k > startAfter).slice(0, limit);
      return new Map(keys.map((k) => [k, structuredClone(data.get(k))]));
    },
    put: async (entries) => {
      if (Object.keys(entries).length > 128) throw new Error('too many keys in one write');
      for (const [k, v] of Object.entries(entries)) data.set(k, structuredClone(v));
    },
  };
}

describe('backups', () => {
  it('export everything page by page (not the answer tables), and restore it exactly', async () => {
    const from = store();
    for (let i = 0; i < 2500; i++) from.data.set(`daily/2026-10-17/p${String(i).padStart(5, '0')}`, { score: i, found: [{ word: 'x' }] });
    from.data.set('board-secret', 'abc');
    from.data.set('tables/daily/2026-10-17', { maxScore: 1 });
    const backup: Record<string, unknown> = {};
    let after: string | null = null;
    let pages = 0;
    do {
      const page: { entries: Record<string, unknown>; next: string | null } = await exportPage(from, after, 1000);
      Object.assign(backup, page.entries);
      after = page.next;
      pages++;
    } while (after);
    expect(pages).toBe(3);
    expect(Object.keys(backup).length).toBe(2501);
    expect(backup['tables/daily/2026-10-17']).toBeUndefined();

    const to = store();
    expect(await importEntries(to, backup)).toEqual({ ok: true, restored: 2501 });
    expect(to.data.get('daily/2026-10-17/p01234')).toEqual({ score: 1234, found: [{ word: 'x' }] });
    expect(to.data.get('board-secret')).toBe('abc');
  });
});
