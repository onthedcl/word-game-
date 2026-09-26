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
