import React, { useCallback, useEffect, useMemo } from "react";
import {
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { Product } from "@cst/shared";
import type { Swipe } from "../storage";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const CARD_W = Math.min(SCREEN_W - 32, 440);
const CARD_H = Math.min(SCREEN_H - 240, 640);
const SWIPE_THRESHOLD = CARD_W * 0.28;

interface CardProps {
  product: Product;
  isNew: boolean;
  previousPrice: number | null;
  onSwipe: (swipe: Swipe) => void;
  zIndex: number;
}

function Card({ product, isNew, previousPrice, onSwipe, zIndex }: CardProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const fling = useCallback(
    (swipe: Swipe) => {
      const targetX = swipe === "like" ? CARD_W * 1.6 : swipe === "dislike" ? -CARD_W * 1.6 : 0;
      const targetY = swipe === "maybe" ? -CARD_H * 1.4 : 0;
      tx.value = withTiming(targetX, { duration: 220 });
      ty.value = withTiming(targetY, { duration: 220 }, () => {
        runOnJS(onSwipe)(swipe);
      });
    },
    [tx, ty, onSwipe],
  );

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY;
    })
    .onEnd(() => {
      const dx = tx.value;
      const dy = ty.value;
      if (dx > SWIPE_THRESHOLD) runOnJS(fling)("like");
      else if (dx < -SWIPE_THRESHOLD) runOnJS(fling)("dislike");
      else if (dy < -SWIPE_THRESHOLD) runOnJS(fling)("maybe");
      else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-CARD_W, 0, CARD_W], [-12, 0, 12])}deg` },
    ],
  }));

  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, SWIPE_THRESHOLD], [0, 1], "clamp"),
  }));
  const nopeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-SWIPE_THRESHOLD, 0], [1, 0], "clamp"),
  }));
  const maybeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-SWIPE_THRESHOLD, 0], [1, 0], "clamp"),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.card, { zIndex }, cardStyle]}>
        <Image source={{ uri: product.imageUrl }} style={styles.image} resizeMode="cover" />
        {previousPrice != null ? (
          <View
            style={[
              styles.repriceBadge,
              previousPrice > product.salePrice ? styles.repriceDown : styles.repriceUp,
            ]}
          >
            <Text style={styles.repriceText}>
              {previousPrice > product.salePrice ? "PRICE DROP" : "PRICE UP"}
            </Text>
            <Text style={styles.repriceSub}>
              was €{previousPrice.toFixed(2)} → €{product.salePrice.toFixed(2)}
            </Text>
          </View>
        ) : isNew ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW ON SALE</Text>
          </View>
        ) : null}
        <Animated.View style={[styles.stamp, styles.stampLike, likeStyle]}>
          <Text style={styles.stampText}>LIKE</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampNope, nopeStyle]}>
          <Text style={styles.stampText}>NOPE</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampMaybe, maybeStyle]}>
          <Text style={styles.stampText}>MAYBE</Text>
        </Animated.View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>
            {product.name}
          </Text>
          <View style={styles.priceRow}>
            <Text style={styles.salePrice}>€{product.salePrice.toFixed(2)}</Text>
            {product.salePrice < product.price && (
              <>
                <Text style={styles.basePrice}>€{product.price.toFixed(2)}</Text>
                <Text style={styles.discount}>-{product.discountPct}%</Text>
              </>
            )}
          </View>
          <TouchableOpacity onPress={() => void WebBrowser.openBrowserAsync(product.url)}>
            <Text style={styles.link}>Open on Uniqlo →</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

interface SwipeDeckProps {
  products: Product[];
  newIds: Set<string>;
  repricedIds: Map<string, number>;
  onSwipe: (product: Product, swipe: Swipe) => void;
  onUndo: () => void;
  canUndo: boolean;
}

export function SwipeDeck({ products, newIds, repricedIds, onSwipe, onUndo, canUndo }: SwipeDeckProps) {
  const [index, setIndex] = React.useState(0);

  // If the products list shrank below the current index (e.g. after a poll
  // refresh or coming back from another screen with most items already swiped),
  // wind index back so the remaining items are visible.
  useEffect(() => {
    setIndex((i) => (i >= products.length ? 0 : i));
  }, [products.length]);

  const handleSwipe = useCallback(
    (swipe: Swipe) => {
      const product = products[index];
      if (!product) return;
      onSwipe(product, swipe);
      setIndex((i) => i + 1);
    },
    [products, index, onSwipe],
  );

  // Undo is now driven by Home: it restores the swipe in storage, sets
  // pinFrontId so the un-swiped product surfaces at slot 0 of the next
  // buildDeck, and bumps a key on this component so we remount and
  // index re-initializes to 0. So all we do here is forward the tap.
  const handleUndo = useCallback(() => {
    onUndo();
  }, [onUndo]);

  const visible = useMemo(() => products.slice(index, index + 3).reverse(), [products, index]);

  if (index >= products.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>You're caught up — no more items.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.stack}>
        {visible.map((p, i) => (
          <Card
            key={p.id}
            product={p}
            isNew={newIds.has(p.id)}
            previousPrice={repricedIds.get(p.id) ?? null}
            onSwipe={handleSwipe}
            zIndex={i + 1}
          />
        ))}
      </View>
      <View style={styles.buttons}>
        <ActionButton
          label="↩"
          tone="undo"
          onPress={handleUndo}
          disabled={!canUndo}
          small
        />
        <ActionButton label="✕" tone="nope" onPress={() => handleSwipe("dislike")} />
        <ActionButton label="?" tone="maybe" onPress={() => handleSwipe("maybe")} />
        <ActionButton label="♥" tone="like" onPress={() => handleSwipe("like")} />
      </View>
      <Text style={styles.counter}>
        {index + 1} / {products.length}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  tone,
  onPress,
  disabled,
  small,
}: {
  label: string;
  tone: "like" | "nope" | "maybe" | "undo";
  onPress: () => void;
  disabled?: boolean;
  small?: boolean;
}) {
  const color =
    tone === "like"
      ? "#22c55e"
      : tone === "nope"
        ? "#ef4444"
        : tone === "maybe"
          ? "#eab308"
          : "#6b7280";
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        small ? styles.buttonSmall : styles.button,
        { borderColor: color },
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[small ? styles.buttonLabelSmall : styles.buttonLabel, { color }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 24 },
  stack: { width: CARD_W, height: CARD_H },
  card: {
    position: "absolute",
    width: CARD_W,
    height: CARD_H,
    borderRadius: 20,
    backgroundColor: "#fff",
    overflow: "hidden",
    flexDirection: "column",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  image: { flex: 1, width: "100%", backgroundColor: "#f3f4f6", minHeight: 200 },
  info: { padding: 16, gap: 6, flexShrink: 0 },
  name: { fontSize: 18, fontWeight: "600", color: "#111827" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  salePrice: { fontSize: 22, fontWeight: "700", color: "#dc2626" },
  basePrice: { fontSize: 14, color: "#6b7280", textDecorationLine: "line-through" },
  discount: { fontSize: 14, fontWeight: "600", color: "#dc2626" },
  link: { fontSize: 14, color: "#2563eb", marginTop: 4 },
  newBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "#dc2626",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    zIndex: 10,
  },
  newBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  repriceBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    zIndex: 10,
  },
  repriceDown: { backgroundColor: "#16a34a" },
  repriceUp: { backgroundColor: "#6b7280" },
  repriceText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  repriceSub: { color: "#fff", fontSize: 10, opacity: 0.9, marginTop: 1 },
  stamp: {
    position: "absolute",
    top: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 3,
    borderRadius: 8,
    zIndex: 20,
  },
  stampLike: { right: 24, borderColor: "#22c55e", transform: [{ rotate: "12deg" }] },
  stampNope: { left: 24, borderColor: "#ef4444", transform: [{ rotate: "-12deg" }] },
  stampMaybe: { alignSelf: "center", top: 24, borderColor: "#eab308" },
  stampText: { fontSize: 24, fontWeight: "800", color: "#111" },
  buttons: { flexDirection: "row", gap: 16, marginTop: 24, alignItems: "center" },
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  buttonSmall: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  buttonDisabled: { opacity: 0.35 },
  buttonLabel: { fontSize: 28, fontWeight: "700" },
  buttonLabelSmall: { fontSize: 20, fontWeight: "700" },
  counter: { marginTop: 16, color: "#6b7280" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 18, color: "#6b7280" },
});
