// Puts a nightly backup back on the game server. Only for a real emergency: it overwrites
// every record in the backup with the backed-up version (records added since are left alone).
//
// 1. Download the backup (Actions → Backup → a run → Artifacts) and unzip it.
// 2. Decrypt it with the NTFY_TOPIC secret:
//      openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:KEY \
//        -in lettertown-backup.ndjson.gz.enc | gunzip > backup.ndjson
// 3. API=https://word-game-leaderboard.danlagstein.workers.dev ADMIN_KEY=… \
//      npx vite-node scripts/restore-backup.ts backup.ndjson
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const { API, ADMIN_KEY } = process.env;
if (!file || !API || !ADMIN_KEY) throw new Error('Usage: API=… ADMIN_KEY=… npx vite-node scripts/restore-backup.ts backup.ndjson');

let restored = 0;
for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const page = JSON.parse(line) as Record<string, unknown>;
  const keys = Object.keys(page);
  for (let i = 0; i < keys.length; i += 500) {
    const entries = Object.fromEntries(keys.slice(i, i + 500).map((k) => [k, page[k]]));
    const res = await fetch(`${API}/api/admin/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: ADMIN_KEY, confirm: 'restore', entries }),
    });
    if (!res.ok) throw new Error(`Restore failed after ${restored} records (${res.status})`);
    restored += ((await res.json()) as { restored: number }).restored;
  }
}
console.log(`Restored ${restored} records.`);
