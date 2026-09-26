import { describe, expect, it } from 'vitest';
import { dict, seeds } from './node-dict';
import { acceptableRange, generateBlitz, generateDaily, isAcceptable, OPEN_LETTERS_FROM, randomPath, weekdayIndex } from './generator';
import { EPOCH, puzzleNumber, shiftDateKey } from './dates';
import { CENTER, isValidRoute } from './hexgrid';
import { createRng } from './rng';
import { findPaths, solveBoard } from './solver';
import { MIN_WORD_LENGTH, scorePath } from './scoring';

const DAYS = 40;
const days = Array.from({ length: DAYS }, (_, i) => shiftDateKey(EPOCH, i));
const puzzles = days.map((d) => generateDaily(dict, seeds, d));

describe('dates', () => {
  it('numbers puzzles from the epoch', () => {
    expect(puzzleNumber(EPOCH)).toBe(1);
    expect(puzzleNumber(shiftDateKey(EPOCH, 100))).toBe(101);
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('randomPath', () => {
  it('builds self-avoiding adjacent routes with the key tile where asked', () => {
    const rng = createRng('routes');
    for (let len = 7; len <= 10; len++) {
      for (let pos = 0; pos < len; pos++) {
        const route = randomPath(rng, len, pos)!;
        expect(route).toHaveLength(len);
        expect(route[pos]).toBe(CENTER);
        expect(isValidRoute(route)).toBe(true);
      }
    }
  });
});

describe('determinism', () => {
  it('builds the same daily board every time', () => {
    const again = generateDaily(dict, seeds, days[5]);
    expect(again).toEqual(puzzles[5]);
  });

  it('builds the same blitz board for the same seed, and different ones otherwise', () => {
    expect(generateBlitz(dict, seeds, 'abc')).toEqual(generateBlitz(dict, seeds, 'abc'));
    expect(generateBlitz(dict, seeds, 'abc').board).not.toEqual(generateBlitz(dict, seeds, 'abd').board);
  });

  it('pins the first puzzle so accidental generator changes are noticed', () => {
    const p = puzzles[0];
    expect({ letters: p.letters.join(''), key: p.centerLetter, words: p.answers.length, max: p.maxScore }).toMatchInlineSnapshot(`
      {
        "key": "m",
        "letters": "aelmosu",
        "max": 479,
        "words": 35,
      }
    `);
  });
});

describe.each(puzzles.map((p) => [p.dateKey, p] as const))('daily %s', (_, p) => {
  it('uses the right letters, with the key letter in the centre', () => {
    // The original boards use exactly the seed word's 7 letters; open-letter boards add a few more.
    if (p.dateKey! < OPEN_LETTERS_FROM) expect(p.letters).toHaveLength(7);
    else {
      expect(p.letters.length).toBeGreaterThanOrEqual(7);
      expect(p.letters.length).toBeLessThanOrEqual(11);
    }
    expect([...new Set(p.board.letters)].sort()).toEqual(p.letters);
    expect(p.board.letters).toHaveLength(19);
    expect(p.board.letters[CENTER]).toBe(p.centerLetter);
  });

  it('has 3-4 premium tiles, none on the key tile', () => {
    const premiums = p.board.premiums.filter(Boolean);
    expect(premiums.length).toBeGreaterThanOrEqual(3);
    expect(premiums.length).toBeLessThanOrEqual(4);
    expect(p.board.premiums[CENTER]).toBeNull();
  });

  it('meets the acceptance rules', () => {
    expect(isAcceptable(p)).toBe(true);
    const { minWords, maxWords } = acceptableRange(p.difficulty);
    expect(p.answers.length).toBeGreaterThanOrEqual(minWords);
    expect(p.answers.length).toBeLessThanOrEqual(maxWords);
    expect(new Set(p.seedPangram).size).toBe(7);
    expect(p.seedPangram.length).toBeGreaterThanOrEqual(7);
    expect(p.seedPangram.length).toBeLessThanOrEqual(10);
  });

  it('has a traceable pangram through the key tile', () => {
    expect(p.pangrams).toContain(p.seedPangram);
    expect(findPaths(p.seedPangram, p.board, { requireCenter: true, limit: 1 })).toHaveLength(1);
  });

  it('lists only valid answers, each with a legal best route', () => {
    let total = 0;
    for (const a of p.answers) {
      total += a.score;
      expect(a.word.length).toBeGreaterThanOrEqual(MIN_WORD_LENGTH);
      expect(dict.contains(a.word)).toBe(true);
      expect(isValidRoute(a.path)).toBe(true);
      expect(a.path).toContain(CENTER);
      expect(a.path.map((id) => p.board.letters[id]).join('')).toBe(a.word);
      expect(scorePath(a.path, p.board).score).toBe(a.score);
    }
    expect(total).toBe(p.maxScore);
  });
});

describe('solver correctness', () => {
  const p = puzzles[0];

  it('finds every traceable dictionary word and nothing else (brute force check)', () => {
    const expected = dict
      .wordsFrom(p.letters)
      .filter((w) => w.length >= MIN_WORD_LENGTH && findPaths(w, p.board, { requireCenter: true, limit: 1 }).length);
    expect(p.answers.map((a) => a.word)).toEqual(expected);
  });

  it("scores each word on its best route (max over every route through the key)", () => {
    for (const a of p.answers) {
      const best = Math.max(...findPaths(a.word, p.board, { requireCenter: true }).map((r) => scorePath(r, p.board).score));
      expect(a.score).toBe(best);
    }
  });

  it('solves a hand-built board', () => {
    // Put T-R-E-K on a straight line through the centre; everything else "x"-free filler.
    const board = { letters: new Array(19).fill('q'), premiums: new Array(19).fill(null) };
    const route = randomPath(createRng('trek'), 4, 1)!;
    route.forEach((id, i) => (board.letters[id] = 'trek'[i]));
    const result = solveBoard(board, dict);
    expect([...result.keys()]).toEqual(['trek']);
    expect(result.get('trek')!.score).toBe(8);
  });
});

describe('weekly difficulty', () => {
  it('runs Monday (easiest) to Sunday (hardest) from the open-letter launch', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-04')).toBe(6); // Sunday
    expect(generateDaily(dict, seeds, '2026-09-26').difficulty).toBeNull();
    expect(generateDaily(dict, seeds, '2026-09-28').difficulty).toBe(0);
  });

  it('gives Mondays clearly more words than Sundays', () => {
    const avg = (offset: number) => {
      const counts = [0, 1, 2].map((w) => generateDaily(dict, seeds, shiftDateKey('2026-09-28', offset + 7 * w)).answers.length);
      return counts.reduce((a, b) => a + b, 0) / counts.length;
    };
    expect(avg(0)).toBeGreaterThan(avg(6) * 1.5);
  }, 60_000);

  it('can use more than seven letters, and pangrams mean 7+ different letters', () => {
    const sunday = generateDaily(dict, seeds, '2026-10-04');
    expect(sunday.letters.length).toBeGreaterThan(7);
    for (const a of sunday.answers) expect(a.pangram).toBe(new Set(a.word).size >= 7);
  });
});

describe('rerolled days', () => {
  it('replace the board deterministically and leave other days alone', () => {
    const original = generateDaily(dict, seeds, '2026-09-26', 0);
    const rerolled = generateDaily(dict, seeds, '2026-09-26', 1);
    expect(rerolled.board).not.toEqual(original.board);
    expect(rerolled.letters.join('')).not.toBe(original.letters.join(''));
    expect(rerolled).toEqual(generateDaily(dict, seeds, '2026-09-26', 1));
    expect(rerolled).toMatchObject({ dateKey: '2026-09-26', boardId: '2026-09-26~v1', number: 2 });
    expect(original.boardId).toBe('2026-09-26');
    expect(isAcceptable(rerolled)).toBe(true);
  });

  it('use the reroll list by default', () => {
    expect(generateDaily(dict, seeds, '2026-09-26').boardId).toBe('2026-09-26~v1');
    expect(generateDaily(dict, seeds, '2026-09-27').boardId).toBe('2026-09-27');
  });
});

describe('variety', () => {
  it('almost never repeats a letter set in the first year', () => {
    const sets = Array.from({ length: 365 }, (_, i) => generateDaily(dict, seeds, shiftDateKey(EPOCH, i)).letters.join(''));
    // Easy days sometimes have to hunt through other letter sets, so allow a rare repeat.
    expect(new Set(sets).size).toBeGreaterThanOrEqual(362);
  }, 120_000);
});
