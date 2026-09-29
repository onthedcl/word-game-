// Spoiler-free share text that invites friends to beat your score.
import { RANKS } from './scoring';
import { shortDate } from './dates';
import { DIFFICULTY_NAMES, type Puzzle } from './generator';

export const GAME_URL = 'https://onthedcl.github.io/word-game-/';

/** ⬢⬢⬢⬢⬡⬡⬡: one hex per rank, filled up to the rank reached. */
export function hexRow(rankIndex: number): string {
  return RANKS.map((_, i) => (i <= rankIndex ? '⬢' : '⬡')).join('');
}

interface Result {
  rankName: string;
  rankIndex: number;
  score: number;
  words: number;
  pangrams: number;
  /** Place on the leaderboard, when the player is on it. */
  standing?: { position: number; total: number } | null;
  /** Days in a row with a word found. */
  streak?: number;
}

const place = (s: Result['standing'], scope: string) => (s ? `#${s.position} of ${s.total} ${scope}` : null);

export function shareText(puzzle: Puzzle, r: Result): string {
  const pangrams = r.pangrams ? ` · ${'🌟'.repeat(Math.min(r.pangrams, 3))}` : '';
  if (puzzle.kind === 'blitz') {
    const where = place(r.standing, 'all-time');
    return [
      `DPIYF Lettertown ⚡ Blitz`,
      `${r.score} pts in 3 minutes · ${r.words} words${where ? ` · ${where}` : ''}${pangrams}`,
      `Think you're faster? ${GAME_URL}#blitz`,
    ].join('\n');
  }
  const day = shortDate(puzzle.dateKey!);
  const level = puzzle.difficulty !== null ? ` (${DIFFICULTY_NAMES[puzzle.difficulty]})` : '';
  const where = place(r.standing, 'today');
  return [
    `DPIYF Lettertown ${day}${level}`,
    `${where ? `🏆 ${where} · ` : ''}${r.score} pts · ${r.rankName}${pangrams}`,
    hexRow(r.rankIndex) + (r.streak && r.streak >= 2 ? `  🔥 ${r.streak}-day streak` : ''),
    `Can you beat me? ${GAME_URL}`,
  ].join('\n');
}
