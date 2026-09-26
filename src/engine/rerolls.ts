// Days whose daily board was replaced after launch. The value is the reroll
// count: 1 = first replacement, 2 = second, and so on. Every copy of the game,
// the answer-table build and the leaderboard read this, so they stay in sync.
export const REROLLS: Readonly<Record<string, number>> = {
  '2026-09-26': 1,
};

export function rerollsFor(dateKey: string): number {
  return REROLLS[dateKey] ?? 0;
}

/** The id of a day's current board: "2026-09-26", or "2026-09-26~v1" once rerolled. */
export function dailyBoardId(dateKey: string, version = rerollsFor(dateKey)): string {
  return version ? `${dateKey}~v${version}` : dateKey;
}

const BOARD_ID = /^(\d{4}-\d{2}-\d{2})(?:~v(\d{1,2}))?$/;

export function parseBoardId(id: string): { dateKey: string; version: number } | null {
  const m = BOARD_ID.exec(id);
  return m ? { dateKey: m[1], version: Number(m[2] ?? 0) } : null;
}
