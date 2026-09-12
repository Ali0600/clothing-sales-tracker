# Clothing Sales Tracker

A Tinder-style swipe app for clothes that just went on sale. It is built to pull deals from several retailers into one feed; one retailer (Uniqlo) is live so far. Built with Expo (iOS + Web). The "backend" is GitHub Actions: a scheduled workflow scrapes each site with Playwright, commits the snapshot JSON to this repo, and sends an Expo push notification when new items appear. When a scraper breaks, CI fails loudly and opens a `scrape-failure` issue. Fixing it happens outside this repo, in a local poller ([Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script)).

## Features

- **Zero-infrastructure backend.** GitHub Actions runs the code, the repo stores the data (`data/*.json`), and `raw.githubusercontent.com` serves it. There is no Fly.io / Railway / Vercel / Supabase to deploy, watch, or pay for.
- **Scrapers that fail loudly, with a failure signal a machine can read.** A broken scraper never commits bad data. `ScrapeError` stops the run when a selector misses, pagination stalls, zero products come out, or the discount check fails (>30% of items un-discounted on a sale page). The job uploads a 4 KB HTML snippet plus the structured error context as a `scrape-failure-<run_id>` artifact, exits non-zero, and opens one deduplicated `scrape-failure` issue. That issue plus artifact is the contract a healer reads. Today that healer is a local poller ([Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script)) that runs headless Claude Code on the Mac. A healthy scrape closes the issue by itself, so nobody has to tidy up.
- **A data history you can audit.** Every catalog change is a git commit on `main` (`data: update snapshots …`). Want to know when a product first went on sale, or compare today's catalog with last week's? Run `git log -p data/uniqlo-de-men.json`. There is no separate audit log to keep.
- **Push notifications without push servers.** The scrape job works out what changed and `POST`s straight to `https://exp.host/--/api/v2/push/send` with the device's Expo token (stored as a repo secret). No FCM project, no APNs certificates, no server-side queue, no token-rotation pipeline.
- **One source cannot break another.** Each retailer is one file in `packages/scrapers/src/`. If Zara breaks, Uniqlo still runs. Failures are tracked per source in `<source>.failure.json` artifacts, and the diff/notify step only runs for sources that worked.
- **Builds you can repeat.** The pnpm lockfile is committed, the Node version is pinned in `.nvmrc`, and the Playwright browser binaries are pinned by package version, with `--with-deps` for system libraries. A CI run matches a local run.
- **Cron runs that cannot overlap.** `concurrency: { group: scrape, cancel-in-progress: false }` stops two runs from racing on `git push` to the same branch. If a run is still going, the next cron tick waits behind it.
- **CI tokens with the least access needed.** `scrape.yml` asks for `contents: write` (to commit snapshots) and `issues: write` (to open and close the failure issue), and nothing else. No Anthropic key lives in CI at all. Healing runs on the Mac under a subscription, so there is no API credential a workflow could leak.
- **No silent skips.** A workflow that cannot do its job fails red instead of passing as a green no-op: `eas-update.yml` fails hard without `EXPO_TOKEN`. Truly optional features (push notifications without `EXPO_PUSH_TOKEN`) still run, but print a visible `::warning::`.
- **Cost ≈ $0/year.** The repo is public, so Actions minutes are unlimited, the CDN is free, and raw files are served free. Healing runs locally on subscription auth, so there is no per-incident API bill either.

## Layout

```
apps/mobile/             Expo app (iOS + web)
packages/shared/         Product type + snapshot diff
packages/scrapers/       Per-site Playwright scrapers (start: Uniqlo DE Men)
scripts/scrape.ts        CLI runner
data/                    Committed JSON snapshots (one per source)
.github/workflows/
  scrape.yml             Cron daily 05:17 UTC → scrape → commit → push notify
                         On failure: upload artifact + open `scrape-failure` issue
  eas-update.yml         On apps/mobile or packages change → publish OTA
```

> Healing lives outside this repo. [Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script) watches for the `scrape-failure` issue, downloads the run's failure artifact, and runs headless Claude Code on your machine.

## Local dev

```bash
pnpm install
pnpm --filter @cst/scrapers exec playwright install chromium
pnpm scrape:uniqlo        # writes data/uniqlo-de-men.json
pnpm mobile               # starts Expo (press i for iOS, w for web)
```

## GitHub setup (one-time)

1. Create a GitHub repo and push this directory.
2. Open `apps/mobile/app.json` and replace `REPLACE_ME` in `snapshotBaseUrl` with your GitHub user or org. The app then fetches from `raw.githubusercontent.com/<you>/clothing-sales-tracker/main/data`.
3. Add these repo secrets (Settings → Secrets and variables → Actions):

   | Secret | Used by | What |
   |---|---|---|
   | `EXPO_PUSH_TOKEN` | scrape.yml | Your device's Expo push token (get it from the app via `Notifications.getExpoPushTokenAsync`). Optional — without it the scrape still runs and warns. |
   | `EXPO_TOKEN` | eas-update.yml | Expo access token so CI can publish OTA updates (see Production builds & OTA) |

4. The `scrape` workflow runs once a day (05:17 UTC) and when you start it by hand. The first run creates the snapshots. Later runs compare against the committed JSON and push only when there are new items. (The app can also start a scrape when it opens, via `workflow_dispatch` — see On-launch refresh.)

## Production builds & OTA (EAS + TestFlight)

The app ships as a real iOS build through EAS. Over-the-air (OTA) updates then deliver JS and asset changes straight to installed builds, so most changes reach users without a new TestFlight submission.

**How it fits together:**

- `apps/mobile/eas.json` defines a `preview` profile (internal/simulator) and a `production` profile (`channel: production`, `autoIncrement` build numbers, `appVersionSource: remote`).
- `app.json` sets `runtimeVersion.policy: appVersion` and (after `eas init`) an `updates.url`. Production builds embed expo-updates.
- `apps/mobile/src/useOtaUpdates.ts` runs at launch and every time the app comes to the foreground. It checks for an update, downloads it, and shows a native **"Reload now?"** alert. It does nothing in dev, Expo Go, or web. It is wired in `app/_layout.tsx`.
- `.github/workflows/eas-update.yml` publishes an OTA to the `production` channel after CI passes on a push to `main` that touches `apps/mobile/**` or `packages/**`. It needs the `EXPO_TOKEN` secret and fails without it.

**One-time setup (run these yourself — they create cloud resources and need Apple credentials):**

```bash
cd apps/mobile
eas init                 # links the EAS project, writes extra.eas.projectId
eas update:configure     # writes updates.url, confirms runtimeVersion
eas build  --platform ios --profile production   # first native build (embeds expo-updates @ runtimeVersion 1.0.0)
eas submit --platform ios --profile production   # push that build to TestFlight (needs Apple Developer account)
```

Then add the **`EXPO_TOKEN`** repo secret (expo.dev → Account → Access tokens) so CI can publish OTA updates.

**OTA vs native build — the rule:**

| Change | How it ships |
|---|---|
| JS / styles / assets only | `eas update` (automatic via CI on push to main). Lands on next app launch. |
| New native module, SDK bump, `app.json` native config, version bump | Fresh `eas build` + `eas submit`. OTA can't cross a `runtimeVersion` change. |

> Before you submit a polished build to TestFlight, add `apps/mobile/assets/icon.png` (1024×1024) and set `expo.icon` in `app.json`. Without it, the build uses Expo's default placeholder icon.

## On-launch refresh (optional)

The app can start a fresh Uniqlo scrape when you open it, instead of waiting for the daily cron. It calls GitHub's `workflow_dispatch` API to run `scrape.yml`, then polls until the new snapshot lands (~30–60s).

Set up:

1. Create a **fine-grained PAT** at https://github.com/settings/personal-access-tokens/new:
   - **Repository access**: *Only select repositories* → `clothing-sales-tracker`
   - **Repository permissions**: **Actions** → *Read and write*
   - Generate it and copy it.
2. In the app: open **⚙︎ Options** → paste it under *GitHub token* → **Save token**.

What happens on the next launch:

- Snapshot fresh (≤30 min old) → nothing is triggered; the app shows the data right away.
- Snapshot stale → the app shows the stale data right away, starts a fresh scrape, and the banner reads *"Scraping Uniqlo…"*. When the new snapshot lands, it swaps in.
- At most one trigger per 5 minutes per device, so a bug cannot burn through Actions minutes.

You can change all thresholds in `apps/mobile/app.json` → `extra.freshness`.

## Cross-device sync (optional)

Swipes, the catalog, and price history live in `AsyncStorage` on the device. To share them across devices, and to keep them when you clear Expo Go, the app can sync them to a **private Gist** owned by your GitHub account.

Setup (once):

1. Reuse your existing PAT — but it needs the `Gist` scope. Either:
   - a **Classic PAT** at https://github.com/settings/tokens/new with `gist` checked (and `workflow` too if you also want the on-launch refresh above), or
   - a **Fine-grained PAT** at https://github.com/settings/personal-access-tokens/new with *Account permissions → Gists → Read and write*.
2. Paste it under *⚙︎ Options → GitHub token*.
3. The first time the app sees the token, it creates a private gist titled `clothing-sales-tracker-state-v1`. The gist ID is cached in AsyncStorage. If that cache is ever wiped, the app finds the gist again by its description.

Behaviour:

- **On every swipe**: the app schedules a push after a 5s pause, so 30 quick swipes = 1 sync round-trip.
- **When the home screen gets focus**: the app pulls the gist quietly in the background. If the remote state differs, it merges and redraws.
- **Merge rules**: for swipes, the entry with the later `swipedAt` wins; catalog entries merge `priceHistory` by `scrapedAt` and take `product` from whichever side has the later `lastSeenAt`; the seen-set is a union.
- The **Options screen** shows how long ago the last sync was, whether the gist is connected, and *Pull & merge* / *Sync now* buttons for manual control.

If you ever want to start clean, tap **Disconnect** in the Sync section. The gist stays in your GitHub account. The app just forgets the ID and creates a new gist next time.

## Adding a new site

1. Create `packages/scrapers/src/<source>.ts` that exports an async function returning `Snapshot`.
2. Add the source to the `Source` union in `packages/shared/src/product.ts` and register the scraper in `packages/scrapers/src/index.ts`.
3. Add the source to `ACTIVE_SOURCES` in `apps/mobile/src/config.ts`.
4. Run `pnpm scrape <source-substring>` to check it locally.

## What happens when a scraper breaks

This repo's job is to **fail loudly and publish a failure signal a machine can read**. It does not heal itself.

1. `ScrapeError` stops the run when a selector misses, pagination stalls, zero products come out, or the discount check fails (>30% of items un-discounted on a sale page).
2. `scripts/scrape.ts` writes `.scrape-artifacts/<source>.failure.json`: the stage, the error message, expected and actual counts, and a 4 KB HTML snippet from the live page.
3. `scrape.yml` uploads it as the artifact `scrape-failure-<run_id>`, exits non-zero, and opens (or comments on) one deduplicated issue labelled **`scrape-failure`**.
4. A healthy scrape closes any open `scrape-failure` issue.

Healing is deliberately **out-of-band**. [Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script) watches for that issue on the Mac, downloads the run's artifact, and runs headless Claude Code against it. That means subscription auth instead of API billing, and a home IP address the target sites actually serve.

**The contract to keep:** the `scrape-failure` issue label, the `scrape-failure-<run_id>` artifact name, and the `failure.json` shape. Change any of those and the local healer breaks.

## Experience Gained

- Ran a scraper backend with no servers: GitHub Actions is the runtime, the git repo is the database, and `raw.githubusercontent.com` is the CDN, for about $0/year.
- Wrote 1 Playwright scraper (`packages/scrapers/src/uniqlo.ts`) whose latest committed snapshot (`data/uniqlo-de-men.json`) holds 139 sale products.
- Scheduled the scrape once a day at 05:17 UTC behind a non-cancelling concurrency group, so overlapping runs queue instead of racing on `git push`.
- Made failures machine-readable: a broken scrape uploads a 4 KB HTML snippet plus a `failure.json`, exits non-zero, and opens 1 deduplicated `scrape-failure` issue that a separate self-healing tool consumes and a healthy run closes.
- Gated the OTA publish (`.github/workflows/eas-update.yml`) behind 2 checks: it runs via `workflow_run` only after CI succeeds and only for `event == push`, with the concurrency group keyed on `head_sha` so a later merge cannot cancel an earlier publish.
- Scoped workflow tokens to the least they need: `scrape.yml` gets 2 write permissions (`contents`, `issues`) and `eas-update.yml` gets `contents: read` only.
- Sent push notifications with no push infrastructure: the job diffs the snapshot and POSTs to Expo's push API, and 1 repo secret (`EXPO_PUSH_TOKEN`) is the whole setup.
