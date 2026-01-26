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

    unread = false,
    showUnreadDot = true,
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

    const accessory =
      rightAccessory ??
      (unread && showUnreadDot ? <View style={styles.unreadDot} /> : null);

    return (
      <TouchableOpacity
        testID={testID}
        style={[
          styles.card,
          unread && styles.cardUnread,
          disabled && styles.cardDisabled,
        ]}
        onPress={disabled ? undefined : onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
      >
        <View style={styles.rowTop}>
          <Text
            style={[styles.title, unread && styles.titleUnread]}
            numberOfLines={1}
          >
            {title || "Conversation"}
          </Text>

          {accessory ? (
            <View style={styles.rightAccessory}>{accessory}</View>
          ) : null}
        </View>

        <Text
          style={[styles.preview, unread && styles.previewUnread]}
          numberOfLines={maxPreviewLines}
        >
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
  cardUnread: {
    borderColor: "#CBD5E1",
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
  titleUnread: {
    fontWeight: "800",
  },
  preview: {
    fontSize: 13,
    color: "#475569",
    marginBottom: 6,
  },
  previewUnread: {
    fontWeight: "700",
    color: "#0F172A",
  },
  meta: {
    fontSize: 12,
    color: "#6B7280",
  },

  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
});
