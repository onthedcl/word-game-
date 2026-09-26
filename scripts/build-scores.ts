// Writes the answer tables the leaderboard server scores against:
//   dist/scores/daily/<board id>.json     (from launch day to ~13 months ahead)
//   dist/scores/blitz/<seed>.json         (the pool of ranked Blitz boards)
//   dist/scores/blitz-pool.json           (list of pool seeds)
// Usage: npx vite-node scripts/build-scores.ts [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dict, seeds } from '../src/engine/node-dict';
import { generateBlitz, generateDaily } from '../src/engine/generator';
import { dateKeyFor, EPOCH, shiftDateKey } from '../src/engine/dates';
import { answerTable, BLITZ_POOL_SIZE, blitzPoolSeed } from '../server/tables';

const out = process.argv[2] ?? 'dist/scores';
const DAYS_AHEAD = 400;
mkdirSync(join(out, 'daily'), { recursive: true });
mkdirSync(join(out, 'blitz'), { recursive: true });

const last = shiftDateKey(dateKeyFor(), DAYS_AHEAD);
let days = 0;
for (let d = EPOCH; d <= last; d = shiftDateKey(d, 1), days++) {
  const puzzle = generateDaily(dict, seeds, d);
  writeFileSync(join(out, 'daily', `${puzzle.boardId}.json`), JSON.stringify(answerTable(puzzle)));
}

const pool = Array.from({ length: BLITZ_POOL_SIZE }, (_, i) => blitzPoolSeed(i));
for (const seed of pool) {
  writeFileSync(join(out, 'blitz', `${seed}.json`), JSON.stringify(answerTable(generateBlitz(dict, seeds, seed))));
}
writeFileSync(join(out, 'blitz-pool.json'), JSON.stringify(pool));
console.log(`Wrote ${days} daily and ${pool.length} Blitz answer tables to ${out}`);
