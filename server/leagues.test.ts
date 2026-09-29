import { beforeEach, describe, expect, it } from 'vitest';
import { dict, seeds } from '../src/engine/node-dict';
import { generateDaily } from '../src/engine/generator';
import { answerTable } from './tables';
import { ApiError, deletePlayer, saveName, submitDaily, type Deps, type KV } from './leaderboard';
import { createLeague, joinLeague, leagueBoard, leagueInfo, leaveLeague, myLeagues } from './leagues';

function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => structuredClone(data.get(key) ?? null),
    setJSON: async (key, value) => void (value === null ? data.delete(key) : data.set(key, structuredClone(value))),
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  };
}

const DATE = '2026-09-28';
const puzzle = generateDaily(dict, seeds, DATE);
const words = puzzle.answers.map((a) => a.word);
const [A, B, C] = ['player-aaaaaaaaaaaaaaaa', 'player-bbbbbbbbbbbbbbbb', 'player-cccccccccccccccc'];

let deps: Deps & { kv: ReturnType<typeof memoryKV> };
let sent: string[];
let clock: number;
let seq: number;
beforeEach(async () => {
  clock = Date.parse(`${DATE}T15:00:00Z`);
  sent = [];
  seq = 0;
  deps = {
    kv: memoryKV(),
    answers: async () => answerTable(puzzle),
    blitzSeeds: async () => [],
    now: () => (clock += 1000),
    randomId: () => 'x',
    random: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280),
    notify: ({ title, message }) => void sent.push(`${title}: ${message}`),
  };
  for (const [id, name] of [[A, 'Ann'], [B, 'Bo'], [C, 'Cy']]) await saveName(deps, { playerId: id, name });
});

const rejects = async (p: Promise<unknown>, status: number) => {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await expect(p).rejects.toMatchObject({ status });
};

describe('leagues', () => {
  it('can be created, joined by id and shown to members only', async () => {
    const { id, name } = await createLeague(deps, { playerId: A, name: 'The Office' });
    expect(name).toBe('The Office');
    expect(await leagueInfo(deps, id)).toEqual({ name: 'The Office', members: 1 });
    await joinLeague(deps, { playerId: B, id });
    await joinLeague(deps, { playerId: B, id }); // twice is fine
    expect(await leagueInfo(deps, id)).toEqual({ name: 'The Office', members: 2 });
    await rejects(leagueBoard(deps, id, DATE, C), 403);
    await rejects(createLeague(deps, { playerId: A, name: 'x' }), 400);
    await rejects(createLeague(deps, { playerId: 'player-nonamexxxxxxxxxx', name: 'Mine' }), 403);
    expect(sent.some((m) => m.includes('started the league “The Office”'))).toBe(true);
    expect(sent.some((m) => m.includes('Bo joined “The Office”'))).toBe(true);
  });

  it('rank only their members, and report passes in the news', async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Family' });
    await joinLeague(deps, { playerId: B, id });
    await submitDaily(deps, { playerId: A, name: 'Ann', date: DATE, words: words.slice(0, 3) });
    await submitDaily(deps, { playerId: C, name: 'Cy', date: DATE, words: words.slice(0, 20) }); // not a member
    await submitDaily(deps, { playerId: B, name: 'Bo', date: DATE, words: words.slice(0, 10) });
    const lb = await leagueBoard(deps, id, DATE, A);
    expect(lb.board.top.map((r) => r.name)).toEqual(['Bo', 'Ann']);
    expect(lb.board.you).toMatchObject({ name: 'Ann', position: 2 });
    expect(lb.news[0].text).toMatch(/^Bo passed Ann/);
    // Ann sees that as news; Bo's own pass isn't news to Bo.
    const annLeagues = (await myLeagues(deps, A)).leagues[0];
    const boLeagues = (await myLeagues(deps, B)).leagues[0];
    expect(annLeagues.latestNews).toBeGreaterThan(boLeagues.latestNews);
  });

  it("announce yesterday's winner once the board has locked", async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Family' });
    await joinLeague(deps, { playerId: B, id });
    await submitDaily(deps, { playerId: A, name: 'Ann', date: DATE, words: words.slice(0, 3) });
    await submitDaily(deps, { playerId: B, name: 'Bo', date: DATE, words: words.slice(0, 6) });
    clock = Date.parse('2026-09-29T08:00:00Z'); // after midnight Pacific
    const lb = await leagueBoard(deps, id, '2026-09-29', A);
    expect(lb.news[0].text).toMatch(/^🏆 Bo won yesterday/);
    const again = await leagueBoard(deps, id, '2026-09-29', A);
    expect(again.news.filter((n) => n.text.includes('won yesterday'))).toHaveLength(1);
  });

  it('can be left, disappear when empty, and are left when a player deletes their data', async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Book Club' });
    await joinLeague(deps, { playerId: B, id });
    await leaveLeague(deps, { playerId: A, id });
    expect((await myLeagues(deps, A)).leagues).toEqual([]);
    expect(await leagueInfo(deps, id)).toEqual({ name: 'Book Club', members: 1 });
    await deletePlayer(deps, { playerId: B });
    await rejects(leagueInfo(deps, id), 404);
  });
});
