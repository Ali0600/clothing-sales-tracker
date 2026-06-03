import AsyncStorage from "@react-native-async-storage/async-storage";
import { formatGitHubError, getToken } from "./github";
import {
  loadCatalog,
  loadSeen,
  loadSwipes,
  replaceCatalog,
  replaceSeen,
  replaceSwipes,
  type Catalog,
  type PricePoint,
  type SwipeRecord,
} from "./storage";

const GIST_DESCRIPTION = "clothing-sales-tracker-state-v1";
const GIST_FILENAME = "cst-state.json";
const GIST_ID_KEY = "v1:sync_gist_id";
const LAST_SYNC_KEY = "v1:sync_last_at";

interface RemoteState {
  version: 1;
  updatedAt: string;
  swipes: Record<string, SwipeRecord>;
  seen: string[];
  catalog: Catalog;
}

async function gh<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(await formatGitHubError(res));
  return (await res.json()) as T;
}

async function findOrCreateGist(token: string): Promise<string> {
  const stored = await AsyncStorage.getItem(GIST_ID_KEY);
  if (stored) return stored;

  const list = await gh<Array<{ id: string; description: string | null }>>(
    "https://api.github.com/gists?per_page=100",
    token,
  );
  const existing = list.find((g) => g.description === GIST_DESCRIPTION);
  if (existing) {
    await AsyncStorage.setItem(GIST_ID_KEY, existing.id);
    return existing.id;
  }

  const created = await gh<{ id: string }>("https://api.github.com/gists", token, {
    method: "POST",
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify({
            version: 1,
            updatedAt: new Date().toISOString(),
            swipes: {},
            seen: [],
            catalog: {},
          }),
        },
      },
    }),
  });
  await AsyncStorage.setItem(GIST_ID_KEY, created.id);
  return created.id;
}

async function readRemote(token: string): Promise<RemoteState | null> {
  const id = await findOrCreateGist(token);
  const gist = await gh<{ files: Record<string, { content?: string } | undefined> }>(
    `https://api.github.com/gists/${id}`,
    token,
  );
  const content = gist.files?.[GIST_FILENAME]?.content;
  if (!content) return null;
  try {
    return JSON.parse(content) as RemoteState;
  } catch {
    return null;
  }
}

async function writeRemote(
  token: string,
  state: Omit<RemoteState, "version" | "updatedAt">,
): Promise<void> {
  const id = await findOrCreateGist(token);
  const payload: RemoteState = { version: 1, updatedAt: new Date().toISOString(), ...state };
  await gh(`https://api.github.com/gists/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(payload) } } }),
  });
}

function mergeSwipes(
  local: Record<string, SwipeRecord>,
  remote: Record<string, SwipeRecord>,
): Record<string, SwipeRecord> {
  const out: Record<string, SwipeRecord> = { ...local };
  for (const [id, rec] of Object.entries(remote)) {
    const cur = out[id];
    if (!cur) {
      out[id] = rec;
      continue;
    }
    const a = cur.swipedAt ?? "";
    const b = rec.swipedAt ?? "";
    if (b > a) out[id] = rec;
  }
  return out;
}

function mergeCatalog(local: Catalog, remote: Catalog): Catalog {
  const out: Catalog = { ...local };
  for (const [id, r] of Object.entries(remote)) {
    const l = out[id];
    if (!l) {
      out[id] = r;
      continue;
    }
    const useRemote = r.lastSeenAt > l.lastSeenAt;
    const product = useRemote ? r.product : l.product;
    const lastSeenAt = useRemote ? r.lastSeenAt : l.lastSeenAt;
    const firstSeenAt = l.firstSeenAt < r.firstSeenAt ? l.firstSeenAt : r.firstSeenAt;
    const dedup = new Map<string, PricePoint>();
    for (const p of [...(l.priceHistory ?? []), ...(r.priceHistory ?? [])]) {
      dedup.set(p.scrapedAt, p);
    }
    const priceHistory = [...dedup.values()].sort((x, y) => x.scrapedAt.localeCompare(y.scrapedAt));
    out[id] = { product, firstSeenAt, lastSeenAt, priceHistory };
  }
  return out;
}

export type SyncResult =
  | { ok: true; merged: boolean }
  | { ok: false; reason: "no-token" | "http"; detail?: string };

export async function pullAndMerge(): Promise<SyncResult> {
  const token = await getToken();
  if (!token) return { ok: false, reason: "no-token" };
  try {
    const remote = await readRemote(token);
    if (!remote) {
      await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      return { ok: true, merged: false };
    }
    const [localSwipes, localSeen, localCatalog] = await Promise.all([
      loadSwipes(),
      loadSeen(),
      loadCatalog(),
    ]);
    const sortedLocalSeen = [...localSeen].sort();
    const mergedSwipes = mergeSwipes(localSwipes, remote.swipes ?? {});
    const mergedSeenArr = [...new Set([...localSeen, ...(remote.seen ?? [])])].sort();
    const mergedCatalog = mergeCatalog(localCatalog, remote.catalog ?? {});

    const before =
      JSON.stringify(localSwipes) +
      JSON.stringify(sortedLocalSeen) +
      JSON.stringify(localCatalog);
    const after =
      JSON.stringify(mergedSwipes) +
      JSON.stringify(mergedSeenArr) +
      JSON.stringify(mergedCatalog);
    const changed = before !== after;

    if (changed) {
      await Promise.all([
        replaceSwipes(mergedSwipes),
        replaceSeen(mergedSeenArr),
        replaceCatalog(mergedCatalog),
      ]);
    }
    await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    return { ok: true, merged: changed };
  } catch (e) {
    return { ok: false, reason: "http", detail: (e as Error).message };
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePush(delayMs = 5000): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, delayMs);
}

export async function pushNow(): Promise<SyncResult> {
  const token = await getToken();
  if (!token) return { ok: false, reason: "no-token" };
  try {
    const [swipes, seenSet, catalog] = await Promise.all([
      loadSwipes(),
      loadSeen(),
      loadCatalog(),
    ]);
    await writeRemote(token, { swipes, seen: [...seenSet], catalog });
    await AsyncStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    return { ok: true, merged: false };
  } catch (e) {
    return { ok: false, reason: "http", detail: (e as Error).message };
  }
}

export async function getLastSync(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNC_KEY);
}

export async function getGistId(): Promise<string | null> {
  return AsyncStorage.getItem(GIST_ID_KEY);
}

export async function disconnectSync(): Promise<void> {
  await AsyncStorage.multiRemove([GIST_ID_KEY, LAST_SYNC_KEY]);
}
