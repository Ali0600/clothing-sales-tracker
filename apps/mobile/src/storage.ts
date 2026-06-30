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

export async function unsaveSwipe(id: string): Promise<void> {
  const all = await loadSwipes();
  if (!(id in all)) return;
  delete all[id];
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

// Reduce any product id to its stable base design code:
//   E465185-000-11  -> E465185-000   (strip the rotating colorway suffix)
//   E465185-000     -> E465185-000   (already base — no-op)
// Uniqlo rotates which colorway is the representative grid tile, so a
// color-suffixed id drifts between scrapes; the base code does not.
export function baseProductId(id: string): string {
  return id.match(/^(E\d+-\d+)/)?.[1] ?? id;
}

// Collapse color-suffixed swipe + seen keys onto their base design code. When
// several colorways of one design were swiped, the most recent swipe wins
// (its priceAtSwipe becomes the design's reference). Idempotent. Returns the
// collapsed maps plus whether anything changed (to gate a gist push).
export async function collapseToBaseSwipes(
  swipes: Record<string, SwipeRecord>,
  seen: Set<string>,
): Promise<{ swipes: Record<string, SwipeRecord>; seen: Set<string>; changed: boolean }> {
  let changed = false;

  const outSwipes: Record<string, SwipeRecord> = {};
  for (const [id, record] of Object.entries(swipes)) {
    const base = baseProductId(id);
    if (base !== id) changed = true;
    const existing = outSwipes[base];
    if (!existing) {
      outSwipes[base] = record;
    } else {
      const a = existing.swipedAt ?? "";
      const b = record.swipedAt ?? "";
      if (b > a) outSwipes[base] = record; // keep the most recent swipe
    }
  }

  const outSeenArr = [...new Set([...seen].map(baseProductId))];
  if (outSeenArr.length !== seen.size) changed = true;

  if (changed) {
    await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(outSwipes));
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(outSeenArr));
  }
  return { swipes: outSwipes, seen: new Set(outSeenArr), changed };
}

// Collapse color-suffixed catalog entries onto their base design code: earliest
// firstSeenAt, latest lastSeenAt, merged priceHistory (deduped by scrapedAt).
export async function collapseToBaseCatalog(catalog: Catalog): Promise<boolean> {
  let changed = false;
  const out: Catalog = {};

  for (const [id, entry] of Object.entries(catalog)) {
    const base = baseProductId(id);
    if (base !== id) changed = true;
    const merged = out[base];
    if (!merged) {
      out[base] = { ...entry, product: { ...entry.product, id: base } };
      continue;
    }
    const dedup = new Map<string, PricePoint>();
    for (const p of [...(merged.priceHistory ?? []), ...(entry.priceHistory ?? [])]) {
      dedup.set(p.scrapedAt, p);
    }
    out[base] = {
      product: entry.lastSeenAt > merged.lastSeenAt
        ? { ...entry.product, id: base }
        : merged.product,
      firstSeenAt: merged.firstSeenAt < entry.firstSeenAt ? merged.firstSeenAt : entry.firstSeenAt,
      lastSeenAt: merged.lastSeenAt > entry.lastSeenAt ? merged.lastSeenAt : entry.lastSeenAt,
      priceHistory: [...dedup.values()].sort((a, b) => a.scrapedAt.localeCompare(b.scrapedAt)),
    };
  }

  if (changed) await AsyncStorage.setItem(CATALOG_KEY, JSON.stringify(out));
  return changed;
}
