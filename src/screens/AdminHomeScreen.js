import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../ui/theme";

export default function AdminHomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Admin Home</Text>
      <Text style={styles.subtitle}>Admin dashboard coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.space.lg,
  },
  title: {
    fontSize: theme.type.h1,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.space.sm,
  },
  subtitle: {
    fontSize: theme.type.body,
    color: theme.colors.subtext,
  },
});
