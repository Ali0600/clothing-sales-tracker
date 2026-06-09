// Category vocabulary for garment-type filtering.
//
// Order matters — patterns are tested top-down and the first match wins.
// This is what handles tricky names like "Linen Shirt Jacket" landing under
// Jacket (not Shirt) and "Pullover Hoodie" landing under Hoodie (not Sweater).
//
// `label` is the user-facing chip text and is what gets stored on
// Product.category, so callers can compare strings directly without a lookup.

export interface CategoryDef {
  label: string;
  patterns: RegExp[];
}

export const CATEGORIES: CategoryDef[] = [
  { label: "T-Shirt", patterns: [/t-?shirt/i, /\btee\b/i] },
  { label: "Hoodie", patterns: [/hoodie/i, /sweat[\s-]?shirt/i] },
  { label: "Jacket", patterns: [/jacket/i, /parka/i, /blazer/i, /overshirt/i] },
  { label: "Coat", patterns: [/\bcoat\b/i] },
  { label: "Sweater", patterns: [/sweater/i, /jumper/i, /cardigan/i, /knit/i, /pullover/i] },
  { label: "Polo", patterns: [/polo/i] },
  { label: "Shirt", patterns: [/\bshirt\b/i] },
  { label: "Jeans", patterns: [/jeans/i] },
  { label: "Shorts", patterns: [/shorts/i] },
  { label: "Pants", patterns: [/pants/i, /trousers/i, /chinos/i, /joggers/i] },
  { label: "Vest", patterns: [/\bvest\b/i] },
];

export const OTHER_CATEGORY = "Other";

export function categorize(name: string): string {
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((p) => p.test(name))) return cat.label;
  }
  return OTHER_CATEGORY;
}

// Stable display order for chips: the table above, followed by Other.
export const CATEGORY_ORDER: string[] = [
  ...CATEGORIES.map((c) => c.label),
  OTHER_CATEGORY,
];
