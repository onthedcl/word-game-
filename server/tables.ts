// Precomputed answer tables. The build makes one per daily puzzle and per Blitz board and
// uploads them to the leaderboard server, the only place they're kept: players get the
// letters, never the answers, until a board closes. (Generating puzzles on the server
// would blow the Workers CPU budget.)
import type { Puzzle } from '../src/engine/generator';
import type { Board } from '../src/engine/scoring';

export interface AnswerTable {
  maxScore: number;
  /** The board itself, so the server can score the route each word was traced along. */
  board?: Board;
  /** word -> [score, isPangram (1/0)], plus a trailing 1 for bonus words (they score but aren't counted in the total). */
  words: Record<string, [number, 0 | 1] | [number, 0 | 1, 1]>;
  /** One short, easy word and its route, traced on a brand-new player's first board. */
  starter?: { word: string; path: number[] };
}

/** `common` is the board before rarer answers were added: the guide's word comes from it. */
export function answerTable(puzzle: Puzzle, common: Puzzle = puzzle): AnswerTable {
  const words: AnswerTable['words'] = {};
  for (const a of puzzle.answers) words[a.word] = [a.score, a.pangram ? 1 : 0];
  for (const a of puzzle.bonus ?? []) words[a.word] = [a.score, a.pangram ? 1 : 0, 1];
  const easy = [...common.answers].sort((a, b) => a.word.length - b.word.length || a.score - b.score)[0];
  return { maxScore: puzzle.maxScore, board: puzzle.board, words, ...(easy ? { starter: { word: easy.word, path: easy.path } } : {}) };
}

export const BLITZ_POOL_SIZE = 365;
export const blitzPoolSeed = (i: number) => `pool-${String(i).padStart(4, '0')}`;
