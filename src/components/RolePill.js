import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "../ui/theme";

const ROLE_CONFIG = {
  PATIENT: {
    label: "Patient",
    bg: theme.colors.pillPatientBg,
    text: theme.colors.pillPatientText,
  },
  PROVIDER: {
    label: "Provider",
    bg: theme.colors.pillProviderBg,
    text: theme.colors.pillProviderText,
  },
  ADVOCATE: {
    label: "Advocate",
    bg: theme.colors.pillAdvocateBg,
    text: theme.colors.pillAdvocateText,
  },
};

const RolePill = ({ role, style, textStyle, testID }) => {
  const config = ROLE_CONFIG[role];

  if (!config) return null;

  return (
    <View style={[styles.pill, { backgroundColor: config.bg }, style]} testID={testID}>
      <Text style={[styles.text, { color: config.text }, textStyle]}>
        {config.label}
      </Text>
    </View>
  );
};

export default RolePill;

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});
