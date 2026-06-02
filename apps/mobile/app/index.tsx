import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { Product, Snapshot } from "@cst/shared";
import { fetchAllSnapshots, type FetchResult } from "../src/api";
import {
  loadSeen,
  loadSwipes,
  markSeen,
  mergeIntoCatalog,
  saveSwipe,
  type Swipe,
} from "../src/storage";
import { SwipeDeck } from "../src/components/SwipeDeck";

interface DeckState {
  products: Product[];
  newIds: Set<string>;
  oldestScrapedAt: string | null;
  fetchErrors: FetchResult["errors"];
}

export default function Home() {
  const [state, setState] = useState<DeckState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [{ snapshots, errors }, swipes, seen] = await Promise.all([
            fetchAllSnapshots(),
            loadSwipes(),
            loadSeen(),
          ]);
          if (cancelled) return;
          const built = buildDeck(snapshots, swipes, seen, errors);
          setState(built);
          setError(null);
          if (snapshots.length > 0) {
            await mergeIntoCatalog(snapshots);
          }
          if (built.products.length > 0) {
            await markSeen(built.products.map((p) => p.id));
          }
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        } finally {
          if (!cancelled) setRefreshing(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [nonce]),
  );

  const handleSwipe = useCallback((product: Product, swipe: Swipe) => {
    void saveSwipe(product.id, swipe);
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setNonce((n) => n + 1);
  }, []);

  const newCount = useMemo(() => state?.newIds.size ?? 0, [state]);
  const freshnessLabel = useMemo(() => formatAge(state?.oldestScrapedAt ?? null), [state]);

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRefresh}>
          <Text style={styles.retryLabel}>Retry</Text>
        </TouchableOpacity>
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
        <View style={styles.headerText}>
          <Text style={styles.title}>Clothing Sales</Text>
          <Text style={styles.subtitle}>
            {newCount > 0 ? `${newCount} new` : "no new items"} · {state.products.length} to review
            {freshnessLabel ? ` · updated ${freshnessLabel}` : ""}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.iconButton}
          accessibilityLabel="Refresh"
          disabled={refreshing}
        >
          {refreshing ? <ActivityIndicator /> : <Text style={styles.iconText}>⟳</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/catalog")}
          style={styles.iconButton}
          accessibilityLabel="Catalog"
        >
          <Text style={styles.iconText}>☷</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/options")}
          style={styles.iconButton}
          accessibilityLabel="Options"
        >
          <Text style={styles.iconText}>⚙︎</Text>
        </TouchableOpacity>
      </View>

      {state.fetchErrors.length > 0 && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>
            Couldn't load {state.fetchErrors.map((e) => e.source).join(", ")}. {state.fetchErrors[0]?.message}
          </Text>
        </View>
      )}

      <SwipeDeck products={state.products} newIds={state.newIds} onSwipe={handleSwipe} />
    </SafeAreaView>
  );
}

function buildDeck(
  snapshots: Snapshot[],
  swipes: Record<string, Swipe>,
  seen: Set<string>,
  fetchErrors: FetchResult["errors"],
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
  const oldestScrapedAt = snapshots
    .map((s) => s.scrapedAt)
    .sort()
    .at(0) ?? null;
  return { products: unswiped, newIds, oldestScrapedAt, fetchErrors };
}

function formatAge(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f9fafb" },
  loading: { marginTop: 12, color: "#6b7280" },
  error: { color: "#dc2626", paddingHorizontal: 24, textAlign: "center" },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dc2626",
  },
  retryLabel: { color: "#dc2626", fontWeight: "600" },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: { fontSize: 20, color: "#374151" },
  errorBanner: {
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    marginBottom: 8,
  },
  errorBannerText: { color: "#991b1b", fontSize: 12 },
});
