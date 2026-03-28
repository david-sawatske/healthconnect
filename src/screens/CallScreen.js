import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView } from "react-native-webrtc";

import { useCall } from "../features/calls/useCall";
import { theme } from "../ui/theme";

const devLog = (...args) => {
  if (__DEV__) console.log("[CALL_SCREEN]", ...args);
};

export default function CallScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();

  const params = route?.params || {};
  const conversation = params.conversation || null;
  const conversationId = params.conversationId || conversation?.id || null;

  const memberIds = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds.filter(Boolean)
    : [];

  const incomingOffer = params.incomingOffer || null;
  const incomingSessionId =
    params.incomingSessionId || params.callSessionId || null;

  const {
    status,
    isCaller,
    callSessionId,
    muted,
    videoEnabled,
    hasLocal,
    hasRemote,
    localStream,
    remoteStream,
    startCall,
    hangUp,
    toggleMute,
    toggleVideo,
  } = useCall({
    conversationId,
    conversationMemberIds: memberIds,
    memberIdsFromRoute: memberIds,
    incomingOffer,
    incomingSessionId,
    navigation,
  });

  const handleStartCall = async () => {
    try {
      await startCall();
    } catch (error) {
      devLog("startCall failed", error);
      Alert.alert(
        "Unable to start call",
        "Something went wrong while starting the call. Please try again.",
      );
    }
  };

  const handleHangUp = async () => {
    try {
      await hangUp();
    } catch (error) {
      devLog("hangUp failed", error);
      Alert.alert(
        "Unable to end call",
        "Something went wrong while ending the call. Please try again.",
      );
    }
  };

  const statusLabel =
    status === "RINGING"
      ? "Ringing…"
      : status === "CONNECTED"
        ? "Connected"
        : status === "CONNECTING"
          ? "Connecting…"
          : "Waiting to start";

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Call</Text>
        <Text style={styles.subtitle}>{statusLabel}</Text>
      </View>

      <View style={styles.videoArea}>
        {hasRemote ? (
          <RTCView
            streamURL={remoteStream?.toURL?.()}
            style={styles.remoteVideo}
            objectFit="cover"
            mirror={false}
          />
        ) : (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderTitle}>Video not live yet</Text>
            <Text style={styles.placeholderText}>
              {status === "RINGING"
                ? "The other participant is being notified."
                : "Remote video will appear here when the call connects."}
            </Text>
          </View>
        )}

        {hasLocal ? (
          <RTCView
            streamURL={localStream?.toURL?.()}
            style={styles.localPreview}
            objectFit="cover"
            mirror
          />
        ) : null}
      </View>

      <View style={styles.controlsSection}>
        {status === "IDLE" ? (
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleStartCall}
            activeOpacity={0.85}
          >
            <Text style={[styles.buttonText, styles.primaryButtonText]}>
              Start Call
            </Text>
          </TouchableOpacity>
        ) : null}

        {(status === "RINGING" || status === "CONNECTED") && (
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={toggleMute}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                {muted ? "Unmute" : "Mute"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={toggleVideo}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                {videoEnabled ? "Video Off" : "Video On"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.dangerButton]}
              onPress={handleHangUp}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, styles.dangerButtonText]}>
                Hang Up
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.metaWrap}>
        <Text style={styles.metaText}>Status: {status}</Text>
        {callSessionId ? (
          <Text style={styles.metaText}>
            Session: {callSessionId.slice(0, 8)}…
          </Text>
        ) : null}
        {isCaller ? <Text style={styles.metaText}>Caller</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },

  header: {
    alignItems: "center",
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.sm,
  },

  title: {
    ...theme.type.h2,
    color: theme.colors.text,
    textAlign: "center",
  },

  subtitle: {
    ...theme.type.subtext,
    color: theme.colors.subtext,
    textAlign: "center",
    marginTop: theme.space.xs,
  },

  videoArea: {
    flex: 1,
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.sm,
    justifyContent: "center",
    alignItems: "center",
  },

  remoteVideo: {
    width: "100%",
    height: "100%",
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    overflow: "hidden",
  },

  placeholderCard: {
    width: "100%",
    height: "100%",
    maxHeight: "78%",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    ...theme.shadow.card,
  },

  placeholderTitle: {
    ...theme.type.h3,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: theme.space.xs,
  },

  placeholderText: {
    ...theme.type.subtext,
    color: theme.colors.subtext,
    textAlign: "center",
    lineHeight: 20,
  },

  localPreview: {
    position: "absolute",
    right: theme.space.sm,
    bottom: 96,
    width: 120,
    height: 180,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    ...theme.shadow.card,
  },

  controlsSection: {
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.xs,
  },

  controlsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.space.xs,
  },

  button: {
    minHeight: 44,
    paddingVertical: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  primaryButton: {
    alignSelf: "center",
    minWidth: 140,
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },

  secondaryButton: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
  },

  dangerButton: {
    backgroundColor: theme.colors.dangerBg,
    borderColor: theme.colors.dangerText,
  },

  buttonText: {
    ...theme.type.body,
    fontWeight: "600",
  },

  primaryButtonText: {
    color: theme.colors.primaryText,
  },

  secondaryButtonText: {
    color: theme.colors.text,
  },

  dangerButtonText: {
    color: theme.colors.dangerText,
  },

  metaWrap: {
    alignItems: "center",
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.sm,
    gap: theme.space.xs,
  },

  metaText: {
    ...theme.type.small,
    color: theme.colors.subtext,
    textAlign: "center",
  },
});
