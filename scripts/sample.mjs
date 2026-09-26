// Prints stats for a run of generated puzzles: node scripts/sample.mjs [days] [startDate]
import { readFileSync } from 'node:fs';
import { prepareDictionary } from '../src/solver.js';
import { generatePuzzle, shiftDateKey, EPOCH } from '../src/generator.js';

const days = Number(process.argv[2] ?? 30);
const start = process.argv[3] ?? EPOCH;
const dict = prepareDictionary(readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));
const seeds = readFileSync(new URL('../data/pangrams.txt', import.meta.url), 'utf8').split('\n').filter(Boolean);

const t0 = performance.now();
for (let i = 0; i < days; i++) {
  const key = shiftDateKey(start, i);
  const s = performance.now();
  const p = generatePuzzle(dict, seeds, key);
  const ms = (performance.now() - s).toFixed(0);
  console.log(`${key} #${p.number} ${p.letters.join('')} key=${p.centerLetter} words=${p.answers.size} max=${p.maxScore} pangrams=${p.pangrams.join(',')} ${ms}ms`);
}
console.log(`avg ${((performance.now() - t0) / days).toFixed(0)}ms`);
