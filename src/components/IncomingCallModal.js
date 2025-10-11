import React, { useCallback, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useCall } from "../context/CallContext";

export default function IncomingCallModal({ onAccept, onDecline }) {
  const { visible, status, incoming, dismissIncoming } = useCall();
  const [busy, setBusy] = useState(false);

  const handleAccept = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onAccept?.(incoming);
      dismissIncoming?.();
    } finally {
      setBusy(false);
    }
  }, [busy, onAccept, incoming, dismissIncoming]);

  const handleDecline = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onDecline?.(incoming);
    } finally {
      setBusy(false);
      dismissIncoming?.();
    }
  }, [busy, onDecline, incoming, dismissIncoming]);

  if (!visible) return null;

  const callerName = incoming?.callerName ?? "Unknown caller";
  const isConnecting = busy || status === "connecting";

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Incoming call</Text>
          <Text style={styles.subtitle}>{callerName}</Text>

          <View style={styles.row}>
            <TouchableOpacity
              testID="decline"
              onPress={handleDecline}
              disabled={busy}
              style={[
                styles.btn,
                styles.btnDecline,
                busy && styles.btnDisabled,
              ]}
            >
              <Text style={styles.btnText}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="accept"
              onPress={handleAccept}
              disabled={busy}
              style={[styles.btn, styles.btnAccept, busy && styles.btnDisabled]}
            >
              {isConnecting ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.btnText}>Accept</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.note}>
            {Platform.OS === "ios"
              ? "Ringing…"
              : status === "connecting"
                ? "Connecting…"
                : "Incoming…"}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = {
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "88%",
    padding: 20,
    borderRadius: 16,
    backgroundColor: "#111827",
    borderColor: "#374151",
    borderWidth: 1,
  },
  title: { fontSize: 20, fontWeight: "700", color: "white" },
  subtitle: { marginTop: 6, fontSize: 16, color: "#D1D5DB" },
  row: { flexDirection: "row", gap: 12, marginTop: 18 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDecline: { backgroundColor: "#991B1B" },
  btnAccept: { backgroundColor: "#065F46" },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "white", fontWeight: "700" },
  note: { marginTop: 12, color: "#9CA3AF", textAlign: "center" },
};
