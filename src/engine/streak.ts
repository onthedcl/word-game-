// A streak's animal grows up every 5 days.
const LADDER: readonly { from: number; emoji: string; name: string }[] = [
  { from: 1, emoji: '🐣', name: 'hatchling' },
  { from: 5, emoji: '🐢', name: 'turtle' },
  { from: 10, emoji: '🐇', name: 'rabbit' },
  { from: 15, emoji: '🦊', name: 'fox' },
  { from: 20, emoji: '🦉', name: 'owl' },
  { from: 25, emoji: '🐬', name: 'dolphin' },
  { from: 30, emoji: '🦁', name: 'lion' },
  { from: 35, emoji: '🐯', name: 'tiger' },
  { from: 40, emoji: '🦅', name: 'eagle' },
  { from: 45, emoji: '🐘', name: 'elephant' },
  { from: 50, emoji: '🐋', name: 'whale' },
  { from: 60, emoji: '🐉', name: 'dragon' },
];

export function streakAnimal(days: number): { emoji: string; name: string } {
  let tier = LADDER[0];
  for (const t of LADDER) if (days >= t.from) tier = t;
  return tier;
}

/** True on the day a streak reaches a new animal (5, 10, 15… and 60). */
export const isNewAnimal = (days: number) => days > 1 && LADDER.some((t) => t.from === days);
