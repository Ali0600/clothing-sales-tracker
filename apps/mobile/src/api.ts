import type { Snapshot, Source } from "@cst/shared";
import { ACTIVE_SOURCES, snapshotUrl } from "./config";

export interface FetchResult {
  snapshots: Snapshot[];
  errors: Array<{ source: Source; message: string }>;
}

export async function fetchAllSnapshots(): Promise<FetchResult> {
  const results = await Promise.allSettled(
    ACTIVE_SOURCES.map(async (source) => ({ source, snapshot: await fetchSnapshot(source) })),
  );
  const snapshots: Snapshot[] = [];
  const errors: FetchResult["errors"] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") snapshots.push(r.value.snapshot);
    else errors.push({ source: ACTIVE_SOURCES[i], message: (r.reason as Error).message });
  }
  return { snapshots, errors };
}

export async function fetchSnapshot(source: Source): Promise<Snapshot> {
  const url = `${snapshotUrl(source)}?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source} from ${snapshotUrl(source)}`);
  return (await res.json()) as Snapshot;
}
