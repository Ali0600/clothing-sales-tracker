import { chromium, type Browser } from "playwright";
import type { Product, Snapshot } from "@cst/shared";
import { ScrapeError } from "./error.js";

const URL = "https://www.uniqlo.com/de/en/feature/sale/men";
const SOURCE = "uniqlo-de-men" as const;
const TILE_SELECTOR = 'a[href*="/products/E"]';
const COUNT_SELECTOR = ".fr-ec-header-overlay__item-count";

export async function scrapeUniqloDeMen(): Promise<Snapshot> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await runScrape(browser);
  } finally {
    await browser.close();
  }
}

async function runScrape(browser: Browser): Promise<Snapshot> {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-DE",
  });
  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } catch (e) {
    throw new ScrapeError({
      source: SOURCE,
      url: URL,
      stage: "navigate",
      message: (e as Error).message,
    });
  }

  try {
    await page.waitForSelector(TILE_SELECTOR, { timeout: 30_000 });
  } catch (e) {
    const html = await page.content();
    throw new ScrapeError({
      source: SOURCE,
      url: URL,
      stage: "wait-for-tiles",
      message: `No tiles matched ${TILE_SELECTOR}: ${(e as Error).message}`,
      htmlSnippet: html.slice(0, 4000),
    });
  }

  const expectedTotal = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const m = (el.textContent || "").match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }, COUNT_SELECTOR);

  await scrollUntilStable(page, expectedTotal);

  const tileCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, TILE_SELECTOR);
  if (expectedTotal != null && tileCount < expectedTotal * 0.9) {
    const html = await page.content();
    throw new ScrapeError({
      source: SOURCE,
      url: URL,
      stage: "scroll-paginate",
      message: `Pagination stalled: rendered ${tileCount} / expected ~${expectedTotal}`,
      expectedCount: expectedTotal,
      actualCount: tileCount,
      htmlSnippet: html.slice(0, 4000),
    });
  }

  const products = await extractProducts(page);
  if (products.length === 0) {
    const html = await page.content();
    throw new ScrapeError({
      source: SOURCE,
      url: URL,
      stage: "extract",
      message: "Extracted 0 products from DOM despite tiles present",
      actualCount: tileCount,
      htmlSnippet: html.slice(0, 4000),
    });
  }

  return {
    source: SOURCE,
    scrapedAt: new Date().toISOString(),
    products,
  };
}

async function scrollUntilStable(page: import("playwright").Page, expectedTotal: number | null): Promise<void> {
  const maxIterations = 60;
  let lastCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < maxIterations; i++) {
    const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, TILE_SELECTOR);
    if (expectedTotal != null && count >= expectedTotal) return;
    if (count === lastCount) {
      stableRounds++;
      if (stableRounds >= 4) return;
    } else {
      stableRounds = 0;
      lastCount = count;
    }
    await page.evaluate((sel) => {
      const tiles = document.querySelectorAll(sel);
      const last = tiles[tiles.length - 1];
      last?.scrollIntoView({ block: "end", behavior: "instant" as ScrollBehavior });
    }, TILE_SELECTOR);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1200);
  }
}

async function extractProducts(page: import("playwright").Page): Promise<Product[]> {
  const raw = await page.evaluate((sel) => {
    const tiles = Array.from(document.querySelectorAll(sel)) as HTMLAnchorElement[];
    return tiles.map((tile) => {
      const href = tile.href;
      const idMatch = href.match(/\/products\/(E[\w-]+)/);
      const img = tile.querySelector("img") as HTMLImageElement | null;
      const text = tile.innerText.trim();
      const priceMatches = Array.from(tile.innerText.matchAll(/(\d+(?:[.,]\d{1,2}))\s*€|€\s*(\d+(?:[.,]\d{1,2}))/g))
        .map((m) => Number((m[1] ?? m[2]).replace(",", ".")))
        .filter((n) => n > 0 && n < 100000);
      const nameEl = tile.querySelector('[data-testid="product-tile-title"], h3, h2, [class*="title" i], [class*="name" i]');
      const name = (nameEl?.textContent || tile.getAttribute("aria-label") || text.split("\n")[0] || "").trim();
      return {
        id: idMatch?.[1] || href,
        href,
        name,
        image: img?.src || img?.getAttribute("data-src") || "",
        prices: priceMatches,
      };
    });
  }, TILE_SELECTOR);

  const seen = new Set<string>();
  const products: Product[] = [];
  for (const r of raw) {
    if (!r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    const prices = r.prices.slice().sort((a, b) => b - a);
    const base = prices[0] ?? 0;
    const sale = prices[1] ?? base;
    if (base === 0) continue;
    products.push({
      id: r.id,
      source: SOURCE,
      name: r.name,
      url: r.href,
      imageUrl: r.image,
      price: base,
      salePrice: sale,
      currency: "EUR",
      discountPct: base > 0 ? Math.round(((base - sale) / base) * 100) : 0,
      gender: "men",
    });
  }
  return products;
}
