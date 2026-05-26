import type { Source } from "@cst/shared";

export interface ScrapeErrorContext {
  source: Source;
  url: string;
  stage: "navigate" | "wait-for-tiles" | "scroll-paginate" | "extract" | "parse";
  message: string;
  expectedCount?: number;
  actualCount?: number;
  htmlSnippet?: string;
}

export class ScrapeError extends Error {
  context: ScrapeErrorContext;
  constructor(context: ScrapeErrorContext) {
    super(`[${context.source}] ${context.stage}: ${context.message}`);
    this.name = "ScrapeError";
    this.context = context;
  }
}
