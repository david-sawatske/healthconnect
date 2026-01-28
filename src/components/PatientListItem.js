import React, { useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";

const getInitials = (name = "") => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (first + last).toUpperCase();
};

const PatientListItem = ({ name, subtitle, onPress, testID }) => {
  const initials = useMemo(() => getInitials(name), [name]);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.85}
      testID={testID}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>

      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>
          {name || "Unnamed Patient"}
        </Text>

        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
};

export default PatientListItem;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },

  avatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#3730A3",
  },

  mid: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    marginTop: 3,
    fontSize: 13,
    color: "#6B7280",
  },

  chevron: {
    marginLeft: 10,
    fontSize: 26,
    lineHeight: 26,
    color: "#9CA3AF",
  },
});
