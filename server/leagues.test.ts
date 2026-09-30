import { beforeEach, describe, expect, it } from 'vitest';
import { dict, seeds } from '../src/engine/node-dict';
import { generateDaily } from '../src/engine/generator';
import { answerTable } from './tables';
import { ApiError, deletePlayer, saveName, submitDaily, type Deps, type KV } from './leaderboard';
import {
  createLeague, movePlayerInLeagues, deleteChat, deleteLeague, getChat, joinLeague, leagueBoard, leagueInfo, leaveLeague, myLeagues, postChat, publicLeagues, reportChat,
  setLeaguePublic,
} from './leagues';

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
    expect(await leagueInfo(deps, id)).toEqual({ name: 'The Office', members: 1, public: false });
    await joinLeague(deps, { playerId: B, id });
    await joinLeague(deps, { playerId: B, id }); // twice is fine
    expect(await leagueInfo(deps, id)).toEqual({ name: 'The Office', members: 2, public: false });
    await rejects(leagueBoard(deps, id, DATE, C), 403);
    await rejects(createLeague(deps, { playerId: A, name: 'x' }), 400);
    await rejects(createLeague(deps, { playerId: 'player-nonamexxxxxxxxxx', name: 'Mine' }), 403);
    expect(sent.some((m) => m.includes('started the private room “The Office”'))).toBe(true);
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
    expect(await leagueInfo(deps, id)).toEqual({ name: 'Book Club', members: 1, public: false });
    await deletePlayer(deps, { playerId: B });
    await rejects(leagueInfo(deps, id), 404);
  });
});

describe('public rooms', () => {
  it('are listed for anyone to join, private ones are not, and only the host can switch', async () => {
    const pub = await createLeague(deps, { playerId: A, name: 'Word Nerds', public: true });
    const priv = await createLeague(deps, { playerId: A, name: 'Secret Club' });
    await joinLeague(deps, { playerId: B, id: pub.id });
    const list = (await publicLeagues(deps, C)).rooms;
    expect(list).toEqual([{ id: pub.id, name: 'Word Nerds', members: 2, joined: false }]);
    expect((await publicLeagues(deps, B)).rooms[0].joined).toBe(true);
    await rejects(setLeaguePublic(deps, { playerId: B, id: priv.id, public: true }), 403);
    await setLeaguePublic(deps, { playerId: A, id: priv.id, public: true });
    expect((await publicLeagues(deps, C)).rooms.map((r) => r.name)).toEqual(['Word Nerds', 'Secret Club']);
  });
});

describe('deleting a room', () => {
  it('is for the host only, and removes it for every member', async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Family' });
    await joinLeague(deps, { playerId: B, id });
    await rejects(deleteLeague(deps, { playerId: B, id }), 403);
    await deleteLeague(deps, { playerId: A, id });
    await rejects(leagueInfo(deps, id), 404);
    expect((await myLeagues(deps, A)).leagues).toEqual([]);
    expect((await myLeagues(deps, B)).leagues).toEqual([]);
  });
});

describe('room chat', () => {
  it('is for members, masks offensive words, limits speed, and shows no player ids', async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Family' });
    await joinLeague(deps, { playerId: B, id });
    const { message } = await postChat(deps, { playerId: A, id, text: '  hello   everyone ' });
    expect(message).toMatchObject({ name: 'Ann', text: 'hello everyone', mine: true });
    await rejects(postChat(deps, { playerId: A, id, text: 'again!' }), 429);
    clock += 3000;
    const masked = await postChat(deps, { playerId: A, id, text: 'what the shit' });
    expect(masked.message.text).toBe('what the ••••');
    await rejects(postChat(deps, { playerId: C, id, text: 'let me in' }), 403);
    await rejects(postChat(deps, { playerId: B, id, text: '   ' }), 400);
    await rejects(postChat(deps, { playerId: B, id, text: 'x'.repeat(301) }), 400);
    const seen = await getChat(deps, id, B);
    expect(seen.messages.map((m) => [m.name, m.mine])).toEqual([['Ann', false], ['Ann', false]]);
    expect(JSON.stringify(seen)).not.toContain(A);
    // Unread for Bo, not for Ann.
    const [ann] = (await myLeagues(deps, A)).leagues;
    const [bo] = (await myLeagues(deps, B)).leagues;
    expect(ann.latestChat).toBe(0);
    expect(bo.latestChat).toBeGreaterThan(0);
  });

  it('lets people delete their own messages, the host delete any, and report to the owner', async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Family' });
    await joinLeague(deps, { playerId: B, id });
    await joinLeague(deps, { playerId: C, id });
    const bo = (await postChat(deps, { playerId: B, id, text: 'hi from Bo' })).message;
    const cy = (await postChat(deps, { playerId: C, id, text: 'rude thing' })).message;
    await rejects(deleteChat(deps, { playerId: B, id, message: cy.id }), 403);
    await reportChat(deps, { playerId: B, id, message: cy.id });
    expect(sent.at(-1)).toContain('Cy wrote: “rude thing”');
    await deleteChat(deps, { playerId: A, id, message: cy.id }); // host
    await deleteChat(deps, { playerId: B, id, message: bo.id }); // own
    expect((await getChat(deps, id, A)).messages).toEqual([]);
  });

  it("removes a player's messages when they delete their data", async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'Family' });
    await joinLeague(deps, { playerId: B, id });
    await postChat(deps, { playerId: B, id, text: 'bye' });
    await postChat(deps, { playerId: A, id, text: 'hi' });
    await deletePlayer(deps, { playerId: B });
    expect((await getChat(deps, id, A)).messages.map((m) => m.text)).toEqual(['hi']);
  });
});

describe('giving an account back', () => {
  it('moves rooms, hosting and chat to the new player id', async () => {
    const { id } = await createLeague(deps, { playerId: A, name: 'The Office' });
    await joinLeague(deps, { playerId: B, id });
    await postChat(deps, { playerId: A, id, text: 'hi' });
    const NEW = 'player-new-cccccccccccc';
    await movePlayerInLeagues(deps, A, NEW);
    expect((await myLeagues(deps, NEW)).leagues.map((l) => l.id)).toEqual([id]);
    expect((await myLeagues(deps, A)).leagues).toEqual([]);
    const chat = (await getChat(deps, id, NEW)).messages;
    expect(chat.map((m) => m.mine)).toEqual([true]);
    await setLeaguePublic(deps, { playerId: NEW, id, public: true }); // still the host
  });
});
