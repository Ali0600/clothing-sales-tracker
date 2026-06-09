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
