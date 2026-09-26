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

- someone opens the game (once per player per day, with their rough location from Cloudflare, e.g. "🇺🇸 Brooklyn, NY", and today's player count). IP addresses are never sent.
- a new player picks a name
- a Blitz round finishes
- someone finds every word of the daily

ntfy.sh limits anonymous senders by IP address, and Cloudflare Workers share IP addresses, so pushes sent without logging in are refused with a 429 error. Create a free ntfy.sh account and an access token (Account → Access tokens), then save it as the repository secret `NTFY_TOKEN`. An ntfy login doesn't help: free accounts are still limited by IP address. The fix is to relay pings through GitHub Actions, whose servers ntfy accepts. Add a repository secret `GH_NOTIFY_TOKEN` holding a fine-grained GitHub token for this repo with **Contents: Read and write** permission. The Worker then triggers `.github/workflows/notify.yml`, which sends the ping, usually 20–40 seconds later. `GET /api/notify-status` shows delivery counts, the route used and the last error.

To turn it on, add a repository secret named `NTFY_TOPIC` holding a hard-to-guess topic name, and subscribe to that same topic in the ntfy app. The next deploy passes it to the Worker as a secret. Anyone who knows the topic can read the notifications, so keep it private.
