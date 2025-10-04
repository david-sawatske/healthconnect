import React, { useEffect } from "react";
import { Modal, View, Text, Pressable, StyleSheet, Image, Platform } from "react-native";
import { useCall } from "../context/CallContext";

// Optional haptics (safe if not installed)
let Haptics = null;
try {
  // If you haven't installed it yet, run: npx expo install expo-haptics
  Haptics = require("expo-haptics");
} catch (_) {}

export default function IncomingCallModal({ onAccept, onDecline }) {
  const { incoming, hideIncoming } = useCall();
  const visible = !!incoming;

  useEffect(() => {
    if (visible && Haptics?.impactAsync) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }
  }, [visible]);

  if (!visible) return null;

  const callerName = incoming?.callerName ?? "Unknown caller";
  const avatarUrl = incoming?.avatarUrl;

  const handleDecline = () => {
    onDecline?.(incoming);
    hideIncoming();
  };

  const handleAccept = () => {
    onAccept?.(incoming);
    // We keep the modal up to let the call screen take over, but you can hide if desired:
    hideIncoming();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent={Platform.OS === "android"}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{callerName.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.title}>Incoming call</Text>
          <Text style={styles.name}>{callerName}</Text>

          <View style={styles.actions}>
            <Pressable onPress={handleDecline} style={[styles.btn, styles.btnDecline]}>
              <Text style={styles.btnText}>Decline</Text>
            </Pressable>
            <Pressable onPress={handleAccept} style={[styles.btn, styles.btnAccept]}>
              <Text style={styles.btnText}>Answer</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: 16,
  },
  card: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 24,
    padding: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    marginBottom: 12,
  },
  avatarFallback: {
    backgroundColor: "#e8e8e8",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 32,
    fontWeight: "700",
    color: "#333",
  },
  title: {
    fontSize: 16,
    opacity: 0.7,
    marginBottom: 4,
  },
  name: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  btnDecline: {
    backgroundColor: "#e74c3c",
  },
  btnAccept: {
    backgroundColor: "#2ecc71",
  },
  btnText: {
    color: "white",
    fontWeight: "700",
    fontSize: 16,
  },
});
