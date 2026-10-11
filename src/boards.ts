// Boards come from the leaderboard server: the letters and totals while a board is open,
// every answer once it's over. Words are checked there too, so the answers never sit in the
// game for anyone to dig out.
import { api, type BoardView, type WordInfo } from './api';
import { CENTER } from './engine/hexgrid';
import type { Puzzle } from './engine/generator';
import type { Answer } from './engine/solver';
import { readStored, writeStored } from './storage';

const toAnswer = (w: WordInfo): Answer => ({ word: w.word, score: w.score, path: [], pangram: w.pangram, ...(w.bonus ? { bonus: true } : {}) });

/** Words confirmed on a board, kept on this device so progress shows right away after a reload. */
const knownKey = (id: string) => `hexicon:known:${id}`;

export function rememberWord(boardId: string, w: WordInfo) {
  const have = readStored<WordInfo[]>(knownKey(boardId), []);
  if (!have.some((k) => k.word === w.word)) writeStored(knownKey(boardId), [...have, w]);
}

export function puzzleFromView(view: BoardView): Puzzle {
  const answers = view.answers ?? [];
  const local = view.boardId ? readStored<WordInfo[]>(knownKey(view.boardId), []) : [];
  const known = new Map([...local, ...view.found].map((w) => [w.word, toAnswer(w)]));
  return {
    kind: view.kind,
    seed: view.boardId ?? '',
    offset: 0,
    dateKey: view.dateKey,
    boardId: view.boardId,
    number: view.number,
    letters: [...new Set(view.board.letters)].sort(),
    centerLetter: view.board.letters[CENTER],
    seedPangram: '',
    board: view.board,
    answers: answers.filter((a) => !a.bonus).map(toAnswer),
    bonus: answers.filter((a) => a.bonus).map(toAnswer),
    pangrams: answers.filter((a) => a.pangram && !a.bonus).map((a) => a.word),
    maxScore: view.maxScore,
    difficulty: view.difficulty,
    total: view.total,
    hintCounts: view.hints,
    pangramCount: view.pangrams,
    starter: view.starter,
    known: [...known.values()],
  };
}

/** The same puzzle with one more confirmed word. */
export function withKnown(puzzle: Puzzle, w: WordInfo): Puzzle {
  if (puzzle.known?.some((k) => k.word === w.word)) return puzzle;
  return { ...puzzle, known: [...(puzzle.known ?? []), toAnswer(w)] };
}

export async function loadDaily(dateKey: string, playerId: string): Promise<Puzzle> {
  return puzzleFromView(await api.board(dateKey, playerId));
}

export type Checked = { ok: true; info: WordInfo; points: number } | { ok: false; reason: string };

/** Ask the server whether a traced word is an answer. */
export async function checkOnServer(
  where: { board: string } | { game: string }, playerId: string, word: string, route: number[],
): Promise<Checked> {
  const r = await api.check({ playerId, ...where, word, route });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, info: { word: r.word, score: r.score, pangram: r.pangram, ...(r.bonus ? { bonus: true } : {}) }, points: r.points };
}
