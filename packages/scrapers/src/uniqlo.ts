import { chromium, type Browser } from "playwright";
import { categorize, type Product, type Snapshot } from "@cst/shared";
import { ScrapeError } from "./error";

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
  if (expectedTotal != null && tileCount < expectedTotal * 0.95) {
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

  // This is a SALE page — the overwhelming majority of items must carry a real
  // discount. A high no-discount ratio means price parsing broke (e.g. Uniqlo
  // added the "30-Day Lowest Price" line that displaced the sale price), so fail
  // loudly and let self-heal fix the parser rather than commit garbage.
  const noDiscount = products.filter((p) => p.salePrice >= p.price).length;
  if (noDiscount / products.length > 0.3) {
    const html = await page.content();
    throw new ScrapeError({
      source: SOURCE,
      url: URL,
      stage: "parse",
      message:
        `Discount sanity check failed: ${noDiscount}/${products.length} items have no ` +
        `discount on a sale page — price parsing is likely broken.`,
      actualCount: products.length,
      htmlSnippet: html.slice(0, 4000),
    });
  }

  if (expectedTotal != null) {
    console.log(
      `[uniqlo-de-men] pagination: ${tileCount}/${expectedTotal} tiles ` +
        `(${Math.round((tileCount / expectedTotal) * 100)}%), ${products.length} after dedupe`,
    );
  }

  return {
    source: SOURCE,
    scrapedAt: new Date().toISOString(),
    products,
  };
}

async function scrollUntilStable(page: import("playwright").Page, expectedTotal: number | null): Promise<void> {
  const maxIterations = 100;
  let lastCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < maxIterations; i++) {
    const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, TILE_SELECTOR);
    if (expectedTotal != null && count >= expectedTotal) return;
    if (count === lastCount) {
      stableRounds++;
      // After a long no-progress stretch, try a stronger nudge: jump to top
      // then back to the last tile to re-arm Uniqlo's intersection observer.
      if (stableRounds === 4) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
      }
      if (stableRounds >= 6) return;
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
    await page.waitForTimeout(1500);
  }
}

async function extractProducts(page: import("playwright").Page): Promise<Product[]> {
  const raw = await page.evaluate((sel) => {
    const tiles = Array.from(document.querySelectorAll(sel)) as HTMLAnchorElement[];
    return tiles.map((tile) => {
      const href = tile.href;
      const baseMatch = href.match(/\/products\/(E[\w-]+)/);
      const colorMatch = href.match(/colorDisplayCode=([\w-]+)/);
      const img = tile.querySelector("img") as HTMLImageElement | null;
      const text = tile.innerText.trim();
      // Drop the EU "30-Day Lowest Price: X €" line (Omnibus Directive). It adds
      // a third price number — usually equal to the original — which corrupts the
      // "two highest = original + sale" heuristic and zeroes out the discount.
      const priceText = tile.innerText
        .split("\n")
        .filter((l) => !/lowest price/i.test(l))
        .join("\n");
      const priceMatches = Array.from(priceText.matchAll(/(\d+(?:[.,]\d{1,2}))\s*€|€\s*(\d+(?:[.,]\d{1,2}))/g))
        .map((m) => Number((m[1] ?? m[2]).replace(",", ".")))
        .filter((n) => n > 0 && n < 100000);
      const nameEl = tile.querySelector('[data-testid="product-tile-title"], h3, h2, [class*="title" i], [class*="name" i]');
      const name = (nameEl?.textContent || tile.getAttribute("aria-label") || text.split("\n")[0] || "").trim();
      return {
        baseId: baseMatch?.[1] || "",
        colorCode: colorMatch?.[1] || "default",
        href,
        name,
        image: img?.src || img?.getAttribute("data-src") || "",
        prices: priceMatches,
      };
    });
  }, TILE_SELECTOR);

  // Identity is the base design code (e.g. E465185-000), NOT base-colorCode.
  // Uniqlo rotates which colorway is the representative grid tile, so a
  // color-suffixed id drifts between scrapes and breaks swipe persistence.
  // When several colorways of one design appear in a single scrape, keep the
  // cheapest (best deal on offer) so the card shows the lowest visible price.
  const byId = new Map<string, Product>();
  for (const r of raw) {
    if (!r.baseId) continue;
    const id = r.baseId;
    const prices = r.prices.slice().sort((a, b) => b - a);
    const base = prices[0] ?? 0;
    const sale = prices[1] ?? base;
    if (base === 0) continue;
    const candidate: Product = {
      id,
      source: SOURCE,
      name: r.name,
      url: r.href,
      imageUrl: r.image,
      price: base,
      salePrice: sale,
      currency: "EUR",
      discountPct: base > 0 ? Math.round(((base - sale) / base) * 100) : 0,
      gender: "men",
      category: categorize(r.name),
    };
    const existing = byId.get(id);
    if (!existing || candidate.salePrice < existing.salePrice) byId.set(id, candidate);
  }
  return [...byId.values()];
}
