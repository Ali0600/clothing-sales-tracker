import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";

// Checks for an EAS Update on launch and whenever the app returns to the foreground; if
// one is available, downloads it and asks the user whether to reload now (the update
// otherwise applies on the next cold start). expo-updates is inert in dev / Expo Go /
// web, so this no-ops there. Best-effort — a failed check must never disrupt the app.
export function useOtaUpdates() {
  // Guards against overlapping checks and stacked alerts; once we've shown the prompt we
  // leave it set so we don't nag again this session (a transient failure resets it).
  const busy = useRef(false);

  const checkForUpdate = useCallback(async () => {
    if (__DEV__ || Platform.OS === "web" || !Updates.isEnabled || busy.current) return;
    busy.current = true;
    try {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (!isAvailable) {
        busy.current = false; // nothing pending — re-check on the next foreground
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert(
        "Update available",
        "A new version of Clothing Sales Tracker is ready. Reload now to update?",
        [
          { text: "Later", style: "cancel" },
          { text: "Reload", onPress: () => Updates.reloadAsync() },
        ],
      );
      // Leave `busy` set: the prompt is showing (or was dismissed) — don't re-prompt.
    } catch {
      busy.current = false; // transient (network/timeout) — allow a retry later
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkForUpdate();
    });
    return () => sub.remove();
  }, [checkForUpdate]);
}
