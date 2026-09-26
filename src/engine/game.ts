// Word submission rules, independent of React and the DOM.
import { CENTER, isValidRoute } from './hexgrid';
import { MIN_WORD_LENGTH, rankFor } from './scoring';
import { findPaths, type Answer } from './solver';
import type { Puzzle } from './generator';

export type Rejection =
  | 'Too short'
  | 'Tiles not adjacent'
  | 'Missing center'
  | 'Not on board'
  | 'Already found'
  | 'Not a word';

export type SubmitResult = { ok: true; answer: Answer } | { ok: false; reason: Rejection };

export function answerIndex(puzzle: Puzzle): Map<string, Answer> {
  return new Map(puzzle.answers.map((a) => [a.word, a]));
}

/**
 * Check a word against the puzzle. `path` is the traced route; typed words pass
 * `null` and are accepted if any route through the key tile spells them.
 * Accepted words always score their best route (so the max score is well defined).
 */
export function checkWord(
  puzzle: Puzzle,
  answers: Map<string, Answer>,
  found: ReadonlySet<string>,
  word: string,
  path: readonly number[] | null,
): SubmitResult {
  word = word.toLowerCase();
  if (word.length < MIN_WORD_LENGTH) return { ok: false, reason: 'Too short' };
  if (path) {
    if (path.map((id) => puzzle.board.letters[id]).join('') !== word || !isValidRoute(path)) {
      return { ok: false, reason: 'Tiles not adjacent' };
    }
    if (!path.includes(CENTER)) return { ok: false, reason: 'Missing center' };
  } else {
    if (!findPaths(word, puzzle.board, { limit: 1 }).length) return { ok: false, reason: 'Not on board' };
    if (!findPaths(word, puzzle.board, { requireCenter: true, limit: 1 }).length) {
      return { ok: false, reason: 'Missing center' };
    }
  }
  if (found.has(word)) return { ok: false, reason: 'Already found' };
  const answer = answers.get(word);
  return answer ? { ok: true, answer } : { ok: false, reason: 'Not a word' };
}

export function scoreOf(answers: Map<string, Answer>, found: Iterable<string>): number {
  let total = 0;
  for (const w of found) total += answers.get(w)?.score ?? 0;
  return total;
}

export function progress(puzzle: Puzzle, answers: Map<string, Answer>, found: readonly string[]) {
  const score = scoreOf(answers, found);
  return {
    score,
    rank: rankFor(score, puzzle.maxScore),
    pangramsFound: found.filter((w) => answers.get(w)?.pangram).length,
    complete: found.length === puzzle.answers.length,
  };
}
