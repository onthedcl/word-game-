import { describe, expect, it } from 'vitest';
import { dict, seeds } from './node-dict';
import { generateDaily } from './generator';
import { answerIndex, checkWord, progress, wordScore } from './game';
import { findPaths } from './solver';
import { scorePath } from './scoring';
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
  it('accepts a traced answer and scores the route it was traced along', () => {
    const res = checkWord(puzzle, answers, none, plain.word, plain.path);
    expect(res).toEqual({ ok: true, answer: plain, route: plain.path, score: plain.score });
  });

  it('scores a weaker spot lower than the best one', () => {
    // A word that can be traced in more than one place, with different scores.
    const multi = puzzle.answers.find((a) => {
      const scores = findPaths(a.word, puzzle.board, { requireCenter: true }).map((r) => scorePath(r, puzzle.board).score);
      return Math.min(...scores) < a.score;
    })!;
    const routes = findPaths(multi.word, puzzle.board, { requireCenter: true });
    const weaker = routes.find((r) => scorePath(r, puzzle.board).score < multi.score)!;
    const res = checkWord(puzzle, answers, none, multi.word, weaker);
    expect(res.ok && res.score).toBe(scorePath(weaker, puzzle.board).score);
    expect(res.ok && res.score).toBeLessThan(multi.score);
    // Progress and the found-word list use the traced route too.
    const tally = progress(puzzle, answers, [multi.word], { [multi.word]: weaker });
    expect(tally.score).toBe(scorePath(weaker, puzzle.board).score);
    expect(wordScore(puzzle, answers, multi.word, {})).toBe(multi.score);
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
    expect(reason(spell(outer), outer)).toBe('Must use the gold tile');

    const far = NEIGHBORS.findIndex((n, id) => id !== CENTER && !n.includes(CENTER));
    const broken = [far, CENTER, ...NEIGHBORS[CENTER].filter((n) => n !== far).slice(0, 2)];
    expect(reason(spell(broken), broken)).toBe('Tiles not adjacent');

    expect(reason(puzzle.letters[0].repeat(8), null)).toBe('Not on board');

    const junk = findRoute(true, (w) => !dict.contains(w));
    expect(reason(spell(junk), junk)).toBe('Not a word');
  });

  it('reaches Key to the City when every word is found in its best spot', () => {
    const all = puzzle.answers.map((a) => a.word);
    const p = progress(puzzle, answers, all);
    expect(p.score).toBe(puzzle.maxScore);
    expect(p.rank.name).toBe('Key to the City');
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
  it('shares score and leaderboard place as a challenge, without spoilers', () => {
    const text = shareText(puzzle, {
      rankName: 'Mayor', rankIndex: 5, score: 412, words: 30, pangrams: 1, standing: { position: 2, total: 7 },
    });
    expect(text).toBe(
      'DPIYF Lettertown 9/25\n🏆 #2 of 7 today · 412 pts · Mayor · 🌟\n⬢⬢⬢⬢⬢⬢⬡\nCan you beat me? https://onthedcl.github.io/word-game-/',
    );
    expect(hexRow(0)).toBe('⬢⬡⬡⬡⬡⬡⬡');
  });

  it('shares without a place when not on the leaderboard, and shows the difficulty', () => {
    const monday = generateDaily(dict, seeds, '2026-09-28');
    const text = shareText(monday, { rankName: 'Local', rankIndex: 2, score: 90, words: 9, pangrams: 0 });
    expect(text.split('\n').slice(0, 2)).toEqual(['DPIYF Lettertown 9/28 (Easy)', '90 pts · Local']);
  });

  it('shares Blitz results with the all-time place', () => {
    const text = shareText({ ...puzzle, kind: 'blitz' }, {
      rankName: 'Local', rankIndex: 2, score: 120, words: 14, pangrams: 0, standing: { position: 3, total: 9 },
    });
    expect(text).toBe(
      "DPIYF Lettertown ⚡ Blitz\n120 pts in 3 minutes · 14 words · #3 of 9 all-time\nThink you're faster? https://onthedcl.github.io/word-game-/#blitz",
    );
  });
});

describe('bonus words', () => {
  it('are accepted and scored, but not counted toward every word', async () => {
    const { accepted, dict, full, seeds } = await import('./node-dict');
    const { generateDaily, withAnswers } = await import('./generator');
    const { answerIndex, checkWord, progress } = await import('./game');
    const p = withAnswers(generateDaily(dict, seeds, '2026-09-28'), accepted, full);
    const index = answerIndex(p);
    const b = p.bonus![0];
    const r = checkWord(p, index, new Set(), b.word, b.path);
    expect(r.ok && r.answer.bonus).toBe(true);
    const all = p.answers.map((a) => a.word);
    expect(progress(p, index, [...all.slice(0, -1), b.word]).complete).toBe(false);
    expect(progress(p, index, [...all, b.word]).complete).toBe(true);
  });
});

describe('board lock', () => {
  it('is midnight Pacific at the end of the date, daylight saving included', async () => {
    const { boardLocksAt } = await import('./dates');
    expect(new Date(boardLocksAt('2026-09-27')).toISOString()).toBe('2026-09-28T07:00:00.000Z'); // PDT
    expect(new Date(boardLocksAt('2026-11-15')).toISOString()).toBe('2026-11-16T08:00:00.000Z'); // PST
    expect(new Date(boardLocksAt('2026-10-31')).toISOString()).toBe('2026-11-01T07:00:00.000Z'); // night before clocks go back
    expect(new Date(boardLocksAt('2026-11-01')).toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(new Date(boardLocksAt('2027-03-13')).toISOString()).toBe('2027-03-14T08:00:00.000Z'); // night before clocks go forward
    expect(new Date(boardLocksAt('2027-03-14')).toISOString()).toBe('2027-03-15T07:00:00.000Z');
  });
});

describe('share text', () => {
  it('mentions a streak of two days or more', async () => {
    const { shareText } = await import('./share');
    const { dict, seeds } = await import('./node-dict');
    const { generateDaily } = await import('./generator');
    const p = generateDaily(dict, seeds, '2026-09-28');
    const base = { rankName: 'Local', rankIndex: 2, score: 120, words: 12, pangrams: 0 };
    expect(shareText(p, { ...base, streak: 1 })).not.toContain('streak');
    expect(shareText(p, { ...base, streak: 5 })).toContain('🐢 5-day streak');
  });
});

describe('compliments', () => {
  it('praise 7+ letter words always and 5-6 letter words now and then, never short ones', async () => {
    const { complimentFor } = await import('../compliments');
    expect(complimentFor('rest', () => 0)).toBeNull();
    expect(complimentFor('chest', () => 0.9)).not.toBeNull(); // first one always
    expect(complimentFor('chest', () => 0.9)).toBeNull(); // then about 1 in 3
    expect(complimentFor('chests', () => 0.1)).not.toBeNull();
    expect(complimentFor('torches', () => 0.9)).not.toBeNull();
  });
});

describe('streak animals', () => {
  it('grow up every 5 days', async () => {
    const { isNewAnimal, streakAnimal } = await import('./streak');
    expect([1, 4, 5, 9, 10, 14, 15, 29, 30, 49, 50, 59, 60, 400].map((d) => streakAnimal(d).emoji).join('')).toBe('🐣🐣🐢🐢🐇🐇🦊🐬🦁🐘🐋🐋🐉🐉');
    expect([1, 4, 5, 6, 10, 55, 60].map(isNewAnimal)).toEqual([false, false, true, false, true, false, true]);
  });
});
