import { beforeEach, describe, expect, it } from 'vitest';
import { accepted, dict, full, seeds } from '../src/engine/node-dict';
import { generateBlitz, generateDaily, SECRET_BOARDS_FROM, withAnswers } from '../src/engine/generator';
import { answerTable } from './tables';
import { blitzBoard, boardSecret, catchUp, checkWord, dailyBoard, ownerAnswers, storeTables, tableKey } from './boards';
import { startBlitz, type Deps } from './leaderboard';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const DATE = '2026-10-20'; // a secret board
const daily = withAnswers(generateDaily(dict, seeds, DATE, undefined, SECRET), accepted, full);
const blitz = withAnswers(generateBlitz(dict, seeds, 'pool-0000', SECRET), accepted, full);
const P1 = 'player-one-aaaaaaaaaaaa';
const ET_MIDNIGHT = Date.parse('2026-10-20T04:00:00Z');

let deps: Deps;
let clock: number;
let data: Map<string, unknown>;
beforeEach(() => {
  clock = ET_MIDNIGHT + 3600_000;
  data = new Map();
  deps = {
    kv: {
      get: async (key) => structuredClone(data.get(key) ?? null),
      setJSON: async (key, value) => void (value === null ? data.delete(key) : data.set(key, structuredClone(value))),
      list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    },
    answers: async (key) => (key === `daily/${DATE}` ? answerTable(daily) : key === 'blitz/pool-0000' ? answerTable(blitz) : null),
    blitzSeeds: async () => ['pool-0000'],
    now: () => clock,
    randomId: () => `id-${Math.random().toString(36).slice(2)}-xxxxxxxx`,
    random: () => 0,
  };
});

describe('secret boards', () => {
  it('need the secret, and differ from what the public code alone would make', () => {
    expect(() => generateDaily(dict, seeds, SECRET_BOARDS_FROM)).toThrow(/secret/);
    const other = generateDaily(dict, seeds, DATE, undefined, 'another-secret-0123456789abcdef01234');
    expect(other.board.letters.join('')).not.toBe(daily.board.letters.join(''));
  });

  it('leave earlier boards exactly as they were', () => {
    const before = generateDaily(dict, seeds, '2026-10-11');
    expect(generateDaily(dict, seeds, '2026-10-11', undefined, SECRET).board).toEqual(before.board);
  });
});

describe('dealing boards', () => {
  it('gives letters and totals, never answers, while a board is open', async () => {
    const view = await dailyBoard(deps, DATE, P1);
    expect(view.board).toEqual(daily.board);
    expect(view.total).toBe(daily.answers.length);
    expect(view.answers).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(daily.answers.find((a) => a.word !== view.starter?.word)!.word + '"');
    const hinted = Object.values(view.hints).flatMap((r) => Object.values(r)).reduce((a, b) => a + b, 0);
    expect(hinted).toBe(daily.answers.length);
  });

  it('won’t show a board before it opens', async () => {
    clock = ET_MIDNIGHT - 60_000;
    await expect(dailyBoard(deps, DATE, P1)).rejects.toMatchObject({ status: 404 });
  });

  it('shows every answer once the board has closed', async () => {
    clock = ET_MIDNIGHT + 24 * 3600_000;
    const view = await dailyBoard(deps, DATE, P1);
    expect(view.answers!.filter((a) => !a.bonus).length).toBe(daily.answers.length);
  });

  it('includes the words the player found, so progress follows them', async () => {
    const a = daily.answers[0];
    data.set(`daily/${DATE}/${P1}`, { name: 'Ann', score: 1, words: 1, pangrams: 0, rankName: 'x', updatedAt: clock, found: [{ word: a.word, route: a.path }] });
    expect((await dailyBoard(deps, DATE, P1)).found.map((f) => f.word)).toEqual([a.word]);
  });
});

describe('checking words', () => {
  const ask = (word: string, route: number[] | null, playerId = P1) => checkWord(deps, { playerId, board: DATE, word, route });

  it('confirms an answer traced through the key tile', async () => {
    const a = daily.answers[0];
    expect(await ask(a.word, a.path)).toMatchObject({ ok: true, word: a.word, score: a.score });
  });

  it('turns down non-words and fake routes without giving anything away', async () => {
    const a = daily.answers[0];
    expect(await ask(a.word, [...a.path].reverse())).toMatchObject({ ok: false });
    expect(await ask(a.word, null)).toEqual({ ok: false, reason: 'Not on board' });
    expect(await ask('ab', [0, 1])).toEqual({ ok: false, reason: 'Too short' });
  });

  it('slows down anyone trying words faster than a person could', async () => {
    const a = daily.answers[0];
    const P2 = 'player-two-bbbbbbbbbbbb';
    for (let i = 0; i < 60; i++) await ask(a.word, a.path, P2);
    await expect(ask(a.word, a.path, P2)).rejects.toMatchObject({ status: 429 });
    clock += 61_000;
    expect(await ask(a.word, a.path, P2)).toMatchObject({ ok: true });
  });
});

describe('blitz', () => {
  it('deals the board without answers, and shows them once time is up', async () => {
    const { game, board } = await startBlitz(deps, { playerId: P1 });
    expect(board.answers).toBeUndefined();
    const a = blitz.answers[0];
    expect(await checkWord(deps, { playerId: P1, game, word: a.word, route: a.path })).toMatchObject({ ok: true });
    clock += 181_000;
    expect((await blitzBoard(deps, game, P1)).answers!.length).toBeGreaterThan(0);
    clock += 30_000;
    await expect(checkWord(deps, { playerId: P1, game, word: a.word, route: a.path })).rejects.toMatchObject({ status: 410 });
  });
});

describe('owner and build', () => {
  it('keeps one secret once made', async () => {
    const s = await boardSecret(deps);
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(await boardSecret(deps)).toBe(s);
  });

  it('stores uploaded tables, skipping unchanged ones, and refuses odd names', async () => {
    const t = answerTable(daily);
    expect(await storeTables(deps, { tables: { [`daily/${DATE}`]: t } })).toMatchObject({ stored: 1 });
    expect(await storeTables(deps, { tables: { [`daily/${DATE}`]: t } })).toMatchObject({ stored: 0 });
    expect(data.get(tableKey(`daily/${DATE}`))).toEqual(t);
    await expect(storeTables(deps, { tables: { 'players/x': {} } })).rejects.toMatchObject({ status: 400 });
  });

  it('lists a board’s answers for the owner', async () => {
    const text = await ownerAnswers(deps, DATE);
    expect(text).toContain(`${daily.answers.length} words`);
    expect(text).toContain(daily.answers[0].word);
  });
});

describe('catching up', () => {
  it('confirms words already on a device, once, and only real ones', async () => {
    const [a, b] = daily.answers;
    const r = await catchUp(deps, { playerId: P1, board: DATE, words: [{ w: a.word, p: a.path }, b.word, 'notaword', { w: b.word, p: [0, 1, 2, 3] }] });
    expect(r.words.map((w) => w.word).sort()).toEqual([a.word, b.word].sort());
    expect((await catchUp(deps, { playerId: P1, board: DATE, words: [a.word] })).words).toEqual([]);
  });
});
