// Builds the answer tables the leaderboard server scores against, into a private folder
// (never the published site):
//   <outDir>/daily/<board id>.json   (from launch day to ~13 months ahead)
//   <outDir>/blitz/<seed>.json       (the pool of ranked Blitz boards)
//   <outDir>/blitz-pool.json         (list of pool seeds)
// Boards from SECRET_BOARDS_FROM on (and all Blitz boards) need BOARD_SECRET, which only the
// leaderboard server and the build know; scripts/upload-tables.ts then sends them to the server.
// Usage: BOARD_SECRET=… npx vite-node scripts/build-scores.ts [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accepted, dict, full, seeds } from '../src/engine/node-dict';
import { generateBlitz, generateDaily, withAnswers } from '../src/engine/generator';
import { dateKeyFor, EPOCH, shiftDateKey } from '../src/engine/dates';
import { answerTable, BLITZ_POOL_SIZE, blitzPoolSeed } from '../server/tables';

const out = process.argv[2] ?? 'private/scores';
const secret = process.env.BOARD_SECRET;
if (!secret || secret.length < 32) throw new Error('BOARD_SECRET is missing');
const DAYS_AHEAD = 400;
mkdirSync(join(out, 'daily'), { recursive: true });
mkdirSync(join(out, 'blitz'), { recursive: true });

const last = shiftDateKey(dateKeyFor(), DAYS_AHEAD);
let days = 0;
for (let d = EPOCH; d <= last; d = shiftDateKey(d, 1), days++) {
  const common = generateDaily(dict, seeds, d, undefined, secret);
  const puzzle = withAnswers(common, accepted, full);
  writeFileSync(join(out, 'daily', `${puzzle.boardId}.json`), JSON.stringify(answerTable(puzzle, common)));
}

const pool = Array.from({ length: BLITZ_POOL_SIZE }, (_, i) => blitzPoolSeed(i));
for (const seed of pool) {
  const common = generateBlitz(dict, seeds, seed, secret);
  writeFileSync(join(out, 'blitz', `${seed}.json`), JSON.stringify(answerTable(withAnswers(common, accepted, full), common)));
}
writeFileSync(join(out, 'blitz-pool.json'), JSON.stringify(pool));
console.log(`Wrote ${days} daily and ${pool.length} Blitz answer tables to ${out}`);
