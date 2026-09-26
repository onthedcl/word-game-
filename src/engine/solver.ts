// Finds every valid word on a board and the best-scoring route for each (trie + DFS).
import { NEIGHBORS, CENTER, TILE_COUNT } from './hexgrid';
import { scorePath, MIN_WORD_LENGTH, type Board } from './scoring';
import { ROOT, type Dawg } from './dawg';

export interface Answer {
  word: string;
  score: number;
  path: number[];
  pangram: boolean;
}

export function solveBoard(board: Board, dict: Dawg): Map<string, Answer> {
  const results = new Map<string, Answer>();
  const path: number[] = [];
  const used = new Array<boolean>(TILE_COUNT).fill(false);
  let word = '';

  function visit(id: number, node: number, hasCenter: boolean) {
    const next = dict.child(node, board.letters[id]);
    if (next < 0) return;
    used[id] = true;
    path.push(id);
    word += board.letters[id];
    const center = hasCenter || id === CENTER;
    if (center && path.length >= MIN_WORD_LENGTH && dict.isWord(next)) {
      const { score, pangram } = scorePath(path, board);
      const prev = results.get(word);
      if (!prev || score > prev.score) results.set(word, { word, score, path: path.slice(), pangram });
    }
    for (const n of NEIGHBORS[id]) if (!used[n]) visit(n, next, center);
    word = word.slice(0, -1);
    path.pop();
    used[id] = false;
  }

  for (let id = 0; id < TILE_COUNT; id++) visit(id, ROOT, false);
  return results;
}

// Routes that spell `word`, optionally only those through the key tile.
export function findPaths(
  word: string,
  board: Board,
  { requireCenter = false, limit = Infinity }: { requireCenter?: boolean; limit?: number } = {},
): number[][] {
  const found: number[][] = [];
  const path: number[] = [];
  const used = new Array<boolean>(TILE_COUNT).fill(false);

  function visit(id: number, i: number) {
    if (found.length >= limit || used[id] || board.letters[id] !== word[i]) return;
    used[id] = true;
    path.push(id);
    if (i === word.length - 1) {
      if (!requireCenter || path.includes(CENTER)) found.push(path.slice());
    } else {
      for (const n of NEIGHBORS[id]) visit(n, i + 1);
    }
    path.pop();
    used[id] = false;
  }

  if (word.length) for (let id = 0; id < TILE_COUNT; id++) visit(id, 0);
  return found;
}
