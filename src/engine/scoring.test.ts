import { describe, expect, it } from 'vitest';
import { scorePath, rankFor, rankThresholds, type Board, type Premium } from './scoring';

const board = (word: string, premiums: Record<number, Premium> = {}): Board => ({
  letters: [...word],
  premiums: [...word].map((_, i) => premiums[i] ?? null),
});
const route = (n: number) => [...Array(n).keys()];

describe('scorePath', () => {
  it('sums letter values', () => {
    // T1 R1 E1 K5
    expect(scorePath(route(4), board('trek'))).toEqual({ score: 8, pangram: false });
  });

  it('applies letter multipliers to one letter', () => {
    expect(scorePath(route(4), board('trek', { 3: 'TL' })).score).toBe(18);
    expect(scorePath(route(4), board('trek', { 3: 'DL' })).score).toBe(13);
  });

  it('applies word multipliers after letter multipliers, and DWs stack', () => {
    expect(scorePath(route(4), board('trek', { 3: 'DL', 0: 'DW' })).score).toBe(26);
    expect(scorePath(route(4), board('trek', { 0: 'DW', 1: 'DW' })).score).toBe(32);
  });

  it('adds +1 per letter beyond four, outside the word multiplier', () => {
    // C3 R1 A1 T1 E1 R1 = 8, x2 = 16, +2
    expect(scorePath(route(6), board('crater', { 0: 'DW' })).score).toBe(18);
  });

  it('gives pangrams +25 then doubles', () => {
    // B3 R1 A1 C3 K5 E1 T1 = 15, +3 = 18, (18 + 25) x 2 = 86
    expect(scorePath(route(7), board('bracket'))).toEqual({ score: 86, pangram: true });
    // with a DW: 15 x 2 = 30, +3 = 33, (33 + 25) x 2 = 116
    expect(scorePath(route(7), board('bracket', { 2: 'DW' })).score).toBe(116);
  });
});

describe('ranks', () => {
  it('uses the percentage ladder', () => {
    expect(rankThresholds(200).map((r) => r.points)).toEqual([0, 20, 50, 90, 130, 160, 200]);
    const names = [0, 19, 20, 50, 90, 130, 160, 199, 200].map((s) => rankFor(s, 200).name);
    expect(names).toEqual(['Tourist', 'Tourist', 'Newcomer', 'Local', 'Wordsmith', 'Town Crier', 'Mayor', 'Mayor', 'Mayor']);
    // The top rank is for finding every word (bonus points can pass the maximum without it).
    expect(rankFor(200, 200, true).name).toBe('Key to the City');
    expect(rankFor(260, 200).name).toBe('Mayor');
  });

  it('reports the next rank', () => {
    expect(rankFor(25, 200).next).toMatchObject({ name: 'Local', points: 50 });
    expect(rankFor(200, 200, true).next).toBeNull();
    expect(rankFor(200, 200).next).toMatchObject({ name: 'Key to the City' });
  });
});

describe('top rank', () => {
  it('goes to finding every word even below the maximum score', async () => {
    const { rankFor, TOP_RANK } = await import('./scoring');
    expect(rankFor(516, 517).name).not.toBe(TOP_RANK);
    expect(rankFor(516, 517, true).name).toBe(TOP_RANK);
  });
});
