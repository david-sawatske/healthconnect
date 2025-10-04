import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  mediaDevices,
  RTCPeerConnection,
  RTCView,
  RTCIceCandidate,
} from "react-native-webrtc";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

const log = (...args) => console.log("[CALL]", ...args);

async function safeGql(op, vars, label = "GQL") {
  try {
    const res = await client.graphql({
      query: op,
      variables: vars,
      authMode: "userPool",
    });
    log(label, "OK", JSON.stringify(res?.data)?.slice(0, 300));
    return res;
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e?.message || String(e);
    log(label, "ERROR", msg);
    try {
      Alert.alert("GraphQL error", msg);
    } catch {}
    throw e;
  }
}

const CreateCallSession = /* GraphQL */ `
  mutation CreateCallSession($input: CreateCallSessionInput!) {
    createCallSession(input: $input) {
      id
      conversationId
      participantIds
      createdBy
      status
      createdAt
    }
  }
`;
const UpdateCallSession = /* GraphQL */ `
  mutation UpdateCallSession($input: UpdateCallSessionInput!) {
    updateCallSession(input: $input) {
      id
      status
      endedAt
      updatedAt
    }
  }
`;
const CreateCallSignal = /* GraphQL */ `
  mutation CreateCallSignal($input: CreateCallSignalInput!) {
    createCallSignal(input: $input) {
      id
      conversationId
      callSessionId
      senderId
      type
      payload
      createdAt
    }
  }
`;
const OnSignal = /* GraphQL */ `
  subscription OnSignal($conversationId: ID!) {
    onSignal(conversationId: $conversationId) {
      id
      conversationId
      callSessionId
      senderId
      type
      payload
      createdAt
    }
  }
`;
/** For the in-chat “Call ended” system message */
const CreateMessage = /* GraphQL */ `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      id
    }
  }
`;

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export default function CallScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();

  const conversation = route?.params?.conversation;
  const conversationId = conversation?.id;

  const incomingOffer = route?.params?.incomingOffer || null;
  const incomingSessionId = route?.params?.incomingSessionId || null;

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const subRef = useRef(null);

  const [me, setMe] = useState(null);
  const [callSessionId, _setCallSessionId] = useState(null);
  const callSessionIdRef = useRef(null);
  const setCallSessionId = (id) => {
    callSessionIdRef.current = id;
    _setCallSessionId(id);
  };

  const answeredOnceRef = useRef(false);
  const endingRef = useRef(false);

  const [status, setStatus] = useState("IDLE");
  const [isCaller, setIsCaller] = useState(false);
  const [hasLocal, setHasLocal] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setMe({ sub: u.userId });
        log("currentUser", { sub: u.userId, username: u.username });
      } catch (e) {
        log("getCurrentUser failed", e);
      }
    })();
  }, []);

  const isClosed = (pc) =>
    !pc ||
    pc.connectionState === "closed" ||
    pc.signalingState === "closed" ||
    pc.iceConnectionState === "closed";

  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    log("PC ctor", pc?._peerConnectionId);

    pc.onicecandidate = (event) => {
      if (event.candidate && callSessionIdRef.current && me?.sub) {
        log("onicecandidate → send ICE");
        sendSignal("ICE", { candidate: event.candidate }).catch((e) =>
          log("send ICE error", e),
        );
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams || [];
      if (stream) {
        remoteStreamRef.current = stream;
        setHasRemote(true);
        log("ontrack remote stream", stream?.id);
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      log("connectionState", s);
      if (s === "connected") setStatus("CONNECTED");
    };

    return pc;
  }, [me?.sub]);

  const ensurePC = useCallback(() => {
    const pc = pcRef.current;
    if (pc && !isClosed(pc)) return pc;
    try {
      pc?.close?.();
    } catch {}
    pcRef.current = createPC();
    return pcRef.current;
  }, [createPC]);

  const getLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    log("getUserMedia start");
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
    });
    log("getUserMedia OK tracks", stream.getTracks().length);
    localStreamRef.current = stream;
    setHasLocal(true);
    const pc = ensurePC();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    log("local tracks added to PC", pc?._peerConnectionId);
    return stream;
  }, [ensurePC]);

  const sendSignal = useCallback(
    async (type, payload, sessionOverride) => {
      const sid = sessionOverride || callSessionIdRef.current;
      if (!me?.sub || !conversationId || !sid) {
        log("sendSignal skipped (missing fields)", {
          type,
          me: !!me?.sub,
          conversationId,
          callSessionId: sid,
        });
        return;
      }
      await safeGql(
        CreateCallSignal,
        {
          input: {
            conversationId,
            callSessionId: sid,
            senderId: me.sub,
            type,
            payload: JSON.stringify(payload),
          },
        },
        `CreateCallSignal:${type}`,
      );
    },
    [me?.sub, conversationId],
  );

  const stopTracksAndPC = () => {
    try {
      pcRef.current?.getSenders?.().forEach((s) => s.track?.stop?.());
    } catch {}
    try {
      pcRef.current?.close?.();
    } catch {}
    pcRef.current = null;
    try {
      localStreamRef.current?.getTracks?.forEach((t) => t.stop());
    } catch {}
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setHasLocal(false);
    setHasRemote(false);
  };

  const leaveToChat = () => {
    try {
      navigation?.goBack?.();
    } catch {}
  };

  const postEndedSystemMessage = async (endedBySub, opts = {}) => {
    try {
      await client.graphql({
        query: CreateMessage,
        variables: {
          input: {
            conversationId,
            senderId: endedBySub || "system",
            memberIds: conversation?.memberIds || [],
            type: "SYSTEM",
            body: opts.declined ? "Call declined" : "Call ended",
          },
        },
        authMode: "userPool",
      });
    } catch (e) {
      log("CreateMessage(system: Call ended) failed", e?.message || e);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    log("subscribing OnSignal", conversationId);
    try {
      subRef.current?.unsubscribe?.();
    } catch {}

    subRef.current = client
      .graphql({
        query: OnSignal,
        variables: { conversationId },
        authMode: "userPool",
      })
      .subscribe({
        next: async ({ data }) => {
          try {
            const sig = data?.onSignal;
            log(
              "onSignal event",
              sig?.type,
              "from",
              sig?.senderId,
              "sess",
              sig?.callSessionId,
            );
            if (!sig) return;
            if (sig.senderId === me?.sub) return;

            let pc = ensurePC();

            if (sig.type === "OFFER") {
              if (!callSessionIdRef.current)
                setCallSessionId(sig.callSessionId);
              log("OFFER received; waiting for user action in ChatScreen");
              return;
            }

            if (sig.type === "ANSWER" && isCaller) {
              const answer =
                typeof sig.payload === "string"
                  ? JSON.parse(sig.payload)
                  : sig.payload;
              if (!pc.currentRemoteDescription) {
                await pc.setRemoteDescription(answer);
                log("setRemoteDescription(answer) OK");
              }
              return;
            }

            if (sig.type === "ICE") {
              const { candidate } =
                typeof sig.payload === "string"
                  ? JSON.parse(sig.payload)
                  : sig.payload;
              if (candidate) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidate));
                  log("addIceCandidate OK");
                } catch (e) {
                  log("addIceCandidate failed", e);
                }
              }
              return;
            }

            if (sig.type === "DECLINED") {
              if (endingRef.current) return;
              endingRef.current = true;
              setStatus("ENDED");
              try {
                await safeGql(
                  UpdateCallSession,
                  {
                    input: {
                      id: sig.callSessionId || callSessionIdRef.current,
                      status: "ENDED",
                      endedAt: new Date().toISOString(),
                    },
                  },
                  "UpdateCallSession(DECLINED)",
                );
              } catch {}
              stopTracksAndPC();
              await postEndedSystemMessage(sig.senderId, { declined: true });
              try {
                navigation?.goBack?.();
              } catch {}
              return;
            }

            if (sig.type === "BYE") {
              if (endingRef.current) return;
              endingRef.current = true;

              setStatus("ENDED");
              try {
                await safeGql(
                  UpdateCallSession,
                  {
                    input: {
                      id: sig.callSessionId || callSessionIdRef.current,
                      status: "ENDED",
                      endedAt: new Date().toISOString(),
                    },
                  },
                  "UpdateCallSession(BYE)",
                );
              } catch {}

              stopTracksAndPC();
              await postEndedSystemMessage(sig.senderId);
              leaveToChat();
              return;
            }
          } catch (e) {
            log("onSignal handler error", e);
          }
        },
        error: (err) => log("OnSignal subscription error", err),
      });

    return () => subRef.current?.unsubscribe?.();
  }, [conversationId, me?.sub, ensurePC, isCaller]);

  useEffect(() => {
    (async () => {
      if (!incomingOffer || !incomingSessionId || !me?.sub) return;
      if (answeredOnceRef.current) {
        log("answer already processed; skipping");
        return;
      }
      answeredOnceRef.current = true;

      log("answering incoming call (user accepted)", { incomingSessionId });
      try {
        if (!callSessionIdRef.current) setCallSessionId(incomingSessionId);

        let pc = ensurePC();

        const offer =
          typeof incomingOffer === "string"
            ? JSON.parse(incomingOffer)
            : incomingOffer;

        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(offer);
          log("setRemoteDescription(offer) OK");
        }

        await getLocalStream();

        if (isClosed(pcRef.current)) {
          log("PC closed after getUserMedia; recreating + re-binding tracks");
          pc = ensurePC();
          localStreamRef.current?.getTracks?.forEach((t) =>
            pc.addTrack(t, localStreamRef.current),
          );
        }

        pc = ensurePC();
        log("createAnswer on pc", pc?._peerConnectionId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        log("sending ANSWER");
        await sendSignal("ANSWER", answer, incomingSessionId);

        setStatus("RINGING");
        setIsCaller(false);
      } catch (e) {
        log("accept/answer error", e);
        Alert.alert("Call error", "Failed to accept the incoming call.");
        answeredOnceRef.current = false;
      }
    })();
  }, [
    incomingOffer,
    incomingSessionId,
    me?.sub,
    ensurePC,
    getLocalStream,
    sendSignal,
  ]);

  const startCall = useCallback(async () => {
    if (!me?.sub || !conversationId) return;
    if (status !== "IDLE") return;

    try {
      log("startCall preflight: conversationId", conversationId);

      let pc = ensurePC();
      await getLocalStream();

      if (isClosed(pcRef.current)) {
        log("PC closed after getUserMedia; recreating + re-binding tracks");
        pc = ensurePC();
        localStreamRef.current?.getTracks?.forEach((t) =>
          pc.addTrack(t, localStreamRef.current),
        );
      }

      setIsCaller(true);
      setStatus("RINGING");

      const { data } = await safeGql(
        CreateCallSession,
        {
          input: {
            conversationId,
            participantIds: Array.from(new Set(conversation?.memberIds || [])),
            createdBy: me.sub,
            status: "RINGING",
            startedAt: new Date().toISOString(),
          },
        },
        "CreateCallSession",
      );

      const sessionId = data?.createCallSession?.id;
      setCallSessionId(sessionId);
      log("CallSession created", sessionId);

      pc = ensurePC();
      log("createOffer on pc", pc?._peerConnectionId, {
        connectionState: pc?.connectionState,
        signalingState: pc?.signalingState,
        iceConnectionState: pc?.iceConnectionState,
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      log("sending OFFER", { callSessionId: sessionId });
      await sendSignal("OFFER", offer, sessionId);
    } catch (e) {
      log("startCall error", e);
      Alert.alert("Call failed", "Unable to start the call.");
      setStatus("IDLE");
      setIsCaller(false);
    }
  }, [
    me?.sub,
    conversationId,
    conversation?.memberIds,
    ensurePC,
    getLocalStream,
    sendSignal,
    status,
  ]);

  const hangUp = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;

    setStatus("ENDED");

    const sid = callSessionIdRef.current;
    try {
      await sendSignal("BYE", { endedBy: me?.sub }, sid);
    } catch (e) {
      log("send BYE failed", e);
    }

    try {
      await safeGql(
        UpdateCallSession,
        {
          input: {
            id: sid,
            status: "ENDED",
            endedAt: new Date().toISOString(),
          },
        },
        "UpdateCallSession(hangUp)",
      );
    } catch {}

    stopTracksAndPC();
    await postEndedSystemMessage(me?.sub);
    leaveToChat();
  }, [me?.sub, sendSignal]);

  useEffect(() => {
    return () => {
      log("unmount cleanup");
      try {
        subRef.current?.unsubscribe?.();
      } catch {}
      stopTracksAndPC();
    };
  }, []);

  const local = localStreamRef.current;
  const remote = remoteStreamRef.current;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.videoArea}>
        {hasRemote ? (
          <RTCView
            streamURL={remote?.toURL?.()}
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
            streamURL={local?.toURL?.()}
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
            onPress={startCall}
            disabled={status !== "IDLE"}
          >
            <Text style={styles.btnText}>Start Call</Text>
          </TouchableOpacity>
        )}

        {(status === "RINGING" || status === "CONNECTED") && (
          <>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                const stream = localStreamRef.current;
                if (!stream) return;
                stream
                  .getAudioTracks()
                  .forEach((t) => (t.enabled = !t.enabled));
                setMuted((m) => !m);
              }}
            >
              <Text style={styles.btnText}>{muted ? "Unmute" : "Mute"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                const stream = localStreamRef.current;
                if (!stream) return;
                stream
                  .getVideoTracks()
                  .forEach((t) => (t.enabled = !t.enabled));
                setVideoEnabled((v) => !v);
              }}
            >
              <Text style={styles.btnText}>
                {videoEnabled ? "Video Off" : "Video On"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.danger]}
              onPress={hangUp}
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
