// Word submission rules, independent of React and the DOM.
import { CENTER, isValidRoute } from './hexgrid';
import { MIN_WORD_LENGTH, rankFor, scorePath } from './scoring';
import { findPaths, type Answer } from './solver';
import type { Puzzle } from './generator';

export type Rejection =
  | 'Too short'
  | 'Tiles not adjacent'
  | 'Must use the key tile'
  | 'Not on board'
  | 'Already found'
  | 'Not a word';

/** The route each found word was traced along (word -> tile ids). */
export type Routes = Readonly<Record<string, readonly number[]>>;

export type SubmitResult =
  | { ok: true; answer: Answer; route: number[]; score: number }
  | { ok: false; reason: Rejection };

/** Every accepted word on the board, including bonus words. */
export function answerIndex(puzzle: Puzzle): Map<string, Answer> {
  return new Map([...(puzzle.bonus ?? []), ...puzzle.answers].map((a) => [a.word, a]));
}

/**
 * Check a word against the puzzle. `path` is the traced route; typed words pass
 * `null` and use the route the board highlights for them.
 * A word scores the route it was traced along, so where you trace it matters
 * (the day's maximum assumes every word on its best route).
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
    if (!path.includes(CENTER)) return { ok: false, reason: 'Must use the key tile' };
  } else {
    if (!findPaths(word, puzzle.board, { limit: 1 }).length) return { ok: false, reason: 'Not on board' };
  }
  const route = path ? [...path] : findPaths(word, puzzle.board, { requireCenter: true, limit: 1 })[0];
  if (!route) return { ok: false, reason: 'Must use the key tile' };
  if (found.has(word)) return { ok: false, reason: 'Already found' };
  const answer = answers.get(word);
  if (!answer) return { ok: false, reason: 'Not a word' };
  return { ok: true, answer, route, score: scorePath(route, puzzle.board).score };
}

/** A found word's score: along its traced route if known, else its best route. */
export function wordScore(puzzle: Puzzle, answers: Map<string, Answer>, word: string, routes?: Routes): number {
  const route = routes?.[word];
  return route ? scorePath(route, puzzle.board).score : (answers.get(word)?.score ?? 0);
}

export function scoreOf(puzzle: Puzzle, answers: Map<string, Answer>, found: Iterable<string>, routes?: Routes): number {
  let total = 0;
  for (const w of found) if (answers.has(w)) total += wordScore(puzzle, answers, w, routes);
  return total;
}

export function progress(puzzle: Puzzle, answers: Map<string, Answer>, found: readonly string[], routes?: Routes) {
  const score = scoreOf(puzzle, answers, found, routes);
  // Bonus words score, but "every word" means every counted word.
  const complete = found.filter((w) => answers.has(w) && !answers.get(w)!.bonus).length === puzzle.answers.length;
  return {
    score,
    rank: rankFor(score, puzzle.maxScore, complete),
    pangramsFound: found.filter((w) => answers.get(w)?.pangram).length,
    complete,
  };
}
