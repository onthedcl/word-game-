// Prints stats for a run of daily puzzles: npm run sample -- [days] [startDate]
import { dict, seeds } from '../src/engine/node-dict';
import { generateDaily, isAcceptable } from '../src/engine/generator';
import { EPOCH, shiftDateKey } from '../src/engine/dates';

const days = Number(process.argv[2] ?? 30);
const start = process.argv[3] ?? EPOCH;
const t0 = performance.now();
let worst = 0;
for (let i = 0; i < days; i++) {
  const key = shiftDateKey(start, i);
  const s = performance.now();
  const p = generateDaily(dict, seeds, key);
  const ms = performance.now() - s;
  worst = Math.max(worst, ms);
  console.log(
    `${key} #${p.number} ${p.letters.join('')} key=${p.centerLetter} words=${p.answers.length} max=${p.maxScore}`,
    `pangrams=${p.pangrams.join(',')} offset=${p.offset} ${ms.toFixed(0)}ms${isAcceptable(p) ? '' : ' REJECTED'}`,
  );
}
console.log(`avg ${((performance.now() - t0) / days).toFixed(0)}ms, worst ${worst.toFixed(0)}ms`);
