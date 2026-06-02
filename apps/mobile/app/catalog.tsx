import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { fetchAllSnapshots } from "../src/api";
import {
  loadCatalog,
  loadSwipes,
  mergeIntoCatalog,
  type CatalogEntry,
  type Swipe,
} from "../src/storage";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_GAP = 8;
const PADDING = 12;
const CARD_W = (SCREEN_W - PADDING * 2 - CARD_GAP) / 2;

type Filter = "all" | "like" | "maybe" | "dislike" | "unswiped";

interface Row {
  entry: CatalogEntry;
  onSale: boolean;
  swipe?: Swipe;
}

export default function Catalog() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOffSale, setShowOffSale] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const [{ snapshots }, swipes] = await Promise.all([fetchAllSnapshots(), loadSwipes()]);
      const merged = await mergeIntoCatalog(snapshots);
      const catalog = Object.keys(merged).length > 0 ? merged : await loadCatalog();
      const onSaleIds = new Set(snapshots.flatMap((s) => s.products.map((p) => p.id)));
      const built: Row[] = Object.values(catalog)
        .map((entry) => ({ entry, onSale: onSaleIds.has(entry.product.id), swipe: swipes[entry.product.id] }))
        .sort((a, b) => {
          if (a.onSale !== b.onSale) return a.onSale ? -1 : 1;
          return b.entry.product.discountPct - a.entry.product.discountPct;
        });
      setRows(built);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showOffSale && !r.onSale) return false;
      if (filter === "unswiped" && r.swipe) return false;
      if (filter === "like" && r.swipe !== "like") return false;
      if (filter === "maybe" && r.swipe !== "maybe") return false;
      if (filter === "dislike" && r.swipe !== "dislike") return false;
      if (q && !r.entry.product.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, showOffSale, filter, query]);

  const stats = useMemo(() => {
    if (!rows) return { total: 0, onSale: 0, offSale: 0 };
    let onSale = 0;
    for (const r of rows) if (r.onSale) onSale++;
    return { total: rows.length, onSale, offSale: rows.length - onSale };
  }, [rows]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <Text style={styles.backIcon}>{Platform.OS === "ios" ? "‹" : "←"}</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Catalog</Text>
          <Text style={styles.subtitle}>
            {stats.onSale} on sale · {stats.offSale} no longer on sale
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TextInput
          style={styles.search}
          placeholder="Search by name"
          placeholderTextColor="#9ca3af"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <View style={styles.filterRow}>
          <FilterChip label="All" active={filter === "all"} onPress={() => setFilter("all")} />
          <FilterChip label="♥ Liked" active={filter === "like"} onPress={() => setFilter("like")} />
          <FilterChip label="? Maybe" active={filter === "maybe"} onPress={() => setFilter("maybe")} />
          <FilterChip label="Unswiped" active={filter === "unswiped"} onPress={() => setFilter("unswiped")} />
        </View>
        <View style={styles.toggleRow}>
          <Switch value={showOffSale} onValueChange={setShowOffSale} />
          <Text style={styles.toggleLabel}>
            Show items no longer on sale {stats.offSale > 0 && `(${stats.offSale})`}
          </Text>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {!rows ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {rows.length === 0
              ? "Catalog is empty. Open the home screen to load the current sale."
              : "No items match the current filters."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.entry.product.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: CARD_GAP }}
          ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
          renderItem={({ item }) => <CatalogCard row={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CatalogCard({ row }: { row: Row }) {
  const { product } = row.entry;
  const open = useCallback(() => {
    if (row.onSale) Linking.openURL(product.url);
  }, [product.url, row.onSale]);
  return (
    <TouchableOpacity
      activeOpacity={row.onSale ? 0.7 : 1}
      onPress={open}
      style={[styles.card, !row.onSale && styles.cardOffSale]}
    >
      <Image source={{ uri: product.imageUrl }} style={styles.cardImage} resizeMode="cover" />
      {!row.onSale && (
        <View style={styles.offSaleBadge}>
          <Text style={styles.offSaleBadgeText}>NO LONGER ON SALE</Text>
        </View>
      )}
      {row.swipe && (
        <View style={[styles.swipeBadge, swipeBadgeStyle(row.swipe)]}>
          <Text style={styles.swipeBadgeText}>{swipeBadgeLabel(row.swipe)}</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>
          {product.name}
        </Text>
        <View style={styles.cardPriceRow}>
          <Text style={styles.cardSalePrice}>€{product.salePrice.toFixed(2)}</Text>
          {product.salePrice < product.price && (
            <Text style={styles.cardBasePrice}>€{product.price.toFixed(2)}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function swipeBadgeLabel(swipe: Swipe): string {
  return swipe === "like" ? "♥" : swipe === "maybe" ? "?" : "✕";
}
function swipeBadgeStyle(swipe: Swipe) {
  return {
    backgroundColor: swipe === "like" ? "#22c55e" : swipe === "maybe" ? "#eab308" : "#9ca3af",
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 28, color: "#374151" },
  headerText: { flex: 1, paddingLeft: 4 },
  title: { fontSize: 22, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  controls: { paddingHorizontal: PADDING, gap: 10, paddingBottom: 10 },
  search: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
  },
  filterRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#111827", borderColor: "#111827" },
  chipLabel: { fontSize: 12, color: "#374151", fontWeight: "500" },
  chipLabelActive: { color: "#fff" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  toggleLabel: { fontSize: 13, color: "#374151" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyText: { color: "#6b7280", textAlign: "center" },
  error: { color: "#dc2626", paddingHorizontal: 20, paddingVertical: 8 },
  grid: { paddingHorizontal: PADDING, paddingBottom: 24 },
  card: {
    width: CARD_W,
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cardOffSale: { opacity: 0.55 },
  cardImage: { width: "100%", aspectRatio: 3 / 4, backgroundColor: "#f3f4f6" },
  offSaleBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(17,24,39,0.85)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  offSaleBadgeText: { color: "#fff", fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  swipeBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  cardBody: { padding: 8, gap: 4 },
  cardName: { fontSize: 12, color: "#111827", fontWeight: "500", minHeight: 32 },
  cardPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  cardSalePrice: { fontSize: 14, fontWeight: "700", color: "#dc2626" },
  cardBasePrice: { fontSize: 11, color: "#9ca3af", textDecorationLine: "line-through" },
});
