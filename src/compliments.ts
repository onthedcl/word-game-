// Silly praise for longer words. Shown now and then, so it stays a treat.
const LINES = [
  "You're good at this!",
  'Have you been wording my mind?',
  'Gimme a high 5! ✋',
  'Letter-ally brilliant!',
  'Spell-binding!',
  'Vocab-ulous!',
  'Hex-cellent!',
  'Word up!',
  'Show-off 😎',
  'Big brain alert 🧠',
  'Lexi-licious!',
  'The town is talking!',
  'Now you’re just showing off',
  'Key to my heart 🔑',
  'Tile-tastic!',
];

let shown = 0;

/**
 * A compliment for a word, or null. Seven-plus letters always earns one; five or six
 * letters earns one the first time and then about one time in three.
 */
export function complimentFor(word: string, random = Math.random): string | null {
  if (word.length < 5) return null;
  if (word.length < 7 && shown > 0 && random() > 1 / 3) return null;
  shown++;
  return LINES[Math.floor(random() * LINES.length)];
}
