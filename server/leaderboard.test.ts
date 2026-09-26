import { beforeEach, describe, expect, it } from 'vitest';
import { dict, seeds } from '../src/engine/node-dict';
import { generateBlitz, generateDaily } from '../src/engine/generator';
import { answerTable, blitzPoolSeed } from './tables';
import { ApiError, describePlace, finishBlitz, getBlitz, getDaily, hello, saveName, startBlitz, submitDaily, type Deps, type KV } from './leaderboard';
import { cleanName } from './names';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => structuredClone(data.get(key) ?? null),
    setJSON: async (key, value) => void data.set(key, structuredClone(value)),
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  };
}

const DATE = '2026-09-26';
const puzzle = generateDaily(dict, seeds, DATE);
const words = puzzle.answers.map((a) => a.word);
const P1 = 'player-one-aaaaaaaaaaaa';
const P2 = 'player-two-bbbbbbbbbbbb';
const POOL = [blitzPoolSeed(0), blitzPoolSeed(1)];
const boardWords = (seed: string) => generateBlitz(dict, seeds, seed).answers.map((a) => a.word);

let deps: Deps & { kv: ReturnType<typeof memoryKV> };
let sent: string[];
let clock: number;
let ids: number;
beforeEach(() => {
  clock = Date.parse(`${DATE}T15:00:00Z`);
  ids = 0;
  sent = [];
  deps = {
    notify: ({ title, message }) => void sent.push(`${title}: ${message}`),
    kv: memoryKV(),
    answers: async (key) => {
      const [kind, id] = key.split('/');
      if (kind === 'daily') return id === DATE ? answerTable(puzzle) : null;
      return POOL.includes(id) ? answerTable(generateBlitz(dict, seeds, id)) : null;
    },
    blitzSeeds: async () => POOL,
    now: () => clock,
    randomId: () => `game-${++ids}-xxxxxxxx`,
    random: () => 0,
  };
});

const rejects = async (p: Promise<unknown>, status: number) => {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ status });
};

describe('daily leaderboard', () => {
  it('scores submissions on the server and ranks players', async () => {
    const a = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 5) });
    const b = await submitDaily(deps, { playerId: P2, name: 'Bo', date: DATE, words: words.slice(0, 10) });
    expect(a.score).toBeGreaterThan(0);
    expect(b.top.map((r) => r.name)).toEqual(['Bo', 'Ann']);
    expect(b.you).toMatchObject({ name: 'Bo', position: 1, you: true });
    const board = await getDaily(deps, DATE, P1);
    expect(board.total).toBe(2);
    expect(board.you).toMatchObject({ name: 'Ann', position: 2 });
  });

  it('ignores made-up words and duplicates', async () => {
    const honest = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 3) });
    const padded = await submitDaily(deps, {
      playerId: P2, name: 'Bo', date: DATE, words: [...words.slice(0, 3), words[0], 'zzzzzz', 'qqqq'],
    });
    expect(padded.score).toBe(honest.score);
  });

  it('never lowers a saved score', async () => {
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 10) });
    const r = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 2) });
    expect(r.you!.words).toBe(10);
  });

  it('matches the scores the game itself shows', async () => {
    const r = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words });
    expect(r.score).toBe(puzzle.maxScore);
    expect(r.you!.rankName).toBe('Hexmaster');
  });

  it('rejects bad input and closed puzzles', async () => {
    await rejects(submitDaily(deps, { playerId: 'x', name: 'Ann', date: DATE, words }), 400);
    await rejects(submitDaily(deps, { playerId: P1, name: 'A', date: DATE, words }), 400);
    await rejects(submitDaily(deps, { playerId: P1, name: 'Ann', date: '2026-09-20', words }), 400);
    await rejects(submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: 'nope' }), 400);
  });
});

describe('blitz leaderboard', () => {
  it('scores a finished game against the server-issued board', async () => {
    const { game, seed } = await startBlitz(deps, { playerId: P1 });
    expect(POOL).toContain(seed);
    clock += 170_000;
    const r = await finishBlitz(deps, { playerId: P1, name: 'Ann', game, words: boardWords(seed).slice(0, 4) });
    expect(r.score).toBeGreaterThan(0);
    expect(r.personalBest).toBe(true);
    expect((await getBlitz(deps, P1)).you).toMatchObject({ name: 'Ann', position: 1 });
  });

  it('rejects late, repeated or someone else’s submissions', async () => {
    const { game } = await startBlitz(deps, { playerId: P1 });
    await rejects(finishBlitz(deps, { playerId: P2, name: 'Bo', game, words: [] }), 404);
    clock += 10 * 60_000;
    await rejects(finishBlitz(deps, { playerId: P1, name: 'Ann', game, words: [] }), 410);

    const again = await startBlitz(deps, { playerId: P1 });
    await finishBlitz(deps, { playerId: P1, name: 'Ann', game: again.game, words: [] });
    await rejects(finishBlitz(deps, { playerId: P1, name: 'Ann', game: again.game, words: [] }), 409);
  });

  it('keeps each player’s best score', async () => {
    const g1 = await startBlitz(deps, { playerId: P1 });
    await finishBlitz(deps, { playerId: P1, name: 'Ann', game: g1.game, words: boardWords(g1.seed).slice(0, 6) });
    const g2 = await startBlitz(deps, { playerId: P1 });
    const r = await finishBlitz(deps, { playerId: P1, name: 'Ann', game: g2.game, words: [] });
    expect(r.personalBest).toBe(false);
    expect(r.total).toBe(1);
    expect(r.you!.score).toBeGreaterThan(0);
  });
});

describe('names', () => {
  it('saves a valid name and rejects a bad one', async () => {
    expect(await saveName(deps, { playerId: P1, name: ' Ann ' })).toEqual({ ok: true, name: 'Ann' });
    await rejects(saveName(deps, { playerId: P1, name: '<b>' }), 400);
  });

  it('accepts normal names and trims them', () => {
    expect(cleanName('  Dan  L ')).toBe('Dan L');
    expect(cleanName('Zoë_99')).toBe('Zoë_99');
  });
  it('rejects bad names', () => {
    for (const n of ['a', 'x'.repeat(17), '<script>', '', 42, 'fuckface', 'sh1t head'.replace('1', 'i')]) {
      expect(cleanName(n)).toBeNull();
    }
  });
});

describe('notifications', () => {
  it('do nothing (and remember nobody) while notifications are off', async () => {
    const quiet = { ...deps, notify: undefined };
    await hello(quiet, { playerId: P1, mode: 'daily' });
    await hello(deps, { playerId: P1, mode: 'daily' });
    expect(sent).toEqual(['Someone is playing: A new player opened the daily puzzle · 1 player today']);
  });

  it('announce each player once a day when they open the game', async () => {
    await hello(deps, { playerId: P1, mode: 'daily' });
    await hello(deps, { playerId: P1, mode: 'daily' });
    await saveName(deps, { playerId: P2, name: 'Bo' });
    await hello(deps, { playerId: P2, mode: 'blitz' }, { city: 'Brooklyn', region: 'NY', country: 'US' });
    clock += 24 * 3600_000;
    await hello(deps, { playerId: P1, mode: 'daily' });
    expect(sent).toEqual([
      'Someone is playing: A new player opened the daily puzzle · 1 player today',
      'New player: Bo joined the leaderboard',
      'Someone is playing: Bo opened Blitz from 🇺🇸 Brooklyn, NY · 2 players today',
      'Someone is playing: A returning player (no name) opened the daily puzzle · 1 player today',
    ]);
  });

  it('announce Blitz results and a perfect daily', async () => {
    const { game, seed } = await startBlitz(deps, { playerId: P1 });
    await finishBlitz(deps, { playerId: P1, name: 'Ann', game, words: boardWords(seed).slice(0, 3) });
    await submitDaily(deps, { playerId: P2, name: 'Bo', date: DATE, words });
    expect(sent[0]).toMatch(/^Blitz finished: Ann scored \d+ \(3 words\) · personal best, #1 of 1$/);
    expect(sent[1]).toBe(`Every word found!: Bo found all ${words.length} words today (${puzzle.maxScore} pts)`);
  });
});

describe('describePlace', () => {
  it('formats a rough location with a flag', () => {
    expect(describePlace({ city: 'London', region: 'ENG', country: 'GB' })).toBe('🇬🇧 London, ENG');
    expect(describePlace({ country: 'CA' })).toBe('🇨🇦 CA');
    expect(describePlace({ city: 'Paris' })).toBe('Paris');
    expect(describePlace({})).toBeNull();
    expect(describePlace(null)).toBeNull();
  });
});
