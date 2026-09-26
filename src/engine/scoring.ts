// Scrabble-style scoring with board premiums, length bonus and pangram jackpot.

export type Premium = 'DL' | 'TL' | 'DW';

export interface Board {
  letters: string[];
  premiums: (Premium | null)[];
}

export const LETTER_VALUES: Record<string, number> = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};

export const PREMIUMS: Record<Premium, { letter: number; word: number; name: string }> = {
  DL: { letter: 2, word: 1, name: 'Double letter' },
  TL: { letter: 3, word: 1, name: 'Triple letter' },
  DW: { letter: 1, word: 2, name: 'Double word' },
};

export const MIN_WORD_LENGTH = 4;
export const PANGRAM_BONUS = 25;

// A climb through Lettertown, from passing tourist to holding the key to the city.
export const RANKS = [
  { name: 'Tourist', pct: 0 },
  { name: 'Newcomer', pct: 10 },
  { name: 'Local', pct: 25 },
  { name: 'Wordsmith', pct: 45 },
  { name: 'Town Crier', pct: 65 },
  { name: 'Mayor', pct: 80 },
  { name: 'Key to the City', pct: 100 },
] as const;

export const TOP_RANK = RANKS[RANKS.length - 1].name;

/** A pangram is any word with this many different letters (or more). */
export const PANGRAM_LETTERS = 7;

export function isPangram(word: string): boolean {
  return new Set(word).size >= PANGRAM_LETTERS;
}

export function scorePath(path: readonly number[], board: Board) {
  let sum = 0;
  let wordMult = 1;
  for (const id of path) {
    const premium = board.premiums[id];
    sum += LETTER_VALUES[board.letters[id]] * (premium ? PREMIUMS[premium].letter : 1);
    if (premium) wordMult *= PREMIUMS[premium].word;
  }
  let score = sum * wordMult + Math.max(0, path.length - 4);
  const pangram = isPangram(path.map((id) => board.letters[id]).join(''));
  if (pangram) score = (score + PANGRAM_BONUS) * 2;
  return { score, pangram };
}

export function rankThresholds(maxScore: number) {
  return RANKS.map((r) => ({ ...r, points: Math.ceil((r.pct / 100) * maxScore) }));
}

export function rankFor(score: number, maxScore: number) {
  const thresholds = rankThresholds(maxScore);
  let index = 0;
  thresholds.forEach((r, i) => {
    if (score >= r.points) index = i;
  });
  const next = thresholds[index + 1] ?? null;
  return { name: thresholds[index].name, index, next };
}
