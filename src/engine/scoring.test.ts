import { describe, expect, it } from 'vitest';
import { scorePath, rankFor, rankThresholds, type Board, type Premium } from './scoring';

const letters = ['a', 'b', 'c', 'e', 'k', 'r', 't'];
const board = (word: string, premiums: Record<number, Premium> = {}): Board => ({
  letters: [...word],
  premiums: [...word].map((_, i) => premiums[i] ?? null),
});
const route = (n: number) => [...Array(n).keys()];

describe('scorePath', () => {
  it('sums Scrabble letter values', () => {
    // T1 R1 E1 K5
    expect(scorePath(route(4), board('trek'), letters)).toEqual({ score: 8, pangram: false });
  });

  it('applies letter multipliers to one letter', () => {
    expect(scorePath(route(4), board('trek', { 3: 'TL' }), letters).score).toBe(18);
    expect(scorePath(route(4), board('trek', { 3: 'DL' }), letters).score).toBe(13);
  });

  it('applies word multipliers after letter multipliers, and DWs stack', () => {
    expect(scorePath(route(4), board('trek', { 3: 'DL', 0: 'DW' }), letters).score).toBe(26);
    expect(scorePath(route(4), board('trek', { 0: 'DW', 1: 'DW' }), letters).score).toBe(32);
  });

  it('adds +1 per letter beyond four, outside the word multiplier', () => {
    // C3 R1 A1 T1 E1 R1 = 8, x2 = 16, +2
    expect(scorePath(route(6), board('crater', { 0: 'DW' }), letters).score).toBe(18);
  });

  it('gives pangrams +25 then doubles', () => {
    // B3 R1 A1 C3 K5 E1 T1 = 15, +3 = 18, (18 + 25) x 2 = 86
    expect(scorePath(route(7), board('bracket'), letters)).toEqual({ score: 86, pangram: true });
    // with a DW: 15 x 2 = 30, +3 = 33, (33 + 25) x 2 = 116
    expect(scorePath(route(7), board('bracket', { 2: 'DW' }), letters).score).toBe(116);
  });
});

describe('ranks', () => {
  it('uses the percentage ladder', () => {
    expect(rankThresholds(200).map((r) => r.points)).toEqual([0, 20, 50, 90, 130, 160, 200]);
    const names = [0, 19, 20, 50, 90, 130, 160, 199, 200].map((s) => rankFor(s, 200).name);
    expect(names).toEqual(['Beginner', 'Beginner', 'Solid', 'Nice', 'Great', 'Amazing', 'Genius', 'Genius', 'Hexmaster']);
  });

  it('reports the next rank', () => {
    expect(rankFor(25, 200).next).toMatchObject({ name: 'Nice', points: 50 });
    expect(rankFor(200, 200).next).toBeNull();
  });
});
