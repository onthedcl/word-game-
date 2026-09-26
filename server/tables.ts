// Precomputed answer tables. The build writes one per daily puzzle and per Blitz
// board to dist/scores/, and the leaderboard server scores submissions against
// them. Generating puzzles on the server would blow the Workers CPU budget.
import type { Puzzle } from '../src/engine/generator';

export interface AnswerTable {
  maxScore: number;
  /** word -> [score, isPangram (1/0)] */
  words: Record<string, [number, 0 | 1]>;
}

export function answerTable(puzzle: Puzzle): AnswerTable {
  const words: AnswerTable['words'] = {};
  for (const a of puzzle.answers) words[a.word] = [a.score, a.pangram ? 1 : 0];
  return { maxScore: puzzle.maxScore, words };
}

export const BLITZ_POOL_SIZE = 365;
export const blitzPoolSeed = (i: number) => `pool-${String(i).padStart(4, '0')}`;
