// Sends the answer tables from scripts/build-scores.ts to the leaderboard server, the only
// place they're kept. Prints counts only, never a table.
// Usage: API=https://… ADMIN_KEY=… npx vite-node scripts/upload-tables.ts [dir]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'private/scores';
const { API, ADMIN_KEY } = process.env;
if (!API || !ADMIN_KEY) throw new Error('API and ADMIN_KEY are required');

const files: [string, string][] = [
  ...readdirSync(join(dir, 'daily')).map((f): [string, string] => [`daily/${f.replace(/\.json$/, '')}`, join(dir, 'daily', f)]),
  ...readdirSync(join(dir, 'blitz')).map((f): [string, string] => [`blitz/${f.replace(/\.json$/, '')}`, join(dir, 'blitz', f)]),
  ['blitz-pool', join(dir, 'blitz-pool.json')],
];

let stored = 0;
for (let i = 0; i < files.length; i += 50) {
  const tables = Object.fromEntries(files.slice(i, i + 50).map(([name, file]) => [name, JSON.parse(readFileSync(file, 'utf8'))]));
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}/api/admin/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ADMIN_KEY, tables }),
    });
    if (res.ok) {
      stored += ((await res.json()) as { stored: number }).stored;
      break;
    }
    if (attempt === 4) throw new Error(`Upload failed (${res.status})`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
console.log(`Uploaded ${files.length} tables (${stored} new or changed).`);
