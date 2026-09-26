// Daily puzzle calendar. Puzzles are keyed by the player's local date (YYYY-MM-DD).

export const EPOCH = '2026-09-25'; // Schmexicon #1

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
