import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffSnapshots, type Snapshot, type Source } from "@cst/shared";
import { ScrapeError, scrapers } from "@cst/scrapers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DATA_DIR = join(REPO_ROOT, "data");
const ARTIFACTS_DIR = join(REPO_ROOT, ".scrape-artifacts");

async function loadPrevious(source: Source): Promise<Snapshot | null> {
  const file = join(DATA_DIR, `${source}.json`);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function writeSnapshot(snapshot: Snapshot): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, `${snapshot.source}.json`);
  await writeFile(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}

async function writeFailureArtifact(source: Source, error: ScrapeError): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const file = join(ARTIFACTS_DIR, `${source}.failure.json`);
  await writeFile(
    file,
    JSON.stringify({ source, occurredAt: new Date().toISOString(), context: error.context }, null, 2),
    "utf8",
  );
}

async function sendExpoPush(source: Source, addedCount: number): Promise<void> {
  const token = process.env.EXPO_PUSH_TOKEN;
  if (!token || addedCount === 0) return;
  const body = {
    to: token,
    title: "New items on sale",
    body: `${addedCount} new ${source} item${addedCount === 1 ? "" : "s"}`,
    sound: "default",
    priority: "high",
    data: { source, addedCount },
  };
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("Expo push failed:", res.status, await res.text());
  } catch (e) {
    console.error("Expo push error:", (e as Error).message);
  }
}

async function run(only?: string, notify = false): Promise<number> {
  const targets = (Object.entries(scrapers) as Array<[Source, (typeof scrapers)[Source]]>)
    .filter(([source, fn]) => fn != null && (!only || source === only || source.startsWith(only + "-") || source.includes(only)))
    .map(([source, fn]) => ({ source, fn: fn! }));

  if (targets.length === 0) {
    console.error(only ? `No scraper registered for "${only}"` : "No scrapers registered");
    return 1;
  }

  let failures = 0;
  for (const { source, fn } of targets) {
    console.log(`\n=== ${source} ===`);
    try {
      const previous = await loadPrevious(source);
      const current = await fn();
      const diff = diffSnapshots(previous, current);
      await writeSnapshot(current);
      console.log(
        `${source}: scraped ${current.products.length} products ` +
          `(+${diff.added.length} new, -${diff.removed.length} removed, ~${diff.repriced.length} repriced)`,
      );
      if (notify) await sendExpoPush(source, diff.added.length);
    } catch (e) {
      failures++;
      if (e instanceof ScrapeError) {
        console.error(`❌ ${source} failed:`, e.message);
        await writeFailureArtifact(source, e);
      } else {
        console.error(`❌ ${source} failed (unexpected):`, e);
      }
    }
  }
  return failures > 0 ? 2 : 0;
}

const args = process.argv.slice(2);
const notify = args.includes("--notify");
const only = args.find((a) => !a.startsWith("--"));
run(only, notify).then((code) => process.exit(code));
