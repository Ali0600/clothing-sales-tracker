import type { Snapshot, Source } from "@cst/shared";
import { scrapeUniqloDeMen } from "./uniqlo.js";

export type Scraper = () => Promise<Snapshot>;

export const scrapers: Record<Source, Scraper | undefined> = {
  "uniqlo-de-men": scrapeUniqloDeMen,
  "uniqlo-de-women": undefined,
  "zara-de": undefined,
  "hm-de": undefined,
};

export { ScrapeError } from "./error.js";
export { scrapeUniqloDeMen } from "./uniqlo.js";
