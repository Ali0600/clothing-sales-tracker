import AsyncStorage from "@react-native-async-storage/async-storage";

export type Swipe = "like" | "dislike" | "maybe";

const SWIPES_KEY = "v1:swipes";
const SEEN_KEY = "v1:seen";

export async function loadSwipes(): Promise<Record<string, Swipe>> {
  const raw = await AsyncStorage.getItem(SWIPES_KEY);
  return raw ? (JSON.parse(raw) as Record<string, Swipe>) : {};
}

export async function saveSwipe(id: string, swipe: Swipe): Promise<void> {
  const all = await loadSwipes();
  all[id] = swipe;
  await AsyncStorage.setItem(SWIPES_KEY, JSON.stringify(all));
}

export async function loadSeen(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SEEN_KEY);
  if (!raw) return new Set();
  return new Set(JSON.parse(raw) as string[]);
}

export async function markSeen(ids: string[]): Promise<void> {
  const seen = await loadSeen();
  for (const id of ids) seen.add(id);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}
