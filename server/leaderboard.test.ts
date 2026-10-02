import { beforeEach, describe, expect, it } from 'vitest';
import { dict, seeds } from '../src/engine/node-dict';
import { generateBlitz, generateDaily } from '../src/engine/generator';
import { answerTable, blitzPoolSeed } from './tables';
import { findPaths } from '../src/engine/solver';
import { scorePath } from '../src/engine/scoring';
import { ApiError, claimName, deletePlayer, lostCode, setCode, ownerMessageSeen, describeFunnel, describePlace, funnelFor, recordEvent, moderateName, reportName, finishBlitz, getBlitz, getDaily, hello, me, progressOf, saveName, startBlitz, submitDaily, type Deps, type KV } from './leaderboard';
import { cleanName } from './names';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => structuredClone(data.get(key) ?? null),
    setJSON: async (key, value) => void (value === null ? data.delete(key) : data.set(key, structuredClone(value))),
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
    randomId: () => `game-${++ids}-xxxxxxxxxxxx`,
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
    expect(r.you!.rankName).toBe('Key to the City');
  });

  it('scores each word along the route it was traced, and never rewards a fake route', async () => {
    const multi = puzzle.answers.find((a) => {
      const scores = findPaths(a.word, puzzle.board, { requireCenter: true }).map((r) => scorePath(r, puzzle.board).score);
      return Math.min(...scores) < a.score;
    })!;
    const weaker = findPaths(multi.word, puzzle.board, { requireCenter: true }).find(
      (r) => scorePath(r, puzzle.board).score < multi.score,
    )!;
    const traced = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: [{ w: multi.word, p: weaker }] });
    expect(traced.score).toBe(scorePath(weaker, puzzle.board).score);
    const best = await submitDaily(deps, { playerId: P2, name: 'Bo', date: DATE, words: [{ w: multi.word, p: multi.path }] });
    expect(best.score).toBe(multi.score);
    const fake = await submitDaily(deps, { playerId: 'player-three-cccccccccc', name: 'Cy', date: DATE, words: [{ w: multi.word, p: [0, 1, 2, 3] }] });
    expect(fake.score).toBe(0);
  });

  it('rejects bad input and closed puzzles', async () => {
    await rejects(submitDaily(deps, { playerId: 'x', name: 'Ann', date: DATE, words }), 400);
    await rejects(submitDaily(deps, { playerId: P1, name: 'A', date: DATE, words }), 400);
    await rejects(submitDaily(deps, { playerId: P1, name: 'Ann', date: '2026-09-20', words }), 400);
    await rejects(submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: 'nope' }), 400);
  });

  it('takes scores until the day has ended everywhere, then locks', async () => {
    const at = (iso: string) => (clock = Date.parse(iso));
    at(`${DATE}T00:00:00Z`);
    clock -= 15 * 3600_000; // before the date has started anywhere
    await rejects(submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words }), 400);
    at('2026-09-25T10:30:00Z'); // already the 26th in Kiribati (UTC+14)
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 2) });
    at('2026-09-27T06:59:00Z'); // 11:59 PM Pacific on the 26th
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 3) });
    at('2026-09-27T07:00:00Z'); // locked: midnight Pacific
    await rejects(submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words }), 400);
    expect((await getDaily(deps, DATE, P1)).you!.words).toBe(3);
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
    expect(await saveName(deps, { playerId: P1, name: ' Ann ' })).toMatchObject({ ok: true, name: 'Ann' });
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
    expect(sent).toEqual(['New player!: A new player opened the daily puzzle for the first time · 1 player today']);
  });

  it('announce each player once a day when they open the game', async () => {
    await hello(deps, { playerId: P1, mode: 'daily' });
    await hello(deps, { playerId: P1, mode: 'daily' });
    await saveName(deps, { playerId: P2, name: 'Bo' });
    await hello(deps, { playerId: P2, mode: 'blitz' }, { city: 'Brooklyn', region: 'NY', country: 'US' });
    clock += 24 * 3600_000;
    await hello(deps, { playerId: P1, mode: 'daily' });
    expect(sent).toEqual([
      'New player!: A new player opened the daily puzzle for the first time · 1 player today',
      'Joined the leaderboard: Bo picked their leaderboard name',
      'New player!: Bo opened Blitz from 🇺🇸 Brooklyn, NY for the first time · 2 players today',
      'Someone is playing: A returning player (no name) is back for day 2 · opened the daily puzzle · 1 player today',
    ]);
  });

  it('use the nickname saved on the device when the server has not heard it yet', async () => {
    await hello(deps, { playerId: P1, mode: 'daily', name: 'Castle' });
    expect(sent).toEqual(['New player!: Castle opened the daily puzzle for the first time · 1 player today']);
    expect(await deps.kv.get(`players/${P1}`, { type: 'json' })).toEqual({ name: 'Castle' });
  });

  it('announce Blitz results and a perfect daily', async () => {
    const { game, seed } = await startBlitz(deps, { playerId: P1 });
    await finishBlitz(deps, { playerId: P1, name: 'Ann', game, words: boardWords(seed).slice(0, 3) });
    await submitDaily(deps, { playerId: P2, name: 'Bo', date: DATE, words });
    expect(sent[0]).toMatch(/^Blitz finished: Ann scored \d+ \(3 words\) · personal best, #1 of 1$/);
    expect(sent[1]).toBe(`Key to the City!: Bo found all ${words.length} words today (${puzzle.maxScore} pts)`);
  });
});

describe('daily pings follow the player', () => {
  it('ping again on each new local day, counting the days', async () => {
    await hello(deps, { playerId: P1, name: 'Castle', date: '2026-09-26' });
    await hello(deps, { playerId: P1, name: 'Castle', date: '2026-09-26' });
    clock += 24 * 3600_000;
    await hello(deps, { playerId: P1, name: 'Castle', date: '2026-09-27' });
    clock += 24 * 3600_000;
    await hello(deps, { playerId: P1, name: 'Castle', date: '2026-09-28' });
    expect(sent).toEqual([
      'New player!: Castle opened the daily puzzle for the first time · 1 player today',
      'Someone is playing: Castle is back for day 2 · opened the daily puzzle · 1 player today',
      'Someone is playing: Castle is back for day 3 · opened the daily puzzle · 1 player today',
    ]);
  });

  it('use the local date when it is within a day of UTC, and ignore anything else', async () => {
    // 9pm in New York is already tomorrow in UTC: the player's own date wins.
    await hello(deps, { playerId: P1, date: '2026-09-26' });
    await hello(deps, { playerId: P1, date: '2026-09-27' });
    await hello(deps, { playerId: P1, date: '2030-01-01' });
    expect(sent).toHaveLength(2);
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

describe('names as logins', () => {
  it('give each new name a PIN and keep names unique', async () => {
    const r = await saveName(deps, { playerId: P1, name: 'Castle' });
    expect(r.pin).toMatch(/^\d{4}$/);
    await rejects(saveName(deps, { playerId: P2, name: 'castle' }), 409);
    expect(await me(deps, P1)).toMatchObject({ name: 'Castle', pin: r.pin });
  });

  it('let a player continue on another device with their name and chosen code, and restore their words', async () => {
    await saveName(deps, { playerId: P1, name: 'Castle' });
    await setCode(deps, { playerId: P1, code: '4719' });
    const [a, b] = puzzle.answers;
    await submitDaily(deps, { playerId: P1, name: 'Castle', date: DATE, words: [{ w: a.word, p: a.path }, b.word] });
    const claimed = await claimName(deps, { name: 'castle', code: '4719' });
    expect(claimed).toMatchObject({ playerId: P1, name: 'Castle', pin: '4719' });
    const { found } = await progressOf(deps, DATE, claimed.playerId);
    expect(found).toEqual([{ w: a.word, p: a.path }, b.word]);
    await rejects(claimName(deps, { name: 'Nobody', code: '4719' }), 404);
  });

  it('reset: codes made up automatically stop working, and the player is asked to choose one', async () => {
    const { pin } = await saveName(deps, { playerId: P1, name: 'Castle' });
    expect(await me(deps, P1)).toMatchObject({ pin, codeChosen: false });
    await rejects(claimName(deps, { name: 'Castle', code: pin }), 403);
    await setCode(deps, { playerId: P1, code: '4719' });
    expect(await me(deps, P1)).toMatchObject({ pin: '4719', codeChosen: true });
    expect((await claimName(deps, { name: 'Castle', code: '4719' })).playerId).toBe(P1);
  });

  it('keep a chosen code when the player changes their name', async () => {
    await saveName(deps, { playerId: P1, name: 'Castle' });
    await setCode(deps, { playerId: P1, code: '4719' });
    await saveName(deps, { playerId: P1, name: 'Tower' });
    expect(await me(deps, P1)).toMatchObject({ name: 'Tower', pin: '4719', codeChosen: true });
    expect((await claimName(deps, { name: 'tower', code: '4719' })).playerId).toBe(P1);
    await rejects(claimName(deps, { name: 'Castle', code: '4719' }), 404);
  });

  it('refuse a claim without the right code, and pause after five wrong tries', async () => {
    await saveName(deps, { playerId: P1, name: 'Castle' });
    await setCode(deps, { playerId: P1, code: '4719' });
    await rejects(claimName(deps, { name: 'Castle' }), 403);
    for (let i = 0; i < 4; i++) await rejects(claimName(deps, { name: 'Castle', code: '1234' }), 403);
    expect(sent.some((m) => m.startsWith('Wrong codes'))).toBe(true);
    await rejects(claimName(deps, { name: 'Castle', code: '4719' }), 429);
    clock += 61 * 60 * 1000;
    expect((await claimName(deps, { name: 'Castle', code: '4719' })).playerId).toBe(P1);
  });

  it('give names from before codes a code, and a code the owner sends works', async () => {
    await deps.kv.setJSON(`players/${P1}`, { name: 'Dcl' });
    await rejects(saveName(deps, { playerId: P2, name: 'DCL' }), 409);
    const { pin } = await me(deps, P1);
    expect(pin).toMatch(/^\d{4}$/);
    await rejects(claimName(deps, { name: 'dcl', code: pin! }), 403);
    const { code } = await moderateName(deps, { name: 'Dcl', action: 'send code' });
    expect(code).toBe(pin);
    expect((await claimName(deps, { name: 'dcl', code: pin! })).playerId).toBe(P1);
  });

  it('pick the real player when two pre-PIN players share a name', async () => {
    // The original Dcl played; later a fresh browser picked "Dcl" again with nothing found.
    await submitDaily(deps, { playerId: P1, name: 'Dcl', date: DATE, words: words.slice(0, 5) });
    await deps.kv.setJSON(`players/${P2}`, { name: 'Dcl' });
    await setCode(deps, { playerId: P1, code: '4719' });
    const claimed = await claimName(deps, { name: 'dcl', code: '4719' });
    expect(claimed.playerId).toBe(P1);
    expect((await progressOf(deps, DATE, P1)).found).toHaveLength(5);
  });

  it('tell the owner when someone lost their code', async () => {
    await saveName(deps, { playerId: P1, name: 'Castle' });
    sent = [];
    await lostCode(deps, { name: 'castle' });
    expect(sent.filter((m) => m.startsWith('Lost code'))).toHaveLength(1);
    await rejects(lostCode(deps, { name: 'Nobody' }), 404);
  });

  it('let a player pick their own code, but not an easy one', async () => {
    await saveName(deps, { playerId: P1, name: 'Lisa' });
    await rejects(setCode(deps, { playerId: P1, code: '12' }), 400);
    for (const easy of ['1111', '1234', '9876']) await rejects(setCode(deps, { playerId: P1, code: easy }), 400);
    await rejects(setCode(deps, { playerId: P2, code: '4719' }), 403); // no name yet
    expect(await setCode(deps, { playerId: P1, code: '4719' })).toMatchObject({ pin: '4719' });
    expect(await me(deps, P1)).toMatchObject({ pin: '4719' });
    expect((await claimName(deps, { name: 'lisa', code: '4719' })).playerId).toBe(P1);
  });

  it('let the owner choose the code', async () => {
    await saveName(deps, { playerId: P1, name: 'Lisa' });
    await rejects(moderateName(deps, { name: 'Lisa', action: 'give back', code: '70' }), 400);
    expect(await moderateName(deps, { name: 'Lisa', action: 'give back', code: '7070' })).toMatchObject({ code: '7070' });
    expect((await claimName(deps, { name: 'lisa', code: '7070' })).playerId).not.toBe(P1);
    expect(await moderateName(deps, { name: 'Lisa', action: 'send code', code: '1234' })).toMatchObject({ code: '1234' });
    await rejects(claimName(deps, { name: 'Lisa', code: '7070' }), 403);
  });

  it('let the owner send a code or give an account back after a takeover', async () => {
    const { pin } = await saveName(deps, { playerId: P1, name: 'Castle' });
    expect(await moderateName(deps, { name: 'castle', action: 'send code' })).toMatchObject({ code: pin });
    await submitDaily(deps, { playerId: P1, name: 'Castle', date: DATE, words: words.slice(0, 3) });
    deps.random = () => 0.5;
    const back = await moderateName(deps, { name: 'Castle', action: 'give back' });
    expect(back.code).toBe('5000');
    // The old id (and whoever had it) no longer owns anything.
    expect(await me(deps, P1)).toMatchObject({ name: null });
    await rejects(claimName(deps, { name: 'Castle', code: pin }), 403);
    const claimed = await claimName(deps, { name: 'Castle', code: '5000' });
    expect(claimed.playerId).not.toBe(P1);
    expect((await progressOf(deps, DATE, claimed.playerId)).found).toHaveLength(3);
    const board = await getDaily(deps, DATE, claimed.playerId);
    expect(board.you).toMatchObject({ name: 'Castle', words: 3 });
    expect(board.total).toBe(1);
  });
});

describe('day-one fixes', () => {
  it('never shows two players under the same name', async () => {
    await submitDaily(deps, { playerId: P1, name: 'EmBar', date: DATE, words: words.slice(0, 3) });
    // Another device that kept "EmBar" locally (e.g. saved while offline) can't post as EmBar.
    await rejects(submitDaily(deps, { playerId: P2, name: 'embar', date: DATE, words: words.slice(0, 2) }), 409);
    const game = await startBlitz(deps, { playerId: P2 });
    await rejects(finishBlitz(deps, { playerId: P2, name: 'EmBar', game: game.game, words: [] }), 409);
    const board = await getDaily(deps, DATE, null);
    expect(board.top.filter((r) => r.name.toLowerCase() === 'embar')).toHaveLength(1);
    // The rightful owner keeps posting, and picking the name registered it.
    await submitDaily(deps, { playerId: P1, name: 'EmBar', date: DATE, words: words.slice(0, 4) });
    await rejects(saveName(deps, { playerId: P2, name: 'EmBar' }), 409);
  });

  it('gives the top rank to anyone who finds every word, whatever route they used', async () => {
    // Every word typed with a bogus route scores low, but it's still every word.
    const all = puzzle.answers.map((a) => ({ w: a.word, p: [...a.path].reverse() }));
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: all });
    const board = await getDaily(deps, DATE, P1);
    expect(board.you!.score).toBeLessThan(puzzle.maxScore);
    expect(board.you!.rankName).toBe('Key to the City');
  });
});

describe('privacy and moderation', () => {
  it('deletes everything about a player', async () => {
    await saveName(deps, { playerId: P1, name: 'Castle' });
    await submitDaily(deps, { playerId: P1, name: 'Castle', date: DATE, words: words.slice(0, 3) });
    await submitDaily(deps, { playerId: P2, name: 'Bo', date: DATE, words: words.slice(0, 2) });
    await hello(deps, { playerId: P1, mode: 'daily', date: DATE });
    await deletePlayer(deps, { playerId: P1 });
    expect([...deps.kv.data.keys()].filter((k) => k.includes(P1))).toEqual([]);
    expect((await getDaily(deps, DATE, null)).top.map((r) => r.name)).toEqual(['Bo']);
    // The name is free again.
    expect((await saveName(deps, { playerId: P2, name: 'Castle' })).name).toBe('Castle');
  });

  it('tells the owner right away when a name is reported, once per reporter', async () => {
    await reportName(deps, { playerId: P1, name: 'Rude' });
    await reportName(deps, { playerId: P1, name: 'Rude' });
    await reportName(deps, { playerId: P2, name: 'rude' });
    expect(sent.filter((m) => m.startsWith('Name reported'))).toHaveLength(2);
    expect(sent.at(-1)).toContain('2 reports');
  });

  it('lets the owner rename an offensive name everywhere, keeping the scores', async () => {
    await submitDaily(deps, { playerId: P1, name: 'Rude', date: DATE, words: words.slice(0, 3) });
    const before = (await getDaily(deps, DATE, P1)).you!.score;
    const r = await moderateName(deps, { name: 'rude' });
    expect(r.name).toMatch(/^Player \d{4}$/);
    const you = (await getDaily(deps, DATE, P1)).you!;
    expect(you).toMatchObject({ name: r.name, score: before });
    expect(await me(deps, P1)).toMatchObject({ name: r.name });
    expect((await saveName(deps, { playerId: P2, name: 'Rude' })).name).toBe('Rude');
    await moderateName(deps, { name: r.name, to: 'Nice' });
    expect((await getDaily(deps, DATE, P1)).you!.name).toBe('Nice');
  });
});

describe('bonus words', () => {
  it('score, but finding every counted word is enough for the top rank', async () => {
    const { accepted, full } = await import('../src/engine/node-dict');
    const { withAnswers } = await import('../src/engine/generator');
    const wide = withAnswers(puzzle, accepted, full);
    expect(wide.bonus!.length).toBeGreaterThan(0);
    deps.answers = async () => answerTable(wide);
    const main = wide.answers.map((a) => ({ w: a.word, p: a.path }));
    const bonus = wide.bonus![0];
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: main.slice(0, -1) });
    expect((await getDaily(deps, DATE, P1)).you!.rankName).not.toBe('Key to the City');
    // A bonus word adds points but doesn't complete the board...
    const r1 = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: [...main.slice(0, -1), { w: bonus.word, p: bonus.path }] });
    expect(r1.you!.words).toBe(main.length);
    expect(r1.you!.rankName).not.toBe('Key to the City');
    // ...every counted word does.
    const r2 = await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: [...main, { w: bonus.word, p: bonus.path }] });
    expect(r2.you!.rankName).toBe('Key to the City');
    expect(r2.score).toBeGreaterThan(wide.maxScore);
    expect(sent.filter((m) => m.includes('found all')).at(-1)).toContain(`found all ${wide.answers.length} words`);
  });
});

describe('streaks', () => {
  it('count consecutive days with a word found, and reset after a gap', async () => {
    const tables: Record<string, ReturnType<typeof answerTable>> = {};
    const day = (d: string) => (tables[d] ??= answerTable(generateDaily(dict, seeds, d)));
    deps.answers = async (key) => day(key.split('/')[1]);
    const play = async (d: string) => {
      clock = Date.parse(`${d}T15:00:00Z`);
      const w = day(d);
      return (await submitDaily(deps, { playerId: P1, name: 'Ann', date: d, words: Object.keys(w.words).slice(0, 1) })).streak;
    };
    expect(await play('2026-09-26')).toMatchObject({ count: 1, best: 1 });
    expect(await play('2026-09-26')).toMatchObject({ count: 1 }); // same day again
    expect(await play('2026-09-27')).toMatchObject({ count: 2 });
    expect(await play('2026-09-28')).toMatchObject({ count: 3, best: 3 });
    expect(await play('2026-09-30')).toMatchObject({ count: 1, best: 3, last: '2026-09-30' }); // missed the 29th
    expect((await me(deps, P1)).streak).toMatchObject({ count: 1, best: 3 });
  });
});

describe('onboarding funnel', () => {
  it('counts opened, found a word, on the leaderboard and came back', async () => {
    const P3 = 'player-three-cccccccccc';
    await hello(deps, { playerId: P1, mode: 'daily', date: '2026-09-25' }); // P1 played the day before
    for (const p of [P1, P2, P3]) await hello(deps, { playerId: p, mode: 'daily', date: DATE });
    await recordEvent(deps, { playerId: P1, kind: 'first-word', date: DATE });
    await recordEvent(deps, { playerId: P2, kind: 'first-word', date: DATE });
    await recordEvent(deps, { playerId: P2, kind: 'first-word', date: DATE });
    // Players post to the day's board id (this day was rerolled, so it's "2026-09-26~v1").
    deps.answers = async () => answerTable(puzzle);
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: `${DATE}~v1`, words: words.slice(0, 2) });
    const f = await funnelFor(deps, DATE);
    expect(f).toEqual({ day: DATE, opened: 3, foundWord: 2, onLeaderboard: 1, cameBack: 1 });
    expect(describeFunnel(f)).toBe('📊 3 opened → 2 found a word → 1 on the leaderboard · 1 came back from yesterday');
    await rejects(recordEvent(deps, { playerId: P1, kind: 'nope', date: DATE }), 400);
  });
});

describe('streaks from history', () => {
  const tables: Record<string, ReturnType<typeof answerTable>> = {};
  const day = (d: string) => (tables[d] ??= answerTable(generateDaily(dict, seeds, d)));
  const play = async (id: string, name: string, d: string) => {
    clock = Date.parse(`${d}T15:00:00Z`);
    await submitDaily(deps, { playerId: id, name, date: d, words: Object.keys(day(d).words).slice(0, 1) });
  };
  beforeEach(() => {
    deps.answers = async (key) => day(key.split('/')[1]);
  });

  it('count every day played, including days from before streaks were tracked', async () => {
    for (const d of ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']) await play(P1, 'Ann', d);
    // Streaks only started being kept on the 29th: the old record says 1 day.
    await deps.kv.setJSON(`streak/${P1}`, { count: 1, best: 1, last: '2026-09-29' });
    expect(await me(deps, P1)).toMatchObject({ streak: { count: 4, best: 4, last: '2026-09-29' } });
    await play(P1, 'Ann', '2026-09-30');
    expect((await me(deps, P1)).streak).toMatchObject({ count: 5, last: '2026-09-30' });
  });

  it('start over after a missed day, keeping the best', async () => {
    for (const d of ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-30', '2026-10-01']) await play(P1, 'Ann', d);
    await deps.kv.setJSON(`streak/${P1}`, null);
    expect((await me(deps, P1)).streak).toMatchObject({ count: 2, best: 3 });
  });

  it('keep streaks and player ids off everyone’s leaderboard rows', async () => {
    await play(P1, 'Ann', '2026-09-28');
    await play(P2, 'Bo', '2026-09-28');
    const board = await getDaily(deps, '2026-09-28', P1);
    expect(board.top[0]).not.toHaveProperty('streak');
    expect(JSON.stringify(board)).not.toContain(P2);
  });
});

describe('owner tools', () => {
  it('block a player: hidden from everyone else, still visible to themselves, and unblock', async () => {
    await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: words.slice(0, 2) });
    await submitDaily(deps, { playerId: P2, name: 'Poop', date: DATE, words: words.slice(0, 5) });
    await moderateName(deps, { name: 'poop', action: 'block' });
    expect((await getDaily(deps, DATE, P1)).top.map((r) => r.name)).toEqual(['Ann']);
    expect((await getDaily(deps, DATE, P2)).top.map((r) => r.name)).toEqual(['Poop', 'Ann']);
    await moderateName(deps, { name: 'Poop', action: 'unblock' });
    expect((await getDaily(deps, DATE, P1)).total).toBe(2);
  });

  it('check play: flag a player who pastes a solver list, and stay quiet about normal play', async () => {
    const answers = words.filter((w) => !answerTable(puzzle).words[w][2]);
    // A normal player: a handful of words, in no particular order, a few minutes apart, with misses.
    const normal = [answers[7], answers[2], answers[11], answers[0], answers[5]];
    for (const [i, w] of normal.entries()) {
      clock += 3 * 60000;
      await submitDaily(deps, { playerId: P1, name: 'Ann', date: DATE, words: normal.slice(0, i + 1), misses: i * 2 });
    }
    // The suspect: the whole board, alphabetically, in one go, never a miss.
    clock += 60000;
    const sorted = [...answers].sort();
    await submitDaily(deps, { playerId: P2, name: 'Fart', date: DATE, words: sorted.slice(0, 20), misses: 0 });
    clock += 30000;
    await submitDaily(deps, { playerId: P2, name: 'Fart', date: DATE, words: sorted, misses: 0 });
    const { report } = await moderateName(deps, { name: 'fart', action: 'check play' });
    expect(report).toContain('alphabetical order');
    expect(report).toContain('within one minute');
    expect(report).toContain('almost never enters a wrong word');
    expect(report).not.toContain(P2);
    const ann = (await moderateName(deps, { name: 'Ann', action: 'check play' })).report;
    expect(ann).toContain('Nothing unusual found.');
    expect(ann).toContain('Tries that didn’t count'.replace('’', "'"));
  });

  it('send a player a message they see once', async () => {
    await saveName(deps, { playerId: P1, name: 'Fart' });
    await rejects(moderateName(deps, { name: 'fart', action: 'message', text: '  ' }), 400);
    await moderateName(deps, { name: 'fart', action: 'message', text: 'Cheating is the lowest of lows.' });
    expect((await me(deps, P1)).ownerMessage).toMatchObject({ text: 'Cheating is the lowest of lows.' });
    await ownerMessageSeen(deps, { playerId: P1 });
    expect((await me(deps, P1)).ownerMessage).toBeNull();
  });

  it('remember where a player last played from, and ping the owner when a blocked player comes back', async () => {
    await saveName(deps, { playerId: P2, name: 'Fart' });
    await moderateName(deps, { name: 'fart', action: 'block' });
    sent = [];
    await hello(deps, { playerId: P2, date: DATE }, { city: 'Denver', region: 'CO', country: 'US' });
    expect(sent.some((m) => m.startsWith('Blocked player is back') && m.includes('Denver, CO'))).toBe(true);
    const { report } = await moderateName(deps, { name: 'fart', action: 'look up' });
    expect(report).toContain('Last seen from: 🇺🇸 Denver, CO');
  });

  it('look a player up without ever including ids or addresses', async () => {
    await submitDaily(deps, { playerId: P2, name: 'Whyyy', date: DATE, words: words.slice(0, 3) });
    await reportName(deps, { playerId: P1, name: 'Whyyy' });
    const { report } = await moderateName(deps, { name: 'whyyy', action: 'look up' });
    expect(report).toContain('Whyyy');
    expect(report).toContain(`First board played: ${DATE}`);
    expect(report).toContain('Reported: 1 time');
    expect(report).not.toContain(P2);
  });

  it('pass a locked-out player’s note to the owner, a few times a day at most', async () => {
    await saveName(deps, { playerId: P1, name: 'Castle' });
    sent = [];
    for (let i = 0; i < 5; i++) await lostCode(deps, { name: 'castle', note: 'it’s Dan from work' });
    expect(sent).toHaveLength(3);
    expect(sent[0]).toContain('They say: “it’s Dan from work”');
  });
});
