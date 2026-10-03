// Builds public/dict/words.dawg (the common words boards are built from, as a
// minimized trie), public/dict/words-all.dawg (every word accepted as an answer)
// public/dict/words-full.dawg (every ENABLE word, playable as a bonus word)
// and public/dict/pangrams.txt (curated pangram seeds).
//
// Sources (downloaded at build time, not committed):
//   - ENABLE word list (public domain) — the base of valid English words.
//   - FrequencyWords en_50k (hermitdave, MIT/CC-BY-SA) — used to drop obscure
//     words so the answer list feels fair.
//   - FrequencyWords en_full — any ENABLE word seen at least ALL_MIN_COUNT times
//     is accepted as an answer too, with its -s/-ed/-ing forms, so real words
//     like "tiled" and "sifts" aren't rejected.
//   - LDNOOBW English list — offensive words are removed.
//
// Usage: node scripts/build-dictionary.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = {
  enable: 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt',
  freq: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
  full: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_full.txt',
  bad: 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en',
};
const FREQ_LIMIT = 50000;   // words accepted as answers
const PANGRAM_LIMIT = 25000; // pangram seeds come from the more common words
const ALL_MIN_COUNT = 30;   // uses in the full corpus for the accepted list
const MIN_LEN = 4;
// --full-only rewrites just words-full.dawg (bonus words), never the lists boards are built from,
// so adding words can't change any board.
const FULL_ONLY = process.argv.includes('--full-only');
const MAX_PANGRAM_LEN = 10;

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return (await res.text()).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
}

const [enable, freq, full, bad] = await Promise.all(Object.values(SOURCES).map(fetchLines));
const enableSet = new Set(enable);
const badSet = new Set(bad);
const distinct = (w) => new Set(w).size;

const words = new Set();
const pangrams = new Set();
freq.slice(0, FREQ_LIMIT).forEach((line, rank) => {
  const w = line.split(' ')[0];
  if (!/^[a-z]+$/.test(w) || w.length < MIN_LEN) return;
  if (!enableSet.has(w) || badSet.has(w) || distinct(w) > 7) return;
  words.add(w);
  if (rank < PANGRAM_LIMIT && distinct(w) === 7 && w.length <= MAX_PANGRAM_LEN) pangrams.add(w);
});

// Accepted answers: the common words plus any ENABLE word that is used enough...
const allWords = new Set(words);
const used = new Set(); // includes 3-letter words, as stems for the forms below
for (const line of full) {
  const [w, n] = line.split(' ');
  if (Number(n) < ALL_MIN_COUNT) break; // the list is sorted by count
  if (!/^[a-z]+$/.test(w) || !enableSet.has(w) || badSet.has(w)) continue;
  used.add(w);
  if (w.length >= MIN_LEN) allWords.add(w);
}
// ...and every -s/-es/-ed/-ing form of those, since subtitles rarely use some
// forms of everyday words ("sift" is common, "sifts" isn't).
function stems(w) {
  const out = [];
  if (w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1));
  if (w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.endsWith('ies') || w.endsWith('ied')) out.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) out.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('ing')) out.push(w.slice(0, -3), w.slice(0, -3) + 'e');
  for (const suffix of ['ed', 'ing']) {
    const s = w.slice(0, -suffix.length);
    if (w.endsWith(suffix) && s.length > 2 && s.at(-1) === s.at(-2)) out.push(s.slice(0, -1)); // "fitted" -> "fit"
  }
  return out;
}
for (const w of enable) {
  if (w.length >= MIN_LEN && !allWords.has(w) && !badSet.has(w) && stems(w).some((s) => used.has(s))) allWords.add(w);
}

// ---- DAWG ------------------------------------------------------------------
// Build a trie, merge identical subtrees bottom-up, then serialize.
// Format: header line, then one line per node (root first):
//   optional "!" (node ends a word) followed by comma-separated edges
//   "<letter><child index in base 36>".
function buildDawg(list) {
  const root = { end: false, kids: new Map() };
  for (const w of list) {
    let n = root;
    for (const ch of w) {
      if (!n.kids.has(ch)) n.kids.set(ch, { end: false, kids: new Map() });
      n = n.kids.get(ch);
    }
    n.end = true;
  }
  const registry = new Map();
  const canon = (n) => {
    for (const [ch, kid] of n.kids) n.kids.set(ch, canon(kid));
    const sig = (n.end ? '!' : '') + [...n.kids].map(([ch, k]) => ch + k.id).join(',');
    if (!registry.has(sig)) registry.set(sig, Object.assign(n, { id: registry.size }));
    return registry.get(sig);
  };
  const top = canon(root);
  const order = [];
  const index = new Map();
  const visit = (n) => {
    if (index.has(n)) return;
    index.set(n, order.length);
    order.push(n);
    for (const kid of n.kids.values()) visit(kid);
  };
  visit(top);
  const lines = order.map((n) =>
    (n.end ? '!' : '') + [...n.kids].map(([ch, k]) => ch + index.get(k).toString(36)).join(','));
  return { text: `HEXDAWG1 ${order.length} ${list.length}\n${lines.join('\n')}\n`, nodes: order.length };
}

const sorted = (s) => [...s].sort();
const dawg = buildDawg(sorted(words));
if (!FULL_ONLY) writeFileSync(join(ROOT, 'public/dict/words.dawg'), dawg.text);
// Bonus words: every other ENABLE word (a public-domain list of game-legal
// words). They're accepted and score points, but don't count
// toward a board's total, so finding every word stays achievable.
const fullWords = enable.filter((w) => /^[a-z]+$/.test(w) && w.length >= MIN_LEN && !badSet.has(w));
// Plus newer words ENABLE lacks (from SCOWL, size 60) and words the owner has added.
for (const file of ['scowl-extra.txt', 'extra-words.txt']) {
  const lines = readFileSync(join(ROOT, 'scripts/data', file), 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const w = raw.trim().toLowerCase();
    if (/^[a-z]+$/.test(w) && w.length >= MIN_LEN && !badSet.has(w)) fullWords.push(w);
  }
}
const fullDawg = buildDawg(sorted(new Set(fullWords)));
writeFileSync(join(ROOT, "public/dict/words-full.dawg"), fullDawg.text);
console.log(`every playable word: ${fullWords.length} (${fullDawg.text.length} bytes)`);

const all = buildDawg(sorted(allWords));
if (!FULL_ONLY) {
  writeFileSync(join(ROOT, 'public/dict/words-all.dawg'), all.text);
  writeFileSync(join(ROOT, 'public/dict/pangrams.txt'), sorted(pangrams).join('\n') + '\n');
}
console.log(`accepted words: ${allWords.size} (${all.text.length} bytes)`);
console.log(`words: ${words.size} (${dawg.nodes} DAWG nodes, ${dawg.text.length} bytes), pangram seeds: ${pangrams.size}`);
