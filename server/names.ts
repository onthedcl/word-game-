// Leaderboard display names: short, printable, and not offensive.
import blocklist from './blocklist.json';

const BLOCKED: readonly string[] = blocklist;
const ALLOWED = /^[\p{L}\p{N} _.'-]+$/u;

export function cleanName(raw: unknown, maxLength = 16): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > maxLength || !ALLOWED.test(name)) return null;
  const squashed = name.toLowerCase().replace(/[^a-z]/g, '');
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const bad of BLOCKED) {
    // Longer terms are caught inside other text; short ones only as whole words.
    if (bad.length >= 4 ? squashed.includes(bad) : words.includes(bad)) return null;
  }
  return name;
}
