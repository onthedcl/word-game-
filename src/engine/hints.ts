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
  // Counts of every word by first letter and length: from the server while the board is open,
  // or worked out from the answers once they're known.
  const counts: Record<string, Record<number, number>> = {};
  let pangrams = 0;
  if (puzzle.hintCounts && !puzzle.answers.length) {
    for (const [l, row] of Object.entries(puzzle.hintCounts)) counts[l] = { ...row };
    pangrams = puzzle.pangramCount ?? 0;
  } else {
    for (const a of puzzle.answers) {
      (counts[a.word[0]] ??= {})[a.word.length] = (counts[a.word[0]][a.word.length] ?? 0) + 1;
      if (a.pangram) pangrams += 1;
    }
  }
  const letters = Object.keys(counts).sort();
  const lengths = [...new Set(letters.flatMap((l) => Object.keys(counts[l]).map(Number)))].sort((a, b) => a - b);
  // Take away the words already found (bonus words were never counted).
  const known = new Map([...(puzzle.known ?? []), ...puzzle.answers].map((a) => [a.word, a]));
  for (const w of found) {
    const a = known.get(w);
    if (!a || a.bonus || !counts[w[0]]?.[w.length]) continue;
    counts[w[0]][w.length] -= 1;
    if (a.pangram) pangrams -= 1;
  }
  const cells: HintGrid['cells'] = Object.fromEntries(letters.map((l) => [l, {}]));
  const rowTotals: HintGrid['rowTotals'] = Object.fromEntries(letters.map((l) => [l, 0]));
  const colTotals: HintGrid['colTotals'] = Object.fromEntries(lengths.map((n) => [n, 0]));
  let total = 0;
  for (const l of letters) {
    for (const n of lengths) {
      const left = counts[l][n] ?? 0;
      if (!left) continue;
      cells[l][n] = left;
      rowTotals[l] += left;
      colTotals[n] += left;
      total += left;
    }
  }
  return { letters, lengths, cells, rowTotals, colTotals, total, pangramsLeft: Math.max(0, pangrams) };
}
