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

// Said when a player with a streak opens the game for the first time in a day.
const PEP_TALKS = [
  'Those words aren’t going to find themselves.',
  'The letters missed you.',
  'Somewhere on this board, a pangram is hiding from you.',
  'Stretch those fingers, the words await.',
  'Your vocabulary called. It wants a workout.',
  'Go get ’em, word wizard.',
  'The key tile has been waiting all night for you.',
  'Today’s board looks nervous.',
  'Let’s make the dictionary proud.',
  'Word by word, you’re unstoppable.',
  'Rumour has it there’s a juicy one in the corner.',
  'The dictionary called. It’s rooting for you.',
];

/**
 * The daily hello for a player with a streak. `playedToday` is whether today's day already
 * counts; `pick` chooses the pep talk (a number from 0 to 1).
 */
export function streakGreeting(count: number, playedToday: boolean, pick: number): string {
  const { emoji } = streakAnimal(count);
  const talk = PEP_TALKS[Math.floor(pick * PEP_TALKS.length) % PEP_TALKS.length];
  if (playedToday) return `${emoji} ${count}-day streak! ${talk}`;
  return `${emoji} ${count} ${count === 1 ? 'day' : 'days'} in a row! Find a word today to make it ${count + 1}. ${talk}`;
}
