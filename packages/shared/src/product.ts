export type Source = "uniqlo-de-men" | "uniqlo-de-women" | "zara-de" | "hm-de";

export interface Product {
  id: string;
  source: Source;
  name: string;
  url: string;
  imageUrl: string;
  price: number;
  salePrice: number;
  currency: string;
  discountPct: number;
  gender?: "men" | "women" | "kids" | "unisex";
  colors?: string[];
  sizes?: string[];
  category?: string;
}

export interface Snapshot {
  source: Source;
  scrapedAt: string;
  products: Product[];
}

// A sale-price drop must be at least this fraction below the reference price to
// count as "significant" — used both for push notifications (scripts/scrape.ts)
// and for re-surfacing an already-swiped item in the deck (apps/mobile).
export const SIGNIFICANT_DROP_PCT = 0.05;
