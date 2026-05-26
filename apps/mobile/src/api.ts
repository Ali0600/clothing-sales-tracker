import type { Snapshot, Source } from "@cst/shared";
import { ACTIVE_SOURCES, snapshotUrl } from "./config";

export async function fetchAllSnapshots(): Promise<Snapshot[]> {
  const results = await Promise.allSettled(
    ACTIVE_SOURCES.map(async (source) => fetchSnapshot(source)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<Snapshot> => r.status === "fulfilled")
    .map((r) => r.value);
}

export async function fetchSnapshot(source: Source): Promise<Snapshot> {
  const res = await fetch(snapshotUrl(source), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source}`);
  return (await res.json()) as Snapshot;
}
