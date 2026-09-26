import { describe, expect, it } from 'vitest';
import { dict, seeds } from './node-dict';
import { generateDaily } from './generator';
import { answerIndex, checkWord, progress } from './game';
import { hintGrid } from './hints';
import { hexRow, shareText } from './share';
import { CENTER, NEIGHBORS } from './hexgrid';

const puzzle = generateDaily(dict, seeds, '2026-09-25');
const answers = answerIndex(puzzle);
const none = new Set<string>();
const plain = puzzle.answers.find((a) => !a.pangram)!;
const spell = (route: number[]) => route.map((id) => puzzle.board.letters[id]).join('');

/** First 4-tile route (through the key tile or not) whose letters satisfy `pred`. */
function findRoute(throughKey: boolean, pred: (w: string) => boolean = () => true): number[] {
  const walk = (route: number[]): number[] | null => {
    if (route.length === 4) return route.includes(CENTER) === throughKey && pred(spell(route)) ? route : null;
    for (const n of NEIGHBORS[route[route.length - 1]]) {
      if (route.includes(n)) continue;
      const hit = walk([...route, n]);
      if (hit) return hit;
    }
    return null;
  };
  for (let id = 0; id < 19; id++) {
    const hit = walk([id]);
    if (hit) return hit;
  }
  throw new Error('no route');
}

describe('checkWord', () => {
  it('accepts a traced answer and scores its best route', () => {
    const res = checkWord(puzzle, answers, none, plain.word, plain.path);
    expect(res).toEqual({ ok: true, answer: plain });
  });

  it('accepts typed answers found anywhere on the board', () => {
    expect(checkWord(puzzle, answers, none, puzzle.seedPangram.toUpperCase(), null).ok).toBe(true);
  });

  it('rejects with the right reasons', () => {
    const reason = (w: string, p: number[] | null, found = none) => {
      const r = checkWord(puzzle, answers, found, w, p);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason('abc', null)).toBe('Too short');
    expect(reason(plain.word, plain.path, new Set([plain.word]))).toBe('Already found');

    const outer = findRoute(false);
    expect(reason(spell(outer), outer)).toBe('Missing center');

    const far = NEIGHBORS.findIndex((n, id) => id !== CENTER && !n.includes(CENTER));
    const broken = [far, CENTER, ...NEIGHBORS[CENTER].filter((n) => n !== far).slice(0, 2)];
    expect(reason(spell(broken), broken)).toBe('Tiles not adjacent');

    expect(reason(puzzle.letters[0].repeat(8), null)).toBe('Not on board');

    const junk = findRoute(true, (w) => !dict.contains(w));
    expect(reason(spell(junk), junk)).toBe('Not a word');
  });

  it('reaches Hexmaster when every word is found', () => {
    const all = puzzle.answers.map((a) => a.word);
    const p = progress(puzzle, answers, all);
    expect(p.score).toBe(puzzle.maxScore);
    expect(p.rank.name).toBe('Hexmaster');
    expect(p.complete).toBe(true);
    expect(p.pangramsFound).toBe(puzzle.pangrams.length);
  });
});

describe('hints', () => {
  it('counts remaining words by first letter and length', () => {
    const grid = hintGrid(puzzle, new Set([plain.word]));
    expect(grid.total).toBe(puzzle.answers.length - 1);
    const sumCells = grid.letters.reduce((s, l) => s + Object.values(grid.cells[l]).reduce((a, b) => a + b, 0), 0);
    expect(sumCells).toBe(grid.total);
    expect(grid.pangramsLeft).toBe(puzzle.pangrams.length);
    const full = hintGrid(puzzle, new Set());
    expect(full.cells[plain.word[0]][plain.word.length]).toBe(grid.cells[plain.word[0]][plain.word.length] + 1 || 1);
  });
});

describe('share', () => {
  it('formats the daily result without spoilers', () => {
    const text = shareText(puzzle, { rankName: 'Genius', rankIndex: 5, score: 412, words: 30, pangrams: 1 });
    expect(text).toBe('Hexicon 9/25 | Genius | 412 pts | 1 pangram\n⬢⬢⬢⬢⬢⬢⬡');
    expect(hexRow(0)).toBe('⬢⬡⬡⬡⬡⬡⬡');
  });
});
