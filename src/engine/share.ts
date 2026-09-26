// Spoiler-free share text.
import { RANKS } from './scoring';
import { shortDate } from './dates';
import type { Puzzle } from './generator';

/** ⬢⬢⬢⬢⬡⬡⬡: one hex per rank, filled up to the rank reached. */
export function hexRow(rankIndex: number): string {
  return RANKS.map((_, i) => (i <= rankIndex ? '⬢' : '⬡')).join('');
}

export function shareText(
  puzzle: Puzzle,
  { rankName, rankIndex, score, words, pangrams }: { rankName: string; rankIndex: number; score: number; words: number; pangrams: number },
): string {
  const p = `${pangrams} pangram${pangrams === 1 ? '' : 's'}`;
  if (puzzle.kind === 'blitz') {
    return `Hexicon Blitz | ${score} pts | ${words} words | ${p}\n${hexRow(rankIndex)}`;
  }
  return `Hexicon ${shortDate(puzzle.dateKey!)} | ${rankName} | ${score} pts | ${p}\n${hexRow(rankIndex)}`;
}
