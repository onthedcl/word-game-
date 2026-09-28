// Hint grid: remaining words by first letter and length.
import type { Puzzle } from './generator';

export interface HintGrid {
  letters: string[];
  lengths: number[];
  /** cells[letter][length] = words still to find */
  cells: Record<string, Record<number, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<number, number>;
  total: number;
  pangramsLeft: number;
}

export function hintGrid(puzzle: Puzzle, found: ReadonlySet<string>): HintGrid {
  const lengths = [...new Set(puzzle.answers.map((a) => a.word.length))].sort((a, b) => a - b);
  const letters = [...new Set(puzzle.answers.map((a) => a.word[0]))].sort();
  const cells: HintGrid['cells'] = Object.fromEntries(letters.map((l) => [l, {}]));
  const rowTotals: HintGrid['rowTotals'] = Object.fromEntries(letters.map((l) => [l, 0]));
  const colTotals: HintGrid['colTotals'] = Object.fromEntries(lengths.map((n) => [n, 0]));
  let total = 0;
  let pangramsLeft = 0;
  for (const a of puzzle.answers) {
    if (found.has(a.word)) continue;
    const [l, n] = [a.word[0], a.word.length];
    cells[l][n] = (cells[l][n] ?? 0) + 1;
    rowTotals[l] += 1;
    colTotals[n] += 1;
    total += 1;
    if (a.pangram) pangramsLeft += 1;
  }
  return { letters, lengths, cells, rowTotals, colTotals, total, pangramsLeft };
}
