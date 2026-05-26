import Constants from "expo-constants";
import type { Source } from "@cst/shared";

const base = (Constants.expoConfig?.extra?.snapshotBaseUrl as string | undefined) ??
  "https://raw.githubusercontent.com/REPLACE_ME/clothing-sales-tracker/main/data";

export const ACTIVE_SOURCES: Source[] = ["uniqlo-de-men"];

export function snapshotUrl(source: Source): string {
  return `${base}/${source}.json`;
}
