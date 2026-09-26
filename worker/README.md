# DPIYF Lettertown leaderboard (Cloudflare Worker)

This is the leaderboard API: one Worker plus a Durable Object that stores scores. It uses the same setup as the Streets of Fury relay, and it runs on the Workers Free plan.

The game on GitHub Pages calls it at `https://word-game-leaderboard.danlagstein.workers.dev`. That address is set as `VITE_API_BASE` in `.github/workflows/deploy-pages.yml`.

## Deploy

**Automatically from GitHub (recommended).** Add a repository secret named `CLOUDFLARE_API_TOKEN`: a Cloudflare API token made from the **Edit Cloudflare Workers** template. After that, every push to `main` deploys the Worker.

**Or by hand** from this `worker/` folder:

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Check that it's up: opening the Worker URL should show "DPIYF Lettertown leaderboard is running."

## How it scores

The Pages build writes answer tables to `/scores/` on the game site, one per daily puzzle and one per Blitz board. The Worker fetches the table for a puzzle and scores the submitted words itself, so a client can't post a made-up score. The rules live in `../server/leaderboard.ts`, and the unit tests are in `../server/leaderboard.test.ts`.

## Notifications

The Worker can ping your phone when people play, through [ntfy](https://ntfy.sh), a free app that needs no account:

- someone opens the game (once per player per day, with today's player count)
- a new player picks a name
- a Blitz round finishes
- someone finds every word of the daily

To turn it on, add a repository secret named `NTFY_TOPIC` holding a hard-to-guess topic name, and subscribe to that same topic in the ntfy app. The next deploy passes it to the Worker as a secret. Anyone who knows the topic can read the notifications, so keep it private.
