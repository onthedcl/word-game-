// Daily puzzle calendar. Puzzles are keyed by the player's local date (YYYY-MM-DD).

export const EPOCH = '2026-09-25'; // DPIYF Lettertown #1

export function dateKeyFor(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/** A daily board opens when its date begins in the earliest time zone (UTC+14). */
export function boardOpensAt(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`) - 14 * HOUR;
}

const LOCK_ZONE = 'America/Los_Angeles';

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

/**
 * A daily board hard-locks at midnight Pacific time at the end of its date
 * (daylight saving included). After that its leaderboard is final.
 */
export function boardLocksAt(dateKey: string): number {
  const midnight = Date.parse(`${shiftDateKey(dateKey, 1)}T00:00:00Z`); // that wall-clock time, read as UTC
  const guess = midnight - zoneOffsetMs(midnight, LOCK_ZONE);
  return midnight - zoneOffsetMs(guess, LOCK_ZONE);
}
