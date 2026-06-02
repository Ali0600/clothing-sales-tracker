import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const TOKEN_KEY = "v1:github_pat";
const LAST_TRIGGER_KEY = "v1:github_last_trigger";

export interface GitHubConfig {
  owner: string;
  repo: string;
  workflowFile: string;
  branch: string;
}

export interface FreshnessConfig {
  staleAfterMinutes: number;
  minTriggerIntervalMinutes: number;
  pollIntervalSeconds: number;
  pollTimeoutSeconds: number;
}

const DEFAULT_FRESHNESS: FreshnessConfig = {
  staleAfterMinutes: 30,
  minTriggerIntervalMinutes: 5,
  pollIntervalSeconds: 10,
  pollTimeoutSeconds: 180,
};

export function getGitHubConfig(): GitHubConfig | null {
  const g = Constants.expoConfig?.extra?.github as Partial<GitHubConfig> | undefined;
  if (!g?.owner || !g?.repo || !g?.workflowFile || !g?.branch) return null;
  return { owner: g.owner, repo: g.repo, workflowFile: g.workflowFile, branch: g.branch };
}

export function getFreshnessConfig(): FreshnessConfig {
  const f = Constants.expoConfig?.extra?.freshness as Partial<FreshnessConfig> | undefined;
  return { ...DEFAULT_FRESHNESS, ...(f ?? {}) };
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token.trim());
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

async function getLastTriggerMs(): Promise<number> {
  const raw = await AsyncStorage.getItem(LAST_TRIGGER_KEY);
  return raw ? Number(raw) : 0;
}

async function setLastTriggerNow(): Promise<void> {
  await AsyncStorage.setItem(LAST_TRIGGER_KEY, String(Date.now()));
}

export type TriggerResult =
  | { ok: true }
  | { ok: false; reason: "no-token" | "no-config" | "rate-limited" | "http"; detail?: string };

export async function triggerScrape(): Promise<TriggerResult> {
  const config = getGitHubConfig();
  if (!config) return { ok: false, reason: "no-config" };
  const token = await getToken();
  if (!token) return { ok: false, reason: "no-token" };

  const { minTriggerIntervalMinutes } = getFreshnessConfig();
  const last = await getLastTriggerMs();
  if (Date.now() - last < minTriggerIntervalMinutes * 60_000) {
    return { ok: false, reason: "rate-limited" };
  }

  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: config.branch }),
    });
    if (res.status === 204) {
      await setLastTriggerNow();
      return { ok: true };
    }
    return { ok: false, reason: "http", detail: `${res.status}: ${await res.text()}` };
  } catch (e) {
    return { ok: false, reason: "http", detail: (e as Error).message };
  }
}

export function isStale(scrapedAt: string | null): boolean {
  if (!scrapedAt) return true;
  const { staleAfterMinutes } = getFreshnessConfig();
  const ageMs = Date.now() - new Date(scrapedAt).getTime();
  return ageMs > staleAfterMinutes * 60_000;
}
