import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Product, Snapshot } from "@cst/shared";

export type Swipe = "like" | "dislike" | "maybe";

const SWIPES_KEY = "v1:swipes";
const SEEN_KEY = "v1:seen";
const CATALOG_KEY = "v1:catalog";

export interface CatalogEntry {
  product: Product;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type Catalog = Record<string, CatalogEntry>;

export async function loadSwipes(): Promise<Record<string, Swipe>> {
  const raw = await AsyncStorage.getItem(SWIPES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, Swipe>) : {};
}

export async function saveSwipe(id: string, swipe: Swipe): Promise<void> {
  const all = await loadSwipes();
  all[id] = swipe;
  await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(all));
}

export async function bulkSaveSwipes(ids: string[], swipe: Swipe): Promise<void> {
  if (ids.length === 0) return;
  const all = await loadSwipes();
  for (const id of ids) all[id] = swipe;
  await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(all));
}

export async function resetAllSwipes(): Promise<void> {
  await AsyncStorage.removeItem(SWIPES_KEY);
}

export async function loadSeen(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SEEN_KEY);
  if (!raw) return new Set();
  return new Set(JSON.parse(raw) as string[]);
}

export async function markSeen(ids: string[]): Promise<void> {
  const seen = await loadSeen();
  for (const id of ids) seen.add(id);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

export async function loadCatalog(): Promise<Catalog> {
  const raw = await AsyncStorage.getItem(CATALOG_KEY);
  return raw ? (JSON.parse(raw) as Catalog) : {};
}

export async function mergeIntoCatalog(snapshots: Snapshot[]): Promise<Catalog> {
  if (snapshots.length === 0) return loadCatalog();
  const catalog = await loadCatalog();
  for (const snapshot of snapshots) {
    const ts = snapshot.scrapedAt;
    for (const product of snapshot.products) {
      const existing = catalog[product.id];
      catalog[product.id] = existing
        ? { product, firstSeenAt: existing.firstSeenAt, lastSeenAt: ts }
        : { product, firstSeenAt: ts, lastSeenAt: ts };
    }
  }
  await AsyncStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  return catalog;
}
