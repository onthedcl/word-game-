// Daily puzzle calendar. Puzzles are keyed by the date (YYYY-MM-DD) in the game's one time
// zone, Eastern, so everyone everywhere is on the same board and it changes at the same moment.

export const EPOCH = '2026-09-25'; // DPIYF Lettertown #1

/** The game's clock: a new board at midnight Eastern for everyone, wherever their device is. */
export const GAME_ZONE = 'America/New_York';

/** The first board on the one Eastern clock. Earlier boards kept their old open/lock times. */
export const ONE_CLOCK_FROM = '2026-10-05';

/** Today's board: the date in Eastern time. */
export function dateKeyFor(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GAME_ZONE }).format(date);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function puzzleNumber(dateKey: string): number {
  const ms = Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

export function isDateKey(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** "9/25" */
export function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}/${d}`;
}

const HOUR = 3600 * 1000;

/** A daily board opens at midnight Eastern at the start of its date. */
export function boardOpensAt(dateKey: string): number {
  // Until the one clock began, a board opened when its date began anywhere (UTC+14); the first
  // Eastern board keeps that too, so devices still on the old version aren’t turned away.
  if (dateKey <= ONE_CLOCK_FROM) return Date.parse(`${dateKey}T00:00:00Z`) - 14 * HOUR;
  return midnightIn(dateKey, GAME_ZONE);
}

/** How far a time zone's wall clock is ahead of UTC at an instant (negative for the Americas). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant a date begins in a time zone (daylight saving included). */
function midnightIn(dateKey: string, timeZone: string): number {
  const midnight = Date.parse(`${dateKey}T00:00:00Z`); // that wall-clock time, read as UTC
  const guess = midnight - zoneOffsetMs(midnight, timeZone);
  return midnight - zoneOffsetMs(guess, timeZone);
}

/**
 * A daily board locks at midnight Eastern at the end of its date, when the next one opens.
 * After that its leaderboard is final and everyone's missed words show in Past.
 */
export function boardLocksAt(dateKey: string): number {
  // Before the one clock, boards locked at midnight Pacific.
  if (dateKey < ONE_CLOCK_FROM) return midnightIn(shiftDateKey(dateKey, 1), 'America/Los_Angeles');
  return midnightIn(shiftDateKey(dateKey, 1), GAME_ZONE);
}
