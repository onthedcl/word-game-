// Compact dictionary: a minimized trie (DAWG) built by scripts/build-dictionary.mjs.

export interface Dawg {
  readonly nodeCount: number;
  readonly wordCount: number;
  /** child node index, or -1. */
  child(node: number, letter: string): number;
  isWord(node: number): boolean;
  contains(word: string): boolean;
  /** Every word spellable using only `letters` (with repeats). */
  wordsFrom(letters: readonly string[]): string[];
}

export const ROOT = 0;
const code = (ch: string) => ch.charCodeAt(0) - 97;

export function parseDawg(text: string): Dawg {
  const lines = text.split('\n');
  const [magic, nodes, words] = lines[0].split(' ');
  if (magic !== 'HEXDAWG1') throw new Error('Not a Lettertown dictionary');
  const nodeCount = Number(nodes);
  const children = new Int32Array(nodeCount * 26).fill(-1);
  const terminal = new Uint8Array(nodeCount);

  for (let n = 0; n < nodeCount; n++) {
    let line = lines[n + 1];
    if (line.startsWith('!')) {
      terminal[n] = 1;
      line = line.slice(1);
    }
    if (!line) continue;
    for (const edge of line.split(',')) children[n * 26 + code(edge[0])] = parseInt(edge.slice(1), 36);
  }

  const child = (node: number, letter: string) => children[node * 26 + code(letter)];
  const isWord = (node: number) => terminal[node] === 1;

  return {
    nodeCount,
    wordCount: Number(words),
    child,
    isWord,
    contains(word) {
      let node = ROOT;
      for (const ch of word) {
        node = child(node, ch);
        if (node < 0) return false;
      }
      return isWord(node);
    },
    wordsFrom(letters) {
      const out: string[] = [];
      const walk = (node: number, prefix: string) => {
        if (isWord(node)) out.push(prefix);
        for (const l of letters) {
          const next = child(node, l);
          if (next >= 0) walk(next, prefix + l);
        }
      };
      walk(ROOT, '');
      return out.sort();
    },
  };
}
