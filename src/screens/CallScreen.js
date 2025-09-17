import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from "react-native";
import { RTCView, mediaDevices } from "react-native-webrtc";
import { getCurrentUser, fetchAuthSession } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/api";

const createCallSessionGql = /* GraphQL */ `
  mutation CreateCallSession($input: CreateCallSessionInput!) {
    createCallSession(input: $input) {
      id
      conversationId
      participantIds
      createdBy
      status
      startedAt
    }
  }
`;

const createCallSignalGql = /* GraphQL */ `
  mutation CreateCallSignal($input: CreateCallSignalInput!) {
    createCallSignal(input: $input) {
      id
      conversationId
      callSessionId
      senderId
      type
      createdAt
    }
  }
`;

const onSignalGql = /* GraphQL */ `
  subscription OnSignal($conversationId: ID!) {
    onSignal(conversationId: $conversationId) {
      id
      conversationId
      callSessionId
      senderId
      type
      createdAt
    }
  }
`;

const client = generateClient();

async function getMyId() {
  try {
    const { userId, username } = await getCurrentUser();
    return userId || username;
  } catch {}
  try {
    const { tokens } = await fetchAuthSession();
    const sub = tokens?.idToken?.payload?.sub;
    if (sub) return sub;
  } catch {}
  throw new Error("Not signed in (no current user)");
}

export default function CallScreen({ navigation, route }) {
  const conversationId = route?.params?.conversationId;
  const peerId = route?.params?.peerId;

  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const [events, setEvents] = useState([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: "user" },
        });
        if (active) setLocalStream(stream);
      } catch (e) {
        console.warn("getUserMedia error:", e);
      }
    })();
    return () => {
      active = false;
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setEvents((prev) => [
        {
          id: `no-cid-${Date.now()}`,
          text: "Missing conversationId; subscription not started.",
        },
        ...prev,
      ]);
      return;
    }

    setEvents((prev) => [
      {
        id: `cid-${Date.now()}`,
        text: `Subscribing on conversationId=${conversationId}`,
      },
      ...prev,
    ]);

    let sub;
    (async () => {
      try {
        const myId = await getMyId();
        setEvents((prev) => [
          { id: `me-${Date.now()}`, text: `Authed as ${myId}` },
          ...prev,
        ]);

        sub = client
          .graphql({
            query: onSignalGql,
            variables: { conversationId },
            authMode: "userPool",
          })
          .subscribe({
            next: (payload) => {
              const data = payload?.data ?? payload?.value?.data;

              const sig = data?.onSignal ?? data?.onCreateCallSignal ?? null;

              if (!sig) {
                let raw = "";
                try {
                  raw = JSON.stringify(payload).slice(0, 300);
                } catch {
                  raw = String(payload).slice(0, 300);
                }
                setEvents((prev) => [
                  {
                    id: `undef-${Date.now()}`,
                    text:
                      "Subscription event received but no 'onSignal' payload found. raw=" +
                      raw,
                  },
                  ...prev,
                ]);
                return;
              }

              setEvents((prev) => [
                {
                  id: sig.id || String(Date.now()),
                  text: `onSignal from ${sig.senderId} type=${sig.type}`,
                },
                ...prev,
              ]);
              console.log("onSignal:", sig);
            },
            error: (e) => {
              setEvents((prev) => [
                { id: `err-${Date.now()}`, text: `onSignal error: ${e}` },
                ...prev,
              ]);
              console.warn("onSignal error", e);
            },
          });
      } catch (e) {
        setEvents((prev) => [
          { id: `auth-${Date.now()}`, text: `Auth error: ${e.message || e}` },
          ...prev,
        ]);
      }
    })();

    return () => {
      try {
        sub && sub.unsubscribe();
      } catch {}
    };
  }, [conversationId]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      localStream?.getAudioTracks().forEach((t) => (t.enabled = m));
      return !m;
    });
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((v) => {
      localStream?.getVideoTracks().forEach((t) => (t.enabled = !v));
      return !v;
    });
  }, [localStream]);

  const endCall = useCallback(() => {
    localStream?.getTracks().forEach((t) => t.stop());
    navigation.goBack();
  }, [localStream, navigation]);

  const sendPing = useCallback(async () => {
    try {
      if (!conversationId) {
        setEvents((prev) => [
          {
            id: `no-cid-p-${Date.now()}`,
            text: "Cannot send ping: missing conversationId.",
          },
          ...prev,
        ]);
        return;
      }
      const myId = await getMyId();

      const sessionRes = await client.graphql({
        query: createCallSessionGql,
        variables: {
          input: {
            conversationId,
            participantIds: [myId, peerId].filter(Boolean),
            createdBy: myId,
            status: "RINGING",
            startedAt: new Date().toISOString(),
          },
        },
        authMode: "userPool",
      });

      const callSessionId = sessionRes?.data?.createCallSession?.id;

      await client.graphql({
        query: createCallSignalGql,
        variables: {
          input: {
            conversationId,
            callSessionId,
            senderId: myId,
            type: "OFFER",
            payload: JSON.stringify({ hello: "world" }),
          },
        },
        authMode: "userPool",
      });

      setEvents((prev) => [
        { id: `ping-${Date.now()}`, text: `Ping sent by ${myId}` },
        ...prev,
      ]);
    } catch (e) {
      setEvents((prev) => [
        { id: `pingerr-${Date.now()}`, text: `Ping error: ${e.message || e}` },
        ...prev,
      ]);
      console.warn("Ping error", e);
    }
  }, [conversationId, peerId]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.videoContainer}>
        {localStream ? (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            mirror
          />
        ) : (
          <Text style={{ color: "#fff" }}>Starting camera…</Text>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
          <Text style={styles.controlText}>{muted ? "Unmute" : "Mute"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.hangupBtn} onPress={endCall}>
          <Text style={styles.hangupText}>End</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlBtn} onPress={toggleVideo}>
          <Text style={styles.controlText}>
            {videoEnabled ? "Video Off" : "Video On"}
          </Text>
        </TouchableOpacity>

        {/* Temporary button to prove subscription delivery */}
        <TouchableOpacity style={styles.controlBtn} onPress={sendPing}>
          <Text style={styles.controlText}>Ping</Text>
        </TouchableOpacity>
      </View>

      {/* Small on-screen log so you can see events on both devices */}
      <View style={styles.logBox}>
        <Text style={styles.logTitle}>Event Log</Text>
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Text style={styles.logLine}>• {item.text}</Text>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  videoContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  localVideo: { width: "100%", height: "100%" },

  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    paddingVertical: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  controlBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#222",
    borderRadius: 24,
    marginVertical: 6,
  },
  hangupBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#b00020",
    borderRadius: 24,
    marginVertical: 6,
  },
  controlText: { color: "#fff" },
  hangupText: { color: "#fff", fontWeight: "700" },

  logBox: {
    maxHeight: 160,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#333",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0d0d0d",
  },
  logTitle: { color: "#bbb", marginBottom: 6, fontWeight: "600" },
  logLine: { color: "#eee", marginBottom: 4 },
});
