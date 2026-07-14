import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { schedulePush } from "../src/sync";
import { clearToken, getToken, setToken } from "../src/github";
import { disconnectSync, getGistId, getLastSync, pullAndMerge, pushNow } from "../src/sync";

interface Counts {
  total: number;
  swiped: number;
  remaining: number;
}

export default function Options() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [unswipedIds, setUnswipedIds] = useState<string[]>([]);
  const [priceById, setPriceById] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState<null | "reject" | "reset">(null);
  const [confirm, setConfirm] = useState<null | "reject" | "reset">(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenStatus, setTokenStatus] = useState<"loading" | "configured" | "missing">("loading");
  const [syncState, setSyncState] = useState<{
    lastSync: string | null;
    gistId: string | null;
    busy: null | "push" | "pull";
    error: string | null;
  }>({ lastSync: null, gistId: null, busy: null, error: null });

  const refreshSyncState = useCallback(async () => {
    const [lastSync, gistId] = await Promise.all([getLastSync(), getGistId()]);
    setSyncState((s) => ({ ...s, lastSync, gistId }));
  }, []);

  useEffect(() => {
    void getToken().then((t) => setTokenStatus(t ? "configured" : "missing"));
    void refreshSyncState();
  }, [refreshSyncState]);

  const handleSyncPush = useCallback(async () => {
    setSyncState((s) => ({ ...s, busy: "push", error: null }));
    const r = await pushNow();
    if (!r.ok) {
      setSyncState((s) => ({
        ...s,
        busy: null,
        error: r.reason === "no-token" ? "Add a GitHub token first" : r.detail ?? "Push failed",
      }));
      return;
    }
    await refreshSyncState();
    setSyncState((s) => ({ ...s, busy: null }));
  }, [refreshSyncState]);

  const handleSyncPull = useCallback(async () => {
    setSyncState((s) => ({ ...s, busy: "pull", error: null }));
    const r = await pullAndMerge();
    if (!r.ok) {
      setSyncState((s) => ({
        ...s,
        busy: null,
        error: r.reason === "no-token" ? "Add a GitHub token first" : r.detail ?? "Pull failed",
      }));
      return;
    }
    await refreshSyncState();
    setSyncState((s) => ({ ...s, busy: null }));
  }, [refreshSyncState]);

  const handleSyncDisconnect = useCallback(async () => {
    await disconnectSync();
    await refreshSyncState();
  }, [refreshSyncState]);

  const handleSaveToken = useCallback(async () => {
    if (!tokenInput.trim()) return;
    await setToken(tokenInput);
    setTokenInput("");
    setTokenStatus("configured");
  }, [tokenInput]);

  const handleClearToken = useCallback(async () => {
    await clearToken();
    setTokenStatus("missing");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [{ snapshots }, swipes] = await Promise.all([fetchAllSnapshots(), loadSwipes()]);
      const products = snapshots.flatMap((s) => s.products);
      const prices = new Map<string, number>();
      for (const p of products) prices.set(p.id, p.salePrice);
      const unique = Array.from(prices.keys());
      const swipedCount = unique.filter((id) => id in swipes).length;
      const unswiped = unique.filter((id) => !(id in swipes));
      setCounts({ total: unique.length, swiped: swipedCount, remaining: unswiped.length });
      setUnswipedIds(unswiped);
      setPriceById(prices);
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
      await bulkSaveSwipes(unswipedIds, "dislike", priceById);
      schedulePush();
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      setConfirm(null);
    }
  }, [confirm, unswipedIds, priceById, router]);

  const handleReset = useCallback(async () => {
    if (confirm !== "reset") {
      setConfirm("reset");
      return;
    }
    setBusy("reset");
    try {
      await resetAllSwipes();
      schedulePush();
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

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
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

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>GitHub token (for on-launch refresh)</Text>
              <Text style={styles.sectionHint}>
                Lets the app trigger a fresh scrape on Uniqlo when it opens. Create a fine-grained PAT at
                github.com/settings/personal-access-tokens with{" "}
                <Text style={styles.code}>Actions: Read and write</Text> on the{" "}
                <Text style={styles.code}>clothing-sales-tracker</Text> repo.
              </Text>
              <View style={styles.tokenRow}>
                <Text style={styles.tokenStatus}>
                  {tokenStatus === "loading"
                    ? "…"
                    : tokenStatus === "configured"
                      ? "✓ configured"
                      : "○ not set"}
                </Text>
                {tokenStatus === "configured" && (
                  <TouchableOpacity onPress={handleClearToken} style={styles.linkButton}>
                    <Text style={styles.linkLabel}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                style={styles.input}
                value={tokenInput}
                onChangeText={setTokenInput}
                placeholder="github_pat_..."
                placeholderTextColor="#9ca3af"
                autoCorrect={false}
                autoCapitalize="none"
                secureTextEntry
              />
              <TouchableOpacity
                onPress={handleSaveToken}
                disabled={!tokenInput.trim()}
                style={[styles.saveButton, !tokenInput.trim() && styles.actionDisabled]}
              >
                <Text style={styles.saveLabel}>Save token</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Cross-device sync (Gist)</Text>
              <Text style={styles.sectionHint}>
                Backs up swipes + catalog + price history to a private GitHub Gist. Same data
                appears on every device that's signed in with your token, and survives clearing
                Expo Go. PAT needs <Text style={styles.code}>gist</Text> scope (classic) or
                Account permission <Text style={styles.code}>Gists: Read and write</Text>{" "}
                (fine-grained).
              </Text>
              <View style={styles.tokenRow}>
                <Text style={styles.tokenStatus}>
                  {syncState.gistId
                    ? `✓ ${formatSyncAge(syncState.lastSync)}`
                    : "○ not synced yet"}
                </Text>
                {syncState.gistId && (
                  <TouchableOpacity onPress={handleSyncDisconnect} style={styles.linkButton}>
                    <Text style={styles.linkLabel}>Disconnect</Text>
                  </TouchableOpacity>
                )}
              </View>
              {syncState.error && <Text style={styles.errorLine}>{syncState.error}</Text>}
              <View style={styles.syncButtonRow}>
                <TouchableOpacity
                  onPress={handleSyncPull}
                  disabled={syncState.busy !== null}
                  style={[styles.secondaryButton, syncState.busy !== null && styles.actionDisabled]}
                >
                  {syncState.busy === "pull" ? (
                    <ActivityIndicator color="#111827" />
                  ) : (
                    <Text style={styles.secondaryLabel}>Pull & merge</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSyncPush}
                  disabled={syncState.busy !== null}
                  style={[styles.saveButton, syncState.busy !== null && styles.actionDisabled, styles.flex1]}
                >
                  {syncState.busy === "push" ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveLabel}>Sync now</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatSyncAge(iso: string | null): string {
  if (!iso) return "configured · not yet synced";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "configured";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "synced just now";
  if (m < 60) return `synced ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `synced ${h}h ago`;
  return `synced ${Math.round(h / 24)}d ago`;
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
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 20 },
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
  section: {
    marginTop: 24,
    gap: 10,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  sectionHint: { fontSize: 12, color: "#6b7280", lineHeight: 18 },
  code: { fontFamily: "monospace", color: "#374151" },
  tokenRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tokenStatus: { fontSize: 13, color: "#374151" },
  linkButton: { paddingVertical: 4, paddingHorizontal: 8 },
  linkLabel: { color: "#2563eb", fontSize: 13 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
  },
  saveButton: {
    backgroundColor: "#111827",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  saveLabel: { color: "#fff", fontWeight: "600" },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  secondaryLabel: { color: "#111827", fontWeight: "600" },
  syncButtonRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  flex1: { flex: 1 },
  errorLine: { color: "#dc2626", fontSize: 12 },
});
