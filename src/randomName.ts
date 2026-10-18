// Made-up leaderboard names for players who'd rather not think of one: "Sunny Otter 42".
// Always 2–16 letters, digits and spaces, so the server takes them as they are.

const ADJECTIVES = [
  'Brave', 'Bright', 'Bold', 'Breezy', 'Calm', 'Clever', 'Cosmic', 'Cozy', 'Crafty', 'Dapper', 'Eager', 'Fancy',
  'Fizzy', 'Gentle', 'Giddy', 'Golden', 'Happy', 'Jolly', 'Keen', 'Lucky', 'Lively', 'Merry', 'Mighty', 'Nifty',
  'Peppy', 'Plucky', 'Quick', 'Quirky', 'Rosy', 'Snappy', 'Sunny', 'Swift', 'Witty', 'Zesty', 'Zippy',
];

const ANIMALS = [
  'Badger', 'Bee', 'Bison', 'Crane', 'Crow', 'Deer', 'Duck', 'Eagle', 'Ferret', 'Finch', 'Fox', 'Gecko', 'Goose',
  'Hare', 'Heron', 'Koala', 'Lemur', 'Lynx', 'Moose', 'Newt', 'Otter', 'Owl', 'Panda', 'Puffin', 'Quail', 'Raven',
  'Robin', 'Seal', 'Sloth', 'Swan', 'Tiger', 'Toad', 'Walrus', 'Wombat', 'Wren', 'Yak', 'Zebra',
];

const pick = <T,>(list: readonly T[], rand: () => number) => list[Math.floor(rand() * list.length)];

export function randomName(rand: () => number = Math.random): string {
  for (;;) {
    const name = `${pick(ADJECTIVES, rand)} ${pick(ANIMALS, rand)} ${10 + Math.floor(rand() * 90)}`;
    if (name.length <= 16) return name;
  }
}
