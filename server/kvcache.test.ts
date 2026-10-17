import { describe, expect, it } from 'vitest';
import { cachedKV, type RawStore } from './kvcache';

function store() {
  const data = new Map<string, unknown>();
  const calls = { get: 0, keys: 0 };
  const raw: RawStore = {
    get: async (k) => (calls.get++, structuredClone(data.get(k))),
    put: async (k, v) => void data.set(k, structuredClone(v)),
    delete: async (k) => data.delete(k),
    keys: async (p) => (calls.keys++, [...data.keys()].filter((k) => k.startsWith(p)).sort()),
  };
  return { data, calls, raw };
}

describe('storage cache', () => {
  it('reads each value once, and lists once per prefix', async () => {
    const { raw, calls } = store();
    const kv = cachedKV(raw);
    await kv.setJSON('daily/d/b', { s: 1 });
    await kv.setJSON('daily/d/a', { s: 2 });
    for (let i = 0; i < 5; i++) {
      await kv.list({ prefix: 'daily/d/' });
      await kv.get('daily/d/a', { type: 'json' });
      await kv.get('missing', { type: 'json' });
    }
    expect(calls.keys).toBe(1);
    expect(calls.get).toBe(1); // only "missing"; the rest came from writes
  });

  it('keeps cached lists right as keys are added and removed', async () => {
    const { raw } = store();
    const kv = cachedKV(raw);
    await kv.setJSON('daily/d/b', 1);
    expect((await kv.list({ prefix: 'daily/d/' })).blobs.map((b) => b.key)).toEqual(['daily/d/b']);
    await kv.setJSON('daily/d/a', 2);
    await kv.setJSON('daily/d/c', 3);
    await kv.setJSON('daily/e/x', 4);
    await kv.setJSON('daily/d/b', null);
    expect((await kv.list({ prefix: 'daily/d/' })).blobs.map((b) => b.key)).toEqual(['daily/d/a', 'daily/d/c']);
    expect((await kv.list({ prefix: 'daily/' })).blobs.map((b) => b.key)).toEqual(['daily/d/a', 'daily/d/c', 'daily/e/x']);
    expect(await kv.get('daily/d/b', { type: 'json' })).toBeNull();
  });

  it('hands out copies, so changing one never changes what is stored', async () => {
    const { raw, data } = store();
    const kv = cachedKV(raw);
    await kv.setJSON('k', { list: [1] });
    const got = (await kv.get('k', { type: 'json' })) as { list: number[] };
    got.list.push(2);
    expect(await kv.get('k', { type: 'json' })).toEqual({ list: [1] });
    expect(data.get('k')).toEqual({ list: [1] });
  });
});
