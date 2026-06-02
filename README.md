# Clothing Sales Tracker

Tinder-style swipe UI over a unified feed of newly-on-sale clothes scraped from multiple retailers. Built with Expo (iOS + Web). The "backend" is GitHub Actions: a scheduled workflow scrapes each site with Playwright, commits the snapshot JSON to this repo, and sends an Expo push notification when new items appear. A self-heal workflow runs Claude Code automatically when a scraper breaks and opens a PR with the fix.

## Features

- **Zero-infrastructure backend.** GitHub Actions is the runtime, the repo is the database (`data/*.json`), and `raw.githubusercontent.com` is the CDN. No Fly.io / Railway / Vercel / Supabase to deploy, monitor, or pay for.
- **Self-healing scrapers.** A scraper failure isn't a page — it's a workflow chain. The failing job uploads a 4 KB HTML snippet plus the structured `ScrapeError` context as an artifact and exits non-zero. The `self-heal` workflow listens for `workflow_run.conclusion == 'failure'`, downloads the artifact, runs Claude Code headlessly with `--permission-mode acceptEdits` and a tightly-scoped tool allowlist, verifies the fix by running the scraper inside the same job, and opens a PR if (and only if) the patch produced a non-empty snapshot. Humans only get involved at review.
- **Immutable, auditable data history.** Every catalog change is a git commit on `main` (`data: update snapshots …`). Want to know when a product first hit sale, or diff today's catalog against last week's? `git log -p data/uniqlo-de-men.json`. No separate audit log to maintain.
- **Push notifications without push infrastructure.** The scrape job computes the snapshot diff in-process and `POST`s directly to `https://exp.host/--/api/v2/push/send` with the device's Expo token (stored as a repo secret). No FCM project, no APNs certificates, no server-side queue, no token-rotation pipeline.
- **Per-source fault isolation.** Each retailer is one file in `packages/scrapers/src/`. A breakage in Zara doesn't stop Uniqlo from running — failures are tracked per-source in `<source>.failure.json` artifacts, and the diff/notify path only fires for sources that succeeded.
- **Reproducible builds.** pnpm lockfile committed, Node version pinned via `.nvmrc`, Playwright browser binaries pinned by package version with `--with-deps` for system libs. CI runs match local runs deterministically.
- **Concurrency-safe cron.** `concurrency: { group: scrape, cancel-in-progress: false }` prevents overlapping runs from racing on `git push` to the same branch. If a previous run is still going, the next cron tick queues behind it.
- **Least-privilege CI tokens.** `scrape.yml` requests `contents: write` only; `self-heal.yml` adds `pull-requests: write` only. The Anthropic API key is never exposed to the scrape workflow — only the self-heal job can read it.
- **Cost ≈ $0/year.** Public repo → unlimited Actions minutes, free CDN, free raw file serving. The only metered cost is Anthropic API for self-heal, which only burns tokens when a scraper actually breaks (~$0.25/incident, single-digit dollars/year).

## Layout

```
apps/mobile/             Expo app (iOS + web)
packages/shared/         Product type + snapshot diff
packages/scrapers/       Per-site Playwright scrapers (start: Uniqlo DE Men)
scripts/scrape.ts        CLI runner
data/                    Committed JSON snapshots (one per source)
.github/workflows/
  scrape.yml             Cron every 6h → scrape → commit → push notify
  self-heal.yml          On scrape failure → Claude Code → PR
```

## Local dev

```bash
pnpm install
pnpm --filter @cst/scrapers exec playwright install chromium
pnpm scrape:uniqlo        # writes data/uniqlo-de-men.json
pnpm mobile               # starts Expo (press i for iOS, w for web)
```

## GitHub setup (one-time)

1. Create a GitHub repo and push this directory.
2. Open `apps/mobile/app.json` and replace `REPLACE_ME` in `snapshotBaseUrl` with your GitHub user/org so the app fetches from `raw.githubusercontent.com/<you>/clothing-sales-tracker/main/data`.
3. Add these repo secrets (Settings → Secrets and variables → Actions):

   | Secret | Used by | What |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | self-heal.yml | Lets Claude Code fix broken scrapers automatically |
   | `EXPO_PUSH_TOKEN` | scrape.yml | Your device's Expo push token (get it from the app via `Notifications.getExpoPushTokenAsync`) |

4. The `scrape` workflow runs every 6 hours and on manual dispatch. The first run creates the snapshots. Subsequent runs diff against the committed JSON and push if there are new items.

## Adding a new site

1. Create `packages/scrapers/src/<source>.ts` exporting an async function returning `Snapshot`.
2. Add the source to the `Source` union in `packages/shared/src/product.ts` and register the scraper in `packages/scrapers/src/index.ts`.
3. Add the source to `ACTIVE_SOURCES` in `apps/mobile/src/config.ts`.
4. `pnpm scrape <source-substring>` to verify locally.

## How the self-heal loop works

When a scraper fails (selector miss, pagination stall, zero products extracted), `scripts/scrape.ts` writes a `.scrape-artifacts/<source>.failure.json` containing the stage, error message, and a 4 KB HTML snippet from the live page. The scrape workflow uploads that artifact and exits non-zero. The `self-heal` workflow watches scrape's `workflow_run`, downloads the artifact, installs the Claude Code CLI, and runs it headlessly with a tightly-scoped prompt: read the failure JSON, edit only the broken scraper file, verify with `pnpm scrape <source>`, then summarize. If Claude produces changes, a PR is opened against `main`.
