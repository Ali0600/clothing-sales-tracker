import { Component, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useOtaUpdates } from "../src/useOtaUpdates";

interface BoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <SafeAreaView style={errorStyles.root}>
          <ScrollView contentContainerStyle={errorStyles.scroll}>
            <Text style={errorStyles.title}>Something rendered badly</Text>
            <Text style={errorStyles.subtitle}>
              The app caught an error before it could become a blank screen. Tap reset to try
              re-mounting; if it happens again, the message below is what to paste back to Claude.
            </Text>
            <View style={errorStyles.errorBox}>
              <Text style={errorStyles.errorMessage}>{this.state.error.message}</Text>
              {this.state.error.stack && (
                <Text style={errorStyles.errorStack}>{this.state.error.stack}</Text>
              )}
            </View>
            <TouchableOpacity onPress={this.reset} style={errorStyles.resetButton}>
              <Text style={errorStyles.resetLabel}>Reset</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  // Prompt to reload when an OTA update is available (no-op in dev / web).
  useOtaUpdates();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <RootErrorBoundary>
          <Stack screenOptions={{ headerShown: false }} />
        </RootErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const errorStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 24, gap: 16 },
  title: { fontSize: 22, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 14, color: "#374151", lineHeight: 20 },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  errorMessage: { color: "#991b1b", fontSize: 14, fontWeight: "600" },
  errorStack: { color: "#7f1d1d", fontSize: 11, fontFamily: "monospace" },
  resetButton: {
    backgroundColor: "#111827",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  resetLabel: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
