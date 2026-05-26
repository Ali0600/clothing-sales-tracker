import type { Product, Snapshot } from "./product.js";

export interface SnapshotDiff {
  added: Product[];
  removed: Product[];
  repriced: Array<{ before: Product; after: Product }>;
}

export function diffSnapshots(previous: Snapshot | null, current: Snapshot): SnapshotDiff {
  if (!previous) return { added: current.products, removed: [], repriced: [] };

  const prevById = new Map(previous.products.map((p) => [p.id, p]));
  const currById = new Map(current.products.map((p) => [p.id, p]));

  const added = current.products.filter((p) => !prevById.has(p.id));
  const removed = previous.products.filter((p) => !currById.has(p.id));
  const repriced: SnapshotDiff["repriced"] = [];

  for (const after of current.products) {
    const before = prevById.get(after.id);
    if (before && before.salePrice !== after.salePrice) {
      repriced.push({ before, after });
    }
  }

  return { added, removed, repriced };
}
