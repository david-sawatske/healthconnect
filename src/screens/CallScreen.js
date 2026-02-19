import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView } from "react-native-webrtc";

import { useCall } from "../features/calls/useCall";

export default function CallScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();

  const conversation = route?.params?.conversation || null;
  const conversationId =
    route?.params?.conversationId || conversation?.id || null;

  const conversationMemberIds = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds.filter(Boolean)
    : [];

  const memberIdsFromRoute = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds.filter(Boolean)
    : [];

  const incomingOffer = route?.params?.incomingOffer || null;
  const incomingSessionId =
    route?.params?.incomingSessionId || route?.params?.callSessionId || null;

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
    conversationMemberIds,
    memberIdsFromRoute,
    incomingOffer,
    incomingSessionId,
    navigation,
  });

  useEffect(() => {
    if (incomingOffer && incomingSessionId && status === "IDLE") {
    }
  }, [incomingOffer, incomingSessionId, status]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.videoArea}>
        {hasRemote ? (
          <RTCView
            streamURL={remoteStream?.toURL?.()}
            style={styles.remoteVideo}
            objectFit="cover"
            mirror={false}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {status === "RINGING"
                ? "Ringing…"
                : "Remote video will appear here"}
            </Text>
          </View>
        )}

        {hasLocal && (
          <RTCView
            streamURL={localStream?.toURL?.()}
            style={styles.localPreview}
            objectFit="cover"
            mirror
          />
        )}
      </View>

      <View style={styles.controls}>
        {status === "IDLE" && (
          <TouchableOpacity
            style={[styles.btn, styles.primary]}
            onPress={async () => {
              try {
                await startCall();
              } catch (e) {
                Alert.alert("Call failed", "Unable to start the call.");
              }
            }}
            disabled={status !== "IDLE"}
          >
            <Text style={styles.btnText}>Start Call</Text>
          </TouchableOpacity>
        )}

        {(status === "RINGING" || status === "CONNECTED") && (
          <>
            <TouchableOpacity style={styles.btn} onPress={toggleMute}>
              <Text style={styles.btnText}>{muted ? "Unmute" : "Mute"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btn} onPress={toggleVideo}>
              <Text style={styles.btnText}>
                {videoEnabled ? "Video Off" : "Video On"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.danger]}
              onPress={async () => {
                try {
                  await hangUp();
                } catch (e) {}
              }}
            >
              <Text style={styles.btnText}>Hang Up</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Text style={styles.meta}>
        {`Status: ${status}`}
        {callSessionId ? `   •   Session: ${callSessionId.slice(0, 8)}…` : ""}
        {isCaller ? "   •   Caller" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  videoArea: { flex: 1, justifyContent: "center", alignItems: "center" },
  remoteVideo: { width: "100%", height: "100%" },
  localPreview: {
    position: "absolute",
    right: 12,
    bottom: 120,
    width: 120,
    height: 180,
    borderRadius: 12,
    overflow: "hidden",
  },
  placeholder: {
    width: "92%",
    height: "68%",
    borderRadius: 16,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: { color: "#888" },
  controls: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    justifyContent: "center",
    backgroundColor: "#111",
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "#333",
  },
  primary: { backgroundColor: "#2e7d32" },
  danger: { backgroundColor: "#c62828" },
  btnText: { color: "#fff", fontWeight: "700" },
  meta: {
    textAlign: "center",
    color: "#bbb",
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
});
