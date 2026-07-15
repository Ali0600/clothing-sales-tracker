# CLAUDE.md

Notes for Claude sessions working in this repo. Read before touching code.

## What this is

Personal "Tinder for sale clothes." Expo app (iOS + web) reads JSON snapshots
of retailer sale catalogs. Snapshots are produced by Playwright scrapers run
on a GitHub Actions cron and committed back to `data/`. No backend server;
GitHub Actions IS the backend.

**Healing is NOT in this repo.** When a scraper breaks, CI fails loudly and
publishes a failure signal (artifact + `scrape-failure` issue). A local poller,
https://github.com/Ali0600/self-healing-script, consumes that signal and runs
headless Claude Code on the Mac. Do not add a self-heal workflow back here.

## Project map

```
apps/mobile/             Expo SDK 52, expo-router, react-native-reanimated swipe deck
  app/
    _layout.tsx          MUST wrap in GestureHandlerRootView + SafeAreaProvider
    index.tsx            Home: swipe deck, refresh button, freshness label, trigger+poll on launch
    options.tsx          Settings: reject-all, reset-swipes, GitHub PAT
    catalog.tsx          Archive: every product ever scraped, with price history
  src/
    api.ts               fetchAllSnapshots returns { snapshots, errors } NOT Snapshot[]
    storage.ts           AsyncStorage: SwipeRecord, Catalog with priceHistory[]
    github.ts            workflow_dispatch trigger, isStale(), config from app.json
    components/SwipeDeck.tsx
packages/
  shared/                Product type, Snapshot, diffSnapshots (added/removed/repriced)
  scrapers/              Playwright scrapers. One file per source. Uniqlo registered.
scripts/scrape.ts        CLI: pnpm scrape [source] [--notify]
data/                    Committed snapshot JSON. Bot pushes here every 6h.
.github/workflows/
  scrape.yml             Cron 17 */6 * * *. Triggerable via workflow_dispatch.
                         On failure: upload artifact + open `scrape-failure` issue.
  eas-update.yml         On apps/mobile|packages change → publish OTA.
```

## Critical gotchas (don't re-discover these)

### pnpm monorepo with Expo

- **`.npmrc` has `node-linker=hoisted`** — Metro can't traverse pnpm's isolated symlinks. Do not remove.
- **Root `package.json` lists `@cst/shared` and `@cst/scrapers` as workspace deps** even though only `scripts/` uses them. Without this, hoisted mode doesn't symlink them into root `node_modules/` and `scripts/scrape.ts` can't resolve them.
- **`@expo/metro-runtime` must be an explicit dep of `apps/mobile`** — required by expo-router but not pulled in transitively.
- **Internal re-exports between TS files in workspace packages MUST NOT carry `.js` extensions** (`export * from "./product"`, not `"./product.js"`). TypeScript's `moduleResolution: Bundler` rewrites `.js`→`.ts` at typecheck time, and `tsx` is permissive, so the scripts and `pnpm -r typecheck` will both pass. But Metro's resolver does NOT do that rewrite — when the app bundle hits a `.js` import inside `@cst/shared`, it tries to read a literal `.js` file that doesn't exist and the simulator dies with "Unable to resolve module". The breakage is delayed because Metro caches transforms; a brand-new import elsewhere in the same file invalidates the cache and surfaces the underlying bug.

### Expo / React Native

- `_layout.tsx` MUST wrap children in `GestureHandlerRootView` AND `SafeAreaProvider` AND `RootErrorBoundary`. Missing either provider = blank white screen with no error. The boundary catches render errors that would otherwise leave the providers visible but empty.
- **Never use `Linking.openURL(https://...)` for external links.** It backgrounds the app; on resume Reanimated's worklet runtime can land in an undefined state and the screen renders blank. Use `WebBrowser.openBrowserAsync(url)` from `expo-web-browser` — opens an in-app `SFSafariViewController` on iOS, keeps the app process alive.
- `Alert.alert` is a silent no-op on Expo Web. Use tap-twice-to-confirm patterns instead.
- After changing the *shape* of an exported value, Metro's bundle cache survives Fast Refresh. Stop the dev server and restart with `--clear`.
- `app.json` has `newArchEnabled: true` to match Expo Go's hard-coded New Arch (Bridgeless) mode. Don't remove without explicit reason.
- `react-native-safe-area-context`'s `SafeAreaView` is what we use (not the deprecated one from `react-native`).

### EAS / OTA

- EAS Build + OTA config lives in `apps/mobile/` (`eas.json`, `app.json`). The CI OTA job (`.github/workflows/eas-update.yml`) installs deps at the **repo root** (`pnpm install --frozen-lockfile`, hoisted workspace) but runs `eas update` with `working-directory: apps/mobile` so eas-cli reads that app's `eas.json`/`app.json`. The app's `metro.config.js` `watchFolders` → workspace root already resolve `@cst/shared` for the EAS bundle.
- OTA (`eas update`) only reaches a build whose `runtimeVersion` matches. We use `runtimeVersion.policy: appVersion`, so a JS-only change ships via OTA, but a native module / SDK / version-number change needs a fresh `eas build`. Don't bump `app.json` `version` casually — it cuts the OTA channel.
- `useOtaUpdates` (in `app/_layout.tsx`) guards `__DEV__ || web || !Updates.isEnabled`, so it's inert locally — there is nothing to test in Expo Go. Verify OTA only against an installed EAS build.
- Expo account owner is `mhassan0600` (same as grocery-helper). `expo-updates` is pinned to the SDK-52 line (`~0.27.x`) via `npx expo install`, NOT the unified-version number.
- **The production build profile pins `ios.image: "latest"`.** Without it, EAS uses the `auto` image, which for SDK 52 selects an old Xcode 16.x (iOS 18.2 SDK). Apple now rejects uploads not built with the iOS 26 SDK (Xcode 26), so `eas submit` fails at the `altool` step with `STATE_ERROR.VALIDATION_ERROR`. `latest` resolves to `macos-tahoe-26.4-xcode-26.4`. After any submit-time "SDK version issue", bump/confirm this image — a build already made with the wrong SDK can't be resubmitted; rebuild.

### GitHub Actions

- `pnpm/action-setup@v4` rejects setups that pin pnpm in BOTH the workflow's `version:` input AND `package.json`'s `packageManager:` field. Drop the workflow input; let it read from `package.json`.
- The scrape workflow uses `actions/checkout@v4` with default behavior — committing back requires `permissions: contents: write` already set.
- **The failure signal is a contract with the external healer** ([Ali0600/self-healing-script](https://github.com/Ali0600/self-healing-script)) — don't change these without updating it: the artifact name `scrape-failure-<run_id>`, its `.scrape-artifacts/<source>.failure.json` payload shape (`context` with `source`, `stage`, `message`, `expectedCount`, `actualCount`, `htmlSnippet`), and the **`scrape-failure`** issue label the poller watches for. A healthy scrape auto-closes that issue. Do not commit `.scrape-artifacts/` (in `.gitignore`).

### Scraping

- Uniqlo SSRs only ~30 of the ~100 items; the rest hydrate as you scroll. Playwright is required (plain `curl` + HTML parse misses most products).
- Price format on Uniqlo DE is `12,90 €` (number first, German decimal comma). Regex must handle both `€ <num>` and `<num> €` and a `,` decimal separator.
- Pagination via `scrollBy()` doesn't fire Uniqlo's intersection observer. Use `tile.scrollIntoView({ block: "end" })` + `page.mouse.wheel()` to trigger lazy-load.
- The "total item count" lives in `.fr-ec-header-overlay__item-count` in the filter drawer header. Reliable as a sentinel for "did we scroll far enough."
- **Tiles show an EU "30-Day Lowest Price: X €" line** (Omnibus Directive). That's a THIRD price number (usually equal to the original), so the "two highest = original + sale" heuristic picks original twice and zeroes the discount. `extractProducts` drops any line matching `/lowest price/i` before parsing prices. The scraper also fails (stage `parse`) if >30% of items have no discount — a sale page should be almost entirely discounted, so a high no-discount ratio means price parsing broke; failing loudly publishes the failure signal instead of committing garbage.

### Data flow / state

- Swipes are stored as `SwipeRecord = { swipe, priceAtSwipe?, swipedAt? }`. Legacy entries (plain `"like"` string) auto-migrate on read in `loadSwipes()`.
- **Product `id` is the stable base design code** (`E465185-000`), NOT colorway-level. We briefly used `base-colorCode` (`E465185-000-34`) to match Uniqlo's item count, but Uniqlo rotates which colorway is the representative grid tile, so the suffix drifts between scrapes and breaks swipe persistence (swiped items kept re-appearing). The colorway suffix only changed the count by ~1 anyway. `baseProductId(id)` strips any suffix; `collapseToBaseSwipes` / `collapseToBaseCatalog` in `storage.ts` migrate old colorway-keyed swipes/seen/catalog down to base (most-recent swipe wins; merge priceHistory). Idempotent — runs on every `reload()`; `schedulePush()` fires if anything collapsed. When several colorways of one design appear in a scrape, the scraper keeps the **cheapest** tile.
- Re-surface logic: a swiped item returns to the deck ONLY on a genuine drop `>= SIGNIFICANT_DROP_PCT` (5%) below `priceAtSwipe` — never on rises or sub-threshold wiggles. The shared constant lives in `packages/shared` and is reused by the push-notification threshold in `scripts/scrape.ts`.
- Push notifications fire for adds + significant drops only (>= 5%, configurable via `PRICE_DROP_THRESHOLD` env).
- `SwipeDeck` holds `index` in local state. It survives focus refreshes — must be clamped when `products.length` drops below it (see `useEffect` in `SwipeDeck.tsx`).
- App fetches from `raw.githubusercontent.com/<owner>/<repo>/main/data/<source>.json`. Repo must be PUBLIC for this to work without auth.
- Cross-device state lives in a **private Gist** auto-created on first sync, described as `clothing-sales-tracker-state-v1` and containing one file `cst-state.json` (`{ swipes, seen, catalog }`). The gist ID is cached in `AsyncStorage["v1:sync_gist_id"]`. If AsyncStorage is wiped, sync re-discovers the gist by description on next run with a valid token.
- **Never tell the user to clear Expo Go's app data.** It wipes AsyncStorage (swipes, catalog, gist ID, PAT) and they will lose state since the last sync. Always reach for `pnpm --filter mobile start --clear` (Metro cache only) first.

## Commands

```bash
pnpm install                              # honors .npmrc node-linker=hoisted
pnpm --filter @cst/scrapers exec playwright install chromium  # one-time

pnpm scrape:uniqlo                        # local scrape, writes data/uniqlo-de-men.json
pnpm scrape uniqlo --notify               # also sends Expo push if EXPO_PUSH_TOKEN set
pnpm -r typecheck                         # all workspaces
pnpm --filter mobile start --clear        # Expo with Metro cache wiped

gh workflow run scrape.yml --ref main     # manually trigger CI scrape
gh run watch <run-id>                     # watch CI run
gh run view <run-id> --log-failed         # show only failed step logs
```

## Before declaring "done"

For any non-trivial change:

1. **`pnpm -r typecheck`** passes.
2. If touching `apps/mobile/`: actually launch with `pnpm --filter mobile start --clear` and confirm the affected screen renders. Typecheck does not catch missing providers, runtime imports, or shape mismatches at AsyncStorage boundaries.
3. If touching scrapers: run `pnpm scrape:uniqlo` locally and inspect `data/uniqlo-de-men.json` — verify `count > 50`, `avg discount > 10%`, no `salePrice === price` for every item.
4. If touching workflows: trigger manually with `gh workflow run` and `gh run watch` to confirm before relying on cron.
5. Snapshot shape changes (api.ts return type, storage record shapes) require a Metro `--clear`. Tell the user.

## Architecture decisions to NOT re-litigate

- **No hosted backend.** GitHub Actions is the backend. User said no to Fly.io / Railway / Cloudflare Workers. Snapshots committed to repo, served via `raw.githubusercontent.com`.
- **TypeScript + Playwright**, not Python + BS4. The user mentioned BS4 once — that's not what's running here. Playwright drives a real headless Chromium and works on JS-hydrated pages.
- **Per-source adapter pattern.** Adding a retailer = one new file in `packages/scrapers/src/`, register in `index.ts`, add to `Source` union in `packages/shared/src/product.ts`, add to `ACTIVE_SOURCES` in `apps/mobile/src/config.ts`. That's it.
- **AsyncStorage, not SecureStore**, for the GitHub PAT. Personal app, low stakes, and SecureStore doesn't work on web.
- **Snapshot is the latest only.** Long-term history lives in git (`git log -p data/...`) and per-device in `CatalogEntry.priceHistory[]`. We do not append every snapshot to a history file.

## Style

- No `Co-Authored-By` trailers on commits (user's global preference).
- TypeScript strict everywhere. Don't loosen.
- No emojis in code/docs unless explicitly asked.
- Workspace deps use `workspace:*` protocol.
