import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { Product, Snapshot } from "@cst/shared";
import { fetchAllSnapshots, type FetchResult } from "../src/api";
import {
  loadCatalog,
  loadSeen,
  loadSwipes,
  markSeen,
  mergeIntoCatalog,
  migrateLegacyCatalog,
  migrateLegacySwipes,
  saveSwipe,
  type Swipe,
  type SwipeRecord,
} from "../src/storage";
import { SwipeDeck } from "../src/components/SwipeDeck";
import { getFreshnessConfig, getToken, isStale, triggerScrape } from "../src/github";
import { pullAndMerge, schedulePush } from "../src/sync";

type RefreshPhase = "idle" | "triggering" | "polling" | "fresh" | "error";

interface DeckState {
  products: Product[];
  newIds: Set<string>;
  repricedIds: Map<string, number>;
  oldestScrapedAt: string | null;
  fetchErrors: FetchResult["errors"];
}

export default function Home() {
  const [state, setState] = useState<DeckState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [phase, setPhase] = useState<RefreshPhase>("idle");
  const [phaseDetail, setPhaseDetail] = useState<string | null>(null);
  const router = useRouter();
  const lastScrapedAtRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const reload = useCallback(async (): Promise<DeckState | null> => {
    const [{ snapshots, errors }, rawSwipes, seen, rawCatalog] = await Promise.all([
      fetchAllSnapshots(),
      loadSwipes(),
      loadSeen(),
      loadCatalog(),
    ]);

    // Fan legacy design-level IDs out to colorways now that we know what
    // colorways exist in the current snapshot. Idempotent: if every old ID
    // has already been migrated (or has no colorways in the snapshot), no
    // writes happen. If migration changed anything, push to the gist so
    // other devices pick up the new IDs.
    const knownIds = new Set(snapshots.flatMap((s) => s.products.map((p) => p.id)));
    const beforeSwipeCount = Object.keys(rawSwipes).length;
    const beforeCatalogCount = Object.keys(rawCatalog).length;
    const swipes = await migrateLegacySwipes(rawSwipes, knownIds);
    await migrateLegacyCatalog(rawCatalog, snapshots);
    if (
      Object.keys(swipes).length !== beforeSwipeCount ||
      Object.keys(await loadCatalog()).length !== beforeCatalogCount
    ) {
      schedulePush();
    }

    const built = buildDeck(snapshots, swipes, seen, errors);
    setState(built);
    setError(null);
    if (snapshots.length > 0) await mergeIntoCatalog(snapshots);
    if (built.products.length > 0) await markSeen(built.products.map((p) => p.id));
    return built;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      stopPolling();

      (async () => {
        try {
          // Pull remote state in the background. If the merge produced changes,
          // just rebuild the deck with the merged data — DO NOT bump nonce and
          // re-run the trigger/poll path, that's what caused the banner flash.
          void pullAndMerge().then(async (r) => {
            if (cancelled) return;
            if (r.ok && r.merged) {
              try {
                await reload();
              } catch {
                // local state still shown; non-fatal
              }
            }
          });

          const built = await reload();
          if (cancelled || !built) return;
          lastScrapedAtRef.current = built.oldestScrapedAt;
          if (built.products.length > 0) schedulePush();

          if (!isStale(built.oldestScrapedAt)) {
            setPhase("fresh");
            return;
          }
          const token = await getToken();
          if (!token) {
            setPhase("idle");
            return;
          }

          setPhase("triggering");
          setPhaseDetail("Checking Uniqlo…");
          const result = await triggerScrape();
          if (cancelled) return;

          if (!result.ok) {
            if (result.reason === "rate-limited") {
              setPhase("idle");
            } else {
              setPhase("error");
              setPhaseDetail(
                result.reason === "no-config"
                  ? "GitHub repo not configured in app.json"
                  : result.reason === "no-token"
                    ? "Add a GitHub token in Options"
                    : result.detail ?? "Failed to trigger scrape",
              );
            }
            return;
          }

          setPhase("polling");
          setPhaseDetail("Scraping Uniqlo…");

          const { pollIntervalSeconds, pollTimeoutSeconds } = getFreshnessConfig();
          const startedAt = Date.now();
          const baseline = built.oldestScrapedAt;

          const tick = async () => {
            if (cancelled) return;
            try {
              const next = await reload();
              if (cancelled) return;
              if (next && next.oldestScrapedAt && next.oldestScrapedAt !== baseline) {
                lastScrapedAtRef.current = next.oldestScrapedAt;
                setPhase("fresh");
                setPhaseDetail(null);
                return;
              }
            } catch {
              // swallow during polling
            }
            if (Date.now() - startedAt > pollTimeoutSeconds * 1000) {
              setPhase("idle");
              setPhaseDetail("Scrape still running — pull ⟳ later to fetch result.");
              return;
            }
            pollTimerRef.current = setTimeout(tick, pollIntervalSeconds * 1000);
          };
          pollTimerRef.current = setTimeout(tick, pollIntervalSeconds * 1000);
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        } finally {
          if (!cancelled) setRefreshing(false);
        }
      })();
      return () => {
        cancelled = true;
        stopPolling();
      };
    }, [nonce, reload, stopPolling]),
  );

  useEffect(() => stopPolling, [stopPolling]);

  const handleSwipe = useCallback((product: Product, swipe: Swipe) => {
    void saveSwipe(product.id, swipe, product.salePrice);
    schedulePush();
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

      {(phase === "triggering" || phase === "polling") && phaseDetail && (
        <View style={styles.phaseBanner}>
          <ActivityIndicator size="small" color="#1e40af" />
          <Text style={styles.phaseBannerText} numberOfLines={2}>
            {phaseDetail}
          </Text>
        </View>
      )}
      {phase === "error" && phaseDetail && (
        <View style={styles.warnBanner}>
          <Text style={styles.warnBannerText} numberOfLines={2}>
            {phaseDetail}
          </Text>
        </View>
      )}

      {state.fetchErrors.length > 0 && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} numberOfLines={2}>
            Couldn't load {state.fetchErrors.map((e) => e.source).join(", ")}. {state.fetchErrors[0]?.message}
          </Text>
        </View>
      )}

      <SwipeDeck
        products={state.products}
        newIds={state.newIds}
        repricedIds={state.repricedIds}
        onSwipe={handleSwipe}
      />
    </SafeAreaView>
  );
}

function buildDeck(
  snapshots: Snapshot[],
  swipes: Record<string, SwipeRecord>,
  seen: Set<string>,
  fetchErrors: FetchResult["errors"],
): DeckState {
  const all: Product[] = snapshots.flatMap((s) => s.products);
  const candidates: Product[] = [];
  const repricedIds = new Map<string, number>();

  for (const p of all) {
    const swipe = swipes[p.id];
    if (!swipe) {
      candidates.push(p);
      continue;
    }
    if (
      swipe.priceAtSwipe != null &&
      Math.abs(swipe.priceAtSwipe - p.salePrice) > 0.01
    ) {
      candidates.push(p);
      repricedIds.set(p.id, swipe.priceAtSwipe);
    }
  }

  const newIds = new Set(
    candidates
      .filter((p) => !seen.has(p.id) && !repricedIds.has(p.id))
      .map((p) => p.id),
  );

  candidates.sort((a, b) => {
    const ra = repricedIds.has(a.id) ? 0 : newIds.has(a.id) ? 1 : 2;
    const rb = repricedIds.has(b.id) ? 0 : newIds.has(b.id) ? 1 : 2;
    if (ra !== rb) return ra - rb;
    return b.discountPct - a.discountPct;
  });

  const oldestScrapedAt = snapshots
    .map((s) => s.scrapedAt)
    .sort()
    .at(0) ?? null;
  return { products: candidates, newIds, repricedIds, oldestScrapedAt, fetchErrors };
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
  phaseBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    marginBottom: 8,
    flexShrink: 0,
    zIndex: 10,
  },
  phaseBannerText: { color: "#1e40af", fontSize: 13, flex: 1 },
  warnBanner: {
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
    marginBottom: 8,
    flexShrink: 0,
    zIndex: 10,
  },
  warnBannerText: { color: "#92400e", fontSize: 12 },
  errorBanner: {
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    marginBottom: 8,
    flexShrink: 0,
    zIndex: 10,
  },
  errorBannerText: { color: "#991b1b", fontSize: 12 },
});
