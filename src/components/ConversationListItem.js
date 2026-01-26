import React, { memo, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

const ConversationListItem = memo(
  ({
    title,
    preview,
    timestamp,
    onPress,
    disabled = false,
    rightAccessory = null,
    maxPreviewLines = 1,
    testID,
  }) => {
    const tsLabel = useMemo(() => {
      if (!timestamp) return "No timestamp";

      const d =
        timestamp instanceof Date
          ? timestamp
          : new Date(
              typeof timestamp === "number" ? timestamp : String(timestamp),
            );

      if (Number.isNaN(d.getTime())) return "No timestamp";
      return d.toLocaleString();
    }, [timestamp]);

    return (
      <TouchableOpacity
        testID={testID}
        style={[styles.card, disabled && styles.cardDisabled]}
        onPress={disabled ? undefined : onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
      >
        <View style={styles.rowTop}>
          <Text style={styles.title} numberOfLines={1}>
            {title || "Conversation"}
          </Text>

          {rightAccessory ? (
            <View style={styles.rightAccessory}>{rightAccessory}</View>
          ) : null}
        </View>

        <Text style={styles.preview} numberOfLines={maxPreviewLines}>
          {preview || "No messages yet"}
        </Text>

        <Text style={styles.meta}>{tsLabel}</Text>
      </TouchableOpacity>
    );
  },
);

export default ConversationListItem;

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
  },
  cardDisabled: {
    opacity: 0.6,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  rightAccessory: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  preview: {
    fontSize: 13,
    color: "#475569",
    marginBottom: 6,
  },
  meta: {
    fontSize: 12,
    color: "#6B7280",
  },
});
