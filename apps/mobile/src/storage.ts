import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Product, Snapshot } from "@cst/shared";

export type Swipe = "like" | "dislike" | "maybe";

export interface SwipeRecord {
  swipe: Swipe;
  priceAtSwipe?: number;
  swipedAt?: string;
}

const SWIPES_KEY = "v1:swipes";
const SEEN_KEY = "v1:seen";
const CATALOG_KEY = "v1:catalog";

export interface PricePoint {
  scrapedAt: string;
  salePrice: number;
  price: number;
}

export interface CatalogEntry {
  product: Product;
  firstSeenAt: string;
  lastSeenAt: string;
  priceHistory?: PricePoint[];
}

export type Catalog = Record<string, CatalogEntry>;

function normalizeSwipe(v: unknown): SwipeRecord | null {
  if (typeof v === "string" && (v === "like" || v === "dislike" || v === "maybe")) {
    return { swipe: v };
  }
  if (v && typeof v === "object" && "swipe" in v) {
    return v as SwipeRecord;
  }
  return null;
}

export async function loadSwipes(): Promise<Record<string, SwipeRecord>> {
  const raw = await AsyncStorage.getItem(SWIPES_KEY);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, SwipeRecord> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const norm = normalizeSwipe(v);
    if (norm) out[k] = norm;
  }
  return out;
}

export async function saveSwipe(
  id: string,
  swipe: Swipe,
  priceAtSwipe?: number,
): Promise<void> {
  const all = await loadSwipes();
  all[id] = { swipe, priceAtSwipe, swipedAt: new Date().toISOString() };
  await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(all));
}

export async function bulkSaveSwipes(
  ids: string[],
  swipe: Swipe,
  priceById?: Map<string, number>,
): Promise<void> {
  if (ids.length === 0) return;
  const all = await loadSwipes();
  const now = new Date().toISOString();
  for (const id of ids) {
    all[id] = { swipe, swipedAt: now, priceAtSwipe: priceById?.get(id) };
  }
  await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(all));
}

export async function resetAllSwipes(): Promise<void> {
  await AsyncStorage.removeItem(SWIPES_KEY);
}

export async function replaceSwipes(swipes: Record<string, SwipeRecord>): Promise<void> {
  await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(swipes));
}

export async function replaceSeen(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(ids));
}

export async function replaceCatalog(catalog: Catalog): Promise<void> {
  await AsyncStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
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
      const point: PricePoint = { scrapedAt: ts, salePrice: product.salePrice, price: product.price };
      if (!existing) {
        catalog[product.id] = {
          product,
          firstSeenAt: ts,
          lastSeenAt: ts,
          priceHistory: [point],
        };
        continue;
      }
      const history =
        existing.priceHistory ??
        [
          {
            scrapedAt: existing.firstSeenAt,
            salePrice: existing.product.salePrice,
            price: existing.product.price,
          },
        ];
      const lastPoint = history[history.length - 1];
      if (
        Math.abs(lastPoint.salePrice - point.salePrice) > 0.01 ||
        Math.abs(lastPoint.price - point.price) > 0.01
      ) {
        history.push(point);
      }
      catalog[product.id] = {
        product,
        firstSeenAt: existing.firstSeenAt,
        lastSeenAt: ts,
        priceHistory: history,
      };
    }
  }
  await AsyncStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  return catalog;
}

export function lowestSalePrice(entry: CatalogEntry): number {
  const history = entry.priceHistory ?? [];
  if (history.length === 0) return entry.product.salePrice;
  let min = history[0].salePrice;
  for (const p of history) if (p.salePrice < min) min = p.salePrice;
  return min;
}
