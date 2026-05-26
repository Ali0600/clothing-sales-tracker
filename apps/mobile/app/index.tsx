import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Product, Snapshot } from "@cst/shared";
import { fetchAllSnapshots } from "../src/api";
import {
  loadSeen,
  loadSwipes,
  markSeen,
  saveSwipe,
  type Swipe,
} from "../src/storage";
import { SwipeDeck } from "../src/components/SwipeDeck";

interface DeckState {
  products: Product[];
  newIds: Set<string>;
}

export default function Home() {
  const [state, setState] = useState<DeckState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [snapshots, swipes, seen] = await Promise.all([
          fetchAllSnapshots(),
          loadSwipes(),
          loadSeen(),
        ]);
        const built = buildDeck(snapshots, swipes, seen);
        setState(built);
        if (built.products.length > 0) {
          await markSeen(built.products.map((p) => p.id));
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const handleSwipe = useCallback((product: Product, swipe: Swipe) => {
    void saveSwipe(product.id, swipe);
  }, []);

  const newCount = useMemo(() => state?.newIds.size ?? 0, [state]);

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </SafeAreaView>
    );
  }
  if (!state) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.loading}>Loading sales…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Clothing Sales</Text>
        <Text style={styles.subtitle}>
          {newCount > 0 ? `${newCount} new` : "no new items"} · {state.products.length} to review
        </Text>
      </View>
      <SwipeDeck products={state.products} newIds={state.newIds} onSwipe={handleSwipe} />
    </SafeAreaView>
  );
}

function buildDeck(
  snapshots: Snapshot[],
  swipes: Record<string, Swipe>,
  seen: Set<string>,
): DeckState {
  const all: Product[] = snapshots.flatMap((s) => s.products);
  const unswiped = all.filter((p) => !(p.id in swipes));
  const newIds = new Set(unswiped.filter((p) => !seen.has(p.id)).map((p) => p.id));
  unswiped.sort((a, b) => {
    const an = newIds.has(a.id) ? 0 : 1;
    const bn = newIds.has(b.id) ? 0 : 1;
    if (an !== bn) return an - bn;
    return b.discountPct - a.discountPct;
  });
  return { products: unswiped, newIds };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f9fafb" },
  loading: { marginTop: 12, color: "#6b7280" },
  error: { color: "#dc2626", paddingHorizontal: 24, textAlign: "center" },
  header: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 14, color: "#6b7280", marginTop: 2 },
});
