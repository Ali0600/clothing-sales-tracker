import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { fetchAllSnapshots } from "../src/api";
import {
  bulkSaveSwipes,
  loadSwipes,
  resetAllSwipes,
} from "../src/storage";

interface Counts {
  total: number;
  swiped: number;
  remaining: number;
}

export default function Options() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [unswipedIds, setUnswipedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "reject" | "reset">(null);
  const [confirm, setConfirm] = useState<null | "reject" | "reset">(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ snapshots }, swipes] = await Promise.all([fetchAllSnapshots(), loadSwipes()]);
      const ids = snapshots.flatMap((s) => s.products.map((p) => p.id));
      const unique = Array.from(new Set(ids));
      const swipedCount = unique.filter((id) => id in swipes).length;
      const unswiped = unique.filter((id) => !(id in swipes));
      setCounts({ total: unique.length, swiped: swipedCount, remaining: unswiped.length });
      setUnswipedIds(unswiped);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleReject = useCallback(async () => {
    if (confirm !== "reject") {
      setConfirm("reject");
      return;
    }
    setBusy("reject");
    try {
      await bulkSaveSwipes(unswipedIds, "dislike");
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      setConfirm(null);
    }
  }, [confirm, unswipedIds, router]);

  const handleReset = useCallback(async () => {
    if (confirm !== "reset") {
      setConfirm("reset");
      return;
    }
    setBusy("reset");
    try {
      await resetAllSwipes();
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      setConfirm(null);
    }
  }, [confirm, router]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <Text style={styles.backIcon}>{Platform.OS === "ios" ? "‹" : "←"}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Options</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.body}>
        {error && <Text style={styles.error}>{error}</Text>}

        {!counts ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <>
            <View style={styles.statsCard}>
              <Stat label="Total in catalog" value={counts.total} />
              <Stat label="Swiped" value={counts.swiped} />
              <Stat label="Remaining" value={counts.remaining} />
            </View>

            <Action
              tone="danger"
              label={confirm === "reject" ? "Tap again to confirm" : "Reject all remaining"}
              hint={
                confirm === "reject"
                  ? `Marks ${counts.remaining} items as disliked.`
                  : "Mark every un-swiped item as disliked. Useful when nothing in this batch interests you."
              }
              disabled={counts.remaining === 0 || busy !== null}
              busy={busy === "reject"}
              onPress={handleReject}
            />

            <Action
              tone="neutral"
              label={confirm === "reset" ? "Tap again to confirm" : "Reset all swipes"}
              hint={
                confirm === "reset"
                  ? `Clears all ${counts.swiped} of your past swipes.`
                  : "Forget every swipe you've made. The whole catalog will come back to review."
              }
              disabled={counts.swiped === 0 || busy !== null}
              busy={busy === "reset"}
              onPress={handleReset}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Action({
  label,
  hint,
  tone,
  disabled,
  busy,
  onPress,
}: {
  label: string;
  hint: string;
  tone: "danger" | "neutral";
  disabled: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const isDanger = tone === "danger";
  return (
    <View style={styles.actionWrap}>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        style={[
          styles.action,
          isDanger ? styles.actionDanger : styles.actionNeutral,
          disabled && styles.actionDisabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={isDanger ? "#fff" : "#111827"} />
        ) : (
          <Text style={[styles.actionLabel, isDanger ? styles.actionLabelDanger : styles.actionLabelNeutral]}>
            {label}
          </Text>
        )}
      </TouchableOpacity>
      <Text style={styles.actionHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f9fafb" },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  backIcon: { fontSize: 28, color: "#374151" },
  title: { fontSize: 18, fontWeight: "600", color: "#111827" },
  body: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  center: { paddingVertical: 40, alignItems: "center" },
  error: { color: "#dc2626", textAlign: "center" },
  statsCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    justifyContent: "space-around",
  },
  stat: { alignItems: "center" },
  statValue: { fontSize: 28, fontWeight: "700", color: "#111827" },
  statLabel: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  actionWrap: { gap: 8 },
  action: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionDanger: { backgroundColor: "#dc2626" },
  actionNeutral: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  actionDisabled: { opacity: 0.4 },
  actionLabel: { fontSize: 16, fontWeight: "600" },
  actionLabelDanger: { color: "#fff" },
  actionLabelNeutral: { color: "#111827" },
  actionHint: { fontSize: 13, color: "#6b7280", paddingHorizontal: 4 },
});
