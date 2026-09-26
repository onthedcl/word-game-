// Deterministic puzzle generation: the same seed builds the same board on any device.
import { createRng, hashString, type Rng } from './rng';
import { NEIGHBORS, CENTER, TILE_COUNT } from './hexgrid';
import { MIN_WORD_LENGTH, type Board, type Premium } from './scoring';
import { solveBoard, type Answer } from './solver';
import { puzzleNumber } from './dates';
import { dailyBoardId, rerollsFor } from './rerolls';
import type { Dawg } from './dawg';

export interface Puzzle {
  kind: 'daily' | 'blitz';
  seed: string;
  /** Seed offset that produced an acceptable board. */
  offset: number;
  dateKey: string | null;
  /** Daily board id: the date, plus "~vN" if the day was rerolled. */
  boardId: string | null;
  number: number | null;
  letters: string[];
  centerLetter: string;
  seedPangram: string;
  board: Board;
  /** Every valid word with its best route, sorted alphabetically. */
  answers: Answer[];
  pangrams: string[];
  maxScore: number;
}

export const ACCEPT = { minWords: 30, maxWords: 90, minMaxScore: 250, maxMaxScore: 1500 };
const MAX_OFFSETS = 4000;
const TRIES_PER_LETTER_SET = 8; // offsets tried on one letter set before moving on
const LETTER_SET_STRIDE = 997; // keeps rerolls far from other days' first choice
const MAX_TILES_PER_LETTER = 4;
const VOWELS = new Set('aeiou');
const ENRICH_STEPS = 120;
const ENRICH_TARGET = 50;

// ---- pangram seeds ----------------------------------------------------------
// Seeds grouped by letter set, in a fixed shuffled order. Day N starts at slot N,
// so letter sets don't repeat until the whole list has been used.
const orderCache = new WeakMap<readonly string[], string[][]>();
function letterSetOrder(seeds: readonly string[]): string[][] {
  let order = orderCache.get(seeds);
  if (!order) {
    const groups = new Map<string, string[]>();
    for (const w of seeds) {
      const key = [...new Set(w)].sort().join('');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(w);
    }
    const keys = [...groups.keys()].sort();
    order = createRng('hexicon:order').shuffle(keys).map((k) => groups.get(k)!);
    orderCache.set(seeds, order);
  }
  return order;
}

// ---- board construction -----------------------------------------------------
/** A self-avoiding route of `length` tiles with the key tile at position `centerPos`. */
export function randomPath(rng: Rng, length: number, centerPos: number): number[] | null {
  const forwardSteps = length - 1 - centerPos;
  const used = new Array<boolean>(TILE_COUNT).fill(false);
  used[CENTER] = true;
  const forward = [CENTER];
  const backward = [CENTER];

  function step(k: number): boolean {
    if (k === length - 1) return true;
    const side = k < forwardSteps ? forward : backward;
    for (const n of rng.shuffle(NEIGHBORS[side[side.length - 1]])) {
      if (used[n]) continue;
      used[n] = true;
      side.push(n);
      if (step(k + 1)) return true;
      side.pop();
      used[n] = false;
    }
    return false;
  }

  return step(0) ? [...backward.slice(1).reverse(), ...forward] : null;
}

/** Weight each letter by how common it is in valid words, nudged toward vowels. */
function letterWeights(words: readonly string[], letters: readonly string[]): number[] {
  const counts: Record<string, number> = Object.fromEntries(letters.map((l) => [l, 1]));
  for (const w of words) for (const ch of w) counts[ch] += 1;
  return letters.map((l) => counts[l] * (VOWELS.has(l) ? 1.6 : 1));
}

function fillTiles(rng: Rng, pangram: string, route: number[], letters: string[], weights: number[]): string[] {
  const tiles = new Array<string>(TILE_COUNT).fill('');
  route.forEach((id, i) => (tiles[id] = pangram[i]));
  const count: Record<string, number> = Object.fromEntries(letters.map((l) => [l, 0]));
  for (const ch of tiles) if (ch) count[ch] += 1;
  for (let id = 0; id < TILE_COUNT; id++) {
    if (tiles[id]) continue;
    const ch = rng.weighted(letters, letters.map((l, i) => (count[l] >= MAX_TILES_PER_LETTER ? 0 : weights[i])));
    tiles[id] = ch;
    count[ch] += 1;
  }
  return tiles;
}

/**
 * Hill-climb the filler tiles toward a richer board: repeatedly swap one
 * non-pangram tile's letter and keep the change if the word count doesn't drop.
 * Deterministic for a given rng, like everything else here.
 */
function enrichTiles(
  rng: Rng, tiles: string[], route: number[], letters: string[], weights: number[], dict: Dawg,
): string[] {
  const blank = new Array<Premium | null>(TILE_COUNT).fill(null);
  const countWords = (t: string[]) => solveBoard({ letters: t, premiums: blank }, dict, letters).size;
  const free = [...Array(TILE_COUNT).keys()].filter((id) => !route.includes(id));
  let best = tiles.slice();
  let bestCount = countWords(best);
  for (let i = 0; i < ENRICH_STEPS && bestCount < ENRICH_TARGET; i++) {
    const id = rng.pick(free);
    const count = (l: string) => best.filter((ch) => ch === l).length;
    const options = letters.filter((l) => l !== best[id] && count(l) < MAX_TILES_PER_LETTER);
    if (!options.length) continue;
    const trial = best.slice();
    trial[id] = rng.weighted(options, options.map((l) => weights[letters.indexOf(l)]));
    const trialCount = countWords(trial);
    if (trialCount >= bestCount) [best, bestCount] = [trial, trialCount];
  }
  return best;
}

function placePremiums(rng: Rng): (Premium | null)[] {
  const types: Premium[] = ['DL', 'TL', 'DW'];
  if (rng.next() < 0.5) types.push(rng.weighted<Premium>(['DL', 'TL', 'DW'], [3, 2, 1]));
  const spots = rng.shuffle([...Array(TILE_COUNT).keys()].filter((id) => id !== CENTER));
  const premiums = new Array<Premium | null>(TILE_COUNT).fill(null);
  types.forEach((t, i) => (premiums[spots[i]] = t));
  return premiums;
}

export function isAcceptable(p: Pick<Puzzle, 'answers' | 'pangrams' | 'maxScore'>): boolean {
  return (
    p.answers.length >= ACCEPT.minWords &&
    p.answers.length <= ACCEPT.maxWords &&
    p.pangrams.length >= 1 &&
    p.maxScore >= ACCEPT.minMaxScore &&
    p.maxScore <= ACCEPT.maxMaxScore
  );
}

// ---- generation -------------------------------------------------------------
interface GenerateOptions {
  kind: Puzzle['kind'];
  seed: string;
  dateKey?: string;
  /** Starting slot in the letter-set order. */
  slot: number;
}

export function generatePuzzle(dict: Dawg, seeds: readonly string[], { kind, seed, slot, dateKey = undefined }: GenerateOptions): Puzzle {
  const order = letterSetOrder(seeds);
  const vocab = new Map<string, string[]>();
  let fallback: Puzzle | null = null;
  let fallbackDistance = Infinity;

  for (let offset = 0; offset < MAX_OFFSETS; offset++) {
    const rng = createRng(`${seed}#${offset}`);
    const s = slot + Math.floor(offset / TRIES_PER_LETTER_SET) * LETTER_SET_STRIDE;
    const pangram = rng.pick(order[((s % order.length) + order.length) % order.length]);
    const letters = [...new Set(pangram)].sort();
    const key = letters.join('');
    if (!vocab.has(key)) vocab.set(key, dict.wordsFrom(letters).filter((w) => w.length >= MIN_WORD_LENGTH));
    const words = vocab.get(key)!;
    if (words.length < ACCEPT.minWords) continue;

    const centerPos = rng.int(pangram.length);
    const route = randomPath(rng, pangram.length, centerPos);
    if (!route) continue;
    const weights = letterWeights(words, letters);
    const tiles = fillTiles(rng, pangram, route, letters, weights);
    const board: Board = {
      letters: enrichTiles(rng, tiles, route, letters, weights, dict),
      premiums: placePremiums(rng),
    };
    const answers = [...solveBoard(board, dict, letters).values()].sort((a, b) => a.word.localeCompare(b.word));
    const day = kind === 'daily' ? (dateKey ?? seed) : null;
    const puzzle: Puzzle = {
      kind,
      seed,
      offset,
      dateKey: day,
      boardId: day ? (dateKey ? seed : day) : null,
      number: day ? puzzleNumber(day) : null,
      letters,
      centerLetter: pangram[centerPos],
      seedPangram: pangram,
      board,
      answers,
      pangrams: answers.filter((a) => a.pangram).map((a) => a.word),
      maxScore: answers.reduce((s, a) => s + a.score, 0),
    };
    if (isAcceptable(puzzle)) return puzzle;
    const distance = Math.abs(answers.length - (ACCEPT.minWords + ACCEPT.maxWords) / 2);
    if (distance < fallbackDistance) [fallback, fallbackDistance] = [puzzle, distance];
  }
  return fallback!;
}

const REROLL_SLOT_STRIDE = 1777; // a rerolled day draws its letters far from every other day's

export function generateDaily(dict: Dawg, seeds: readonly string[], dateKey: string, version = rerollsFor(dateKey)): Puzzle {
  const slot = puzzleNumber(dateKey) - 1;
  if (!version) return generatePuzzle(dict, seeds, { kind: 'daily', seed: dateKey, slot });
  return generatePuzzle(dict, seeds, {
    kind: 'daily',
    seed: dailyBoardId(dateKey, version),
    dateKey,
    slot: slot + version * REROLL_SLOT_STRIDE,
  });
}

export function generateBlitz(dict: Dawg, seeds: readonly string[], seed: string): Puzzle {
  return generatePuzzle(dict, seeds, { kind: 'blitz', seed: `blitz:${seed}`, slot: hashString(seed) });
}
