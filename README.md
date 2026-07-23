# Clothing Sales Tracker

Tinder-style swipe UI over a unified feed of newly-on-sale clothes scraped from multiple retailers. Built with Expo (iOS + Web). The "backend" is GitHub Actions: a scheduled workflow scrapes each site with Playwright, commits the snapshot JSON to this repo, and sends an Expo push notification when new items appear. When a scraper breaks, CI fails loudly and opens a `scrape-failure` issue — healing is handled out-of-band by a local poller ([Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script)).

## Features

- **Zero-infrastructure backend.** GitHub Actions is the runtime, the repo is the database (`data/*.json`), and `raw.githubusercontent.com` is the CDN. No Fly.io / Railway / Vercel / Supabase to deploy, monitor, or pay for.
- **Fail-loud scrapers with a machine-readable failure signal.** A broken scraper never commits garbage: `ScrapeError` aborts the run on a selector miss, a stalled paginate, zero extracted products, or a discount-sanity breach (>30% of items un-discounted on a sale page). The job uploads a 4 KB HTML snippet plus the structured error context as a `scrape-failure-<run_id>` artifact, exits non-zero, and opens a single deduplicated `scrape-failure` issue. That issue + artifact pair is the contract a healer consumes — currently a local poller ([Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script)) running headless Claude Code on the Mac. A healthy scrape auto-closes the issue, so the loop needs no human bookkeeping.
- **Immutable, auditable data history.** Every catalog change is a git commit on `main` (`data: update snapshots …`). Want to know when a product first hit sale, or diff today's catalog against last week's? `git log -p data/uniqlo-de-men.json`. No separate audit log to maintain.
- **Push notifications without push infrastructure.** The scrape job computes the snapshot diff in-process and `POST`s directly to `https://exp.host/--/api/v2/push/send` with the device's Expo token (stored as a repo secret). No FCM project, no APNs certificates, no server-side queue, no token-rotation pipeline.
- **Per-source fault isolation.** Each retailer is one file in `packages/scrapers/src/`. A breakage in Zara doesn't stop Uniqlo from running — failures are tracked per-source in `<source>.failure.json` artifacts, and the diff/notify path only fires for sources that succeeded.
- **Reproducible builds.** pnpm lockfile committed, Node version pinned via `.nvmrc`, Playwright browser binaries pinned by package version with `--with-deps` for system libs. CI runs match local runs deterministically.
- **Concurrency-safe cron.** `concurrency: { group: scrape, cancel-in-progress: false }` prevents overlapping runs from racing on `git push` to the same branch. If a previous run is still going, the next cron tick queues behind it.
- **Least-privilege CI tokens.** `scrape.yml` requests `contents: write` (commit snapshots) plus `issues: write` (open/close the failure alert), and nothing else. No Anthropic key lives in CI at all — healing runs on the Mac under a subscription, so there's no API credential to leak from a workflow.
- **No silent skips.** A workflow that can't do its job fails red rather than reporting a green no-op: `eas-update.yml` hard-fails without `EXPO_TOKEN`. Genuinely optional capabilities (push notifications without `EXPO_PUSH_TOKEN`) still run but emit a visible `::warning::`.
- **Cost ≈ $0/year.** Public repo → unlimited Actions minutes, free CDN, free raw file serving. Healing runs locally on subscription auth, so there's no per-incident API bill either.

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

> Healing lives outside this repo: [Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script) polls for the `scrape-failure` issue, pulls the run's failure artifact, and runs headless Claude Code locally.

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
   | `EXPO_PUSH_TOKEN` | scrape.yml | Your device's Expo push token (get it from the app via `Notifications.getExpoPushTokenAsync`). Optional — without it the scrape still runs and warns. |
   | `EXPO_TOKEN` | eas-update.yml | Expo access token so CI can publish OTA updates (see Production builds & OTA) |

4. The `scrape` workflow runs once a day (05:17 UTC) and on manual dispatch. The first run creates the snapshots. Subsequent runs diff against the committed JSON and push if there are new items. (The app can also trigger an on-demand scrape at launch via `workflow_dispatch` — see On-launch refresh.)

## Production builds & OTA (EAS + TestFlight)

The app ships as a real iOS build via EAS, with over-the-air (OTA) JS/asset updates so most changes reach installed builds without re-submitting to TestFlight.

**How it fits together:**

- `apps/mobile/eas.json` defines a `preview` profile (internal/simulator) and a `production` profile (`channel: production`, `autoIncrement` build numbers, `appVersionSource: remote`).
- `app.json` sets `runtimeVersion.policy: appVersion` and (after `eas init`) an `updates.url`. expo-updates is embedded in production builds.
- `apps/mobile/src/useOtaUpdates.ts` runs on launch and on every foreground: checks for an update, downloads it, and shows a native **"Reload now?"** alert. It no-ops in dev / Expo Go / web. Wired in `app/_layout.tsx`.
- `.github/workflows/eas-update.yml` auto-publishes an OTA to the `production` channel on every push to `main` that touches `apps/mobile/**` or `packages/**` (needs the `EXPO_TOKEN` secret; skips gracefully without it).

**One-time setup (run these yourself — they create cloud resources / need Apple credentials):**

```bash
cd apps/mobile
eas init                 # links the EAS project, writes extra.eas.projectId
eas update:configure     # writes updates.url, confirms runtimeVersion
eas build  --platform ios --profile production   # first native build (embeds expo-updates @ runtimeVersion 1.0.0)
eas submit --platform ios --profile production   # push that build to TestFlight (needs Apple Developer account)
```

Then add the **`EXPO_TOKEN`** repo secret (expo.dev → Account → Access tokens) so CI OTA publishing works.

**OTA vs native build — the rule:**

| Change | How it ships |
|---|---|
| JS / styles / assets only | `eas update` (automatic via CI on push to main). Lands on next app launch. |
| New native module, SDK bump, `app.json` native config, version bump | Fresh `eas build` + `eas submit`. OTA can't cross a `runtimeVersion` change. |

> Before a polished TestFlight submission, add `apps/mobile/assets/icon.png` (1024×1024) and set `expo.icon` in `app.json`. Without it the build uses Expo's default placeholder icon.

## On-launch refresh (optional)

The app can trigger a fresh scrape on Uniqlo when you open it (instead of waiting for the 6h cron). It does this by calling GitHub's `workflow_dispatch` API to run `scrape.yml`, then polling for the new snapshot to land (~30–60s).

Set up:

1. Create a **fine-grained PAT** at https://github.com/settings/personal-access-tokens/new:
   - **Repository access**: *Only select repositories* → `clothing-sales-tracker`
   - **Repository permissions**: **Actions** → *Read and write*
   - Generate, copy.
2. In the app: open **⚙︎ Options** → paste under *GitHub token* → **Save token**.

Behavior on next launch:

- Snapshot fresh (≤30 min old) → no trigger, show data immediately.
- Snapshot stale → show stale data immediately, kick off a fresh scrape, banner reads *"Scraping Uniqlo…"*. When the new snapshot lands, it swaps in.
- Rate-limited to one trigger per 5 minutes per device to avoid runaway Actions usage.

All thresholds are configurable in `apps/mobile/app.json` → `extra.freshness`.

## Cross-device sync (optional)

Swipes, the catalog, and price history live in `AsyncStorage` on the device. To share them across devices and survive clearing Expo Go, the app can sync them to a **private Gist** owned by your GitHub account.

Setup (once):

1. Re-use your existing PAT — but it needs `Gist` scope. Either:
   - **Classic PAT** at https://github.com/settings/tokens/new with `gist` checked (and optionally `workflow` if you also want the on-launch refresh from earlier), or
   - **Fine-grained PAT** at https://github.com/settings/personal-access-tokens/new with *Account permissions → Gists → Read and write*.
2. Paste under *⚙︎ Options → GitHub token*.
3. The first time the app sees the token it auto-creates a private gist titled `clothing-sales-tracker-state-v1`. The gist ID is cached in AsyncStorage; if that's ever wiped the app re-discovers the gist by description.

Behaviour:

- **On every swipe**: schedules a debounced push (5s) so 30 quick swipes = 1 sync round-trip.
- **On home focus**: silently pulls the gist in the background; if remote state differs, merges and re-renders.
- **Merge strategy**: swipes prefer the entry with the later `swipedAt`; catalog entries merge `priceHistory` by `scrapedAt` and overwrite `product` with whichever side has the later `lastSeenAt`; seen-set is a union.
- **Options screen** shows last-sync age, gist connection status, and *Pull & merge* / *Sync now* buttons for manual control.

If you ever want to start clean: tap **Disconnect** in the Sync section. The gist remains in your GitHub account; the app just forgets the ID and creates a new one next time.

## Adding a new site

1. Create `packages/scrapers/src/<source>.ts` exporting an async function returning `Snapshot`.
2. Add the source to the `Source` union in `packages/shared/src/product.ts` and register the scraper in `packages/scrapers/src/index.ts`.
3. Add the source to `ACTIVE_SOURCES` in `apps/mobile/src/config.ts`.
4. `pnpm scrape <source-substring>` to verify locally.

## What happens when a scraper breaks

This repo's job is to **fail loudly and publish a machine-readable failure signal** — it does not heal itself.

1. `ScrapeError` aborts the run on a selector miss, a stalled paginate, zero extracted products, or a discount-sanity breach (>30% of items un-discounted on a sale page).
2. `scripts/scrape.ts` writes `.scrape-artifacts/<source>.failure.json` — the stage, error message, expected/actual counts, and a 4 KB HTML snippet from the live page.
3. `scrape.yml` uploads it as artifact `scrape-failure-<run_id>`, exits non-zero, and opens (or comments on) a single deduplicated issue labeled **`scrape-failure`**.
4. A healthy scrape auto-closes any open `scrape-failure` issue.

Healing is deliberately **out-of-band**: [Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script) polls for that issue on the Mac, pulls the run's artifact, and runs headless Claude Code against it — subscription auth instead of API billing, and a residential IP the target sites actually serve.

**The contract to preserve:** the `scrape-failure` issue label, the `scrape-failure-<run_id>` artifact name, and the `failure.json` shape. Changing any of those breaks the local healer.
