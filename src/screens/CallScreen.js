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
      startedAt
      createdAt
    }
  }
`;
const UpdateCallSession = /* GraphQL */ `
  mutation UpdateCallSession($input: UpdateCallSessionInput!) {
    updateCallSession(input: $input) {
      id
      status
      startedAt
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
const CreateMessage = /* GraphQL */ `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      id
    }
  }
`;

const GetCallSession = /* GraphQL */ `
  query GetCallSession($id: ID!) {
    getCallSession(id: $id) {
      id
      status
      startedAt
      endedAt
      updatedAt
    }
  }
`;

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const SDP_OFFER_OPTS = { offerToReceiveAudio: true, offerToReceiveVideo: true };
const SDP_ANSWER_OPTS = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
};

const RING_TIMEOUT_MS = 30000;

/** Helpers **/
const formatDuration = (ms) => {
  if (!ms || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
};

const timeLabel = (iso) =>
  new Date(iso || Date.now()).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

export default function CallScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();

  const conversation = route?.params?.conversation || null;
  const conversationId =
    route?.params?.conversationId || conversation?.id || null;

  const incomingOffer = route?.params?.incomingOffer || null;
  const incomingSessionId =
    route?.params?.incomingSessionId || route?.params?.callSessionId || null;

  const memberIdsFromRoute = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds
    : [];

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const subRef = useRef(null);
  const earlyIceRef = useRef([]);

  const ringTimerRef = useRef(null);
  const ringPollRef = useRef(null);

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


  const startedAtRef = useRef(null);
  const startPostedRef = useRef(false);


  const peerIdRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setMe({ sub: u.userId, username: u.username });
        log("currentUser", { sub: u.userId, username: u.username });
      } catch (e) {
        log("getCurrentUser failed", e);
      }
    })();
  }, []);

  const hasRemoteDesc = (pc) => {
    const a = pc?.currentRemoteDescription;
    const b = pc?.remoteDescription;
    return !!(a?.type || b?.type || a || b);
  };

  const isClosed = (pc) =>
    !pc ||
    pc.connectionState === "closed" ||
    pc.signalingState === "closed" ||
    pc.iceConnectionState === "closed";

  const clearRingTimer = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
      log("ring timer cleared");
    }
  }, []);

  const clearRingingPoll = useCallback(() => {
    if (ringPollRef.current) {
      clearInterval(ringPollRef.current);
      ringPollRef.current = null;
      log("ring poll cleared");
    }
  }, []);

  const startRingingPoll = useCallback(
    (sid) => {
      clearRingingPoll();
      ringPollRef.current = setInterval(async () => {
        try {
          const { data } = await client.graphql({
            query: GetCallSession,
            variables: { id: sid },
            authMode: "userPool",
          });
          const st = data?.getCallSession?.status;
          if (st === "ENDED") {
            log("ring poll: session ended remotely — stopping");
            clearRingTimer();
            clearRingingPoll();
            stopTracksAndPC();
            setStatus("ENDED");
            leaveToChat();
          }
        } catch (e) {
          log("ring poll error", e?.message || e);
        }
      }, 1000);
      log("ring poll started");
    },
    [clearRingTimer, clearRingingPoll],
  );

  const startRingTimer = useCallback(
    (sid) => {
      clearRingTimer();
      ringTimerRef.current = setTimeout(async () => {
        log("ring timeout fired");
        try {
          await safeGql(
            CreateCallSignal,
            {
              input: {
                conversationId,
                callSessionId: sid || callSessionIdRef.current,
                senderId: me?.sub,
                type: "BYE",
                payload: JSON.stringify({
                  reason: "no-answer",
                  at: Date.now(),
                }),
              },
            },
            "CreateCallSignal:TIMEOUT",
          );
        } catch (e) {
          log("send TIMEOUT failed", e);
        }

        try {
          await safeGql(
            UpdateCallSession,
            {
              input: {
                id: sid || callSessionIdRef.current,
                status: "ENDED",
                endedAt: new Date().toISOString(),
              },
            },
            "UpdateCallSession(TIMEOUT)",
          );
        } catch {}

        stopTracksAndPC();
        setStatus("ENDED");
        await postEndedSystemMessage(me?.sub, { timeout: true });
        leaveToChat();
      }, RING_TIMEOUT_MS);
      log("ring timer started", RING_TIMEOUT_MS, "ms");
    },
    [clearRingTimer, conversationId, me?.sub],
  );

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
      if (s === "connected") {
        setStatus("CONNECTED");
        clearRingTimer();
        clearRingingPoll();
        maybePostStartedMessageOnce();
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log("iceConnectionState", s);
      if (s === "connected" || s === "completed") {
        setStatus("CONNECTED");
        clearRingTimer();
        clearRingingPoll();
        maybePostStartedMessageOnce();
      }
    };

    return pc;
  }, [me?.sub, clearRingTimer, clearRingingPoll]);

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
    clearRingTimer();
    clearRingingPoll();
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

  /** Ensure SYSTEM messages always include both participants */
  const resolvedMemberIds = useCallback(
    (fallbackOtherId) => {
      const set = new Set();
      (memberIdsFromRoute || []).filter(Boolean).forEach((id) => set.add(id));
      if (me?.sub) set.add(me.sub);
      if (peerIdRef.current) set.add(peerIdRef.current);
      if (fallbackOtherId) set.add(fallbackOtherId);
      return Array.from(set);
    },
    [memberIdsFromRoute, me?.sub],
  );


  const maybePostStartedMessageOnce = async () => {
    try {
      if (startPostedRef.current) return;
      startPostedRef.current = true;

      if (!startedAtRef.current) {
        startedAtRef.current = new Date().toISOString();
        try {
          await safeGql(
            UpdateCallSession,
            {
              input: {
                id: callSessionIdRef.current,
                startedAt: startedAtRef.current,
              },
            },
            "UpdateCallSession(set startedAt)",
          );
        } catch {}
      }

      await safeGql(
        CreateMessage,
        {
          input: {
            conversationId,
            senderId: me?.sub,
            memberIds: resolvedMemberIds(),
            type: "SYSTEM",
            body: `📞 Call started • ${timeLabel(startedAtRef.current)}`,
          },
        },
        "CreateMessage(SYSTEM:started)",
      );
    } catch (e) {
      log("post start message failed", e?.message || e);
    }
  };

  const postEndedSystemMessage = async (endedBySub, opts = {}) => {
    try {
      const endedAtIso = new Date().toISOString();
      const reason = opts.declined
        ? "Call declined"
        : opts.timeout
          ? "Missed call (no answer)"
          : "Call ended";

      try {
        await safeGql(
          UpdateCallSession,
          {
            input: {
              id: callSessionIdRef.current,
              status: "ENDED",
              endedAt: endedAtIso,
            },
          },
          "UpdateCallSession(set endedAt)",
        );
      } catch {}

      let durationText = "";
      if (startedAtRef.current && !opts.timeout && !opts.declined) {
        const ms =
          new Date(endedAtIso).getTime() -
          new Date(startedAtRef.current).getTime();
        const pretty = formatDuration(ms);
        if (pretty) durationText = ` • Duration: ${pretty}`;
      }

      await safeGql(
        CreateMessage,
        {
          input: {
            conversationId,
            senderId: me?.sub,
            memberIds: resolvedMemberIds(endedBySub),
            type: "SYSTEM",
            body: `📞 ${reason}${durationText}`,
          },
        },
        "CreateMessage(SYSTEM:ended)",
      );
    } catch (e) {
      log("CreateMessage(system) failed", e?.message || e);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    try {
      subRef.current?.unsubscribe?.();
    } catch {}
    log("subscribing OnSignal", conversationId);

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


            if (sig?.senderId) peerIdRef.current = sig.senderId;

            let pc = ensurePC();

            if (sig.type === "OFFER") {
              if (!callSessionIdRef.current)
                setCallSessionId(sig.callSessionId);
              log("OFFER received (CallScreen). Waiting/handled elsewhere.");
              return;
            }

            if (sig.type === "ANSWER" && isCaller) {
              const answer =
                typeof sig.payload === "string"
                  ? JSON.parse(sig.payload)
                  : sig.payload;

              try {
                await pc.setRemoteDescription(answer);
                log("setRemoteDescription(answer) OK");
                clearRingTimer();
                clearRingingPoll();
              } catch (e) {
                log(
                  "setRemoteDescription(answer) error (non-fatal)",
                  e?.message || e,
                );
              }

              const queued = earlyIceRef.current.splice(0);
              for (const c of queued) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(c));
                } catch (e) {
                  log("flush ICE failed", e);
                }
              }
              return;
            }

            if (sig.type === "ICE") {
              const { candidate } =
                typeof sig.payload === "string"
                  ? JSON.parse(sig.payload)
                  : sig.payload;
              if (candidate) {
                if (!hasRemoteDesc(pc)) {
                  earlyIceRef.current.push(candidate);
                  log("queued ICE (no remote desc yet)");
                } else {
                  try {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    log("addIceCandidate OK");
                  } catch (e) {
                    log("addIceCandidate failed", e);
                  }
                }
              }
              return;
            }

            if (sig.type === "DECLINE" || sig.type === "DECLINED") {
              clearRingTimer();
              clearRingingPoll();
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
                  "UpdateCallSession(DECLINE)",
                );
              } catch {}
              stopTracksAndPC();
              await postEndedSystemMessage(sig.senderId, { declined: true });
              leaveToChat();
              return;
            }

            if (sig.type === "CANCEL" || sig.type === "TIMEOUT") {
              clearRingTimer();
              clearRingingPoll();
              if (endingRef.current) return;
              endingRef.current = true;
              setStatus("ENDED");

              let payload = sig.payload;
              if (typeof payload === "string") {
                try {
                  payload = JSON.parse(payload);
                } catch {}
              }
              const reason = payload?.reason;

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
                  "UpdateCallSession(CANCEL/TIMEOUT)",
                );
              } catch {}

              stopTracksAndPC();
              const declined = reason === "declined";
              await postEndedSystemMessage(sig.senderId, {
                timeout:
                  sig.type === "TIMEOUT" ||
                  (!declined && reason === "no-answer"),
                declined,
              });
              leaveToChat();
              return;
            }

            if (sig.type === "BYE" || sig.type === "ENDED") {
              clearRingTimer();
              clearRingingPoll();
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
  }, [
    conversationId,
    me?.sub,
    ensurePC,
    isCaller,
    clearRingTimer,
    clearRingingPoll,
  ]);

  useEffect(() => {
    (async () => {
      if (!incomingOffer || !incomingSessionId || !me?.sub) return;
      if (answeredOnceRef.current) {
        log("answer already processed; skipping");
        return;
      }
      answeredOnceRef.current = true;

      setStatus("RINGING");
      log("answering incoming call (user accepted)", { incomingSessionId });

      try {
        if (!callSessionIdRef.current) setCallSessionId(incomingSessionId);

        let pc = ensurePC();

        const offer =
          typeof incomingOffer === "string"
            ? JSON.parse(incomingOffer)
            : incomingOffer;


        if (offer?.callerId) peerIdRef.current = offer.callerId;

        if (!offer?.type || !offer?.sdp) {
          throw new Error("Bad incoming offer payload");
        }

        if (!hasRemoteDesc(pc)) {
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
        const answer = await pc.createAnswer(SDP_ANSWER_OPTS);
        await pc.setLocalDescription(answer);
        await sendSignal("ANSWER", answer, incomingSessionId);
        log("ANSWER sent");

        const queued = earlyIceRef.current.splice(0);
        for (const c of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch (e) {
            log("flush ICE failed", e);
          }
        }

        setIsCaller(false);
      } catch (e) {
        log("accept/answer error", e);
        Alert.alert("Call error", "Failed to accept the incoming call.");
        setStatus("IDLE");
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

      const startedAtIso = new Date().toISOString();
      startedAtRef.current = startedAtIso;

      const { data } = await safeGql(
        CreateCallSession,
        {
          input: {
            conversationId,
            participantIds: Array.from(new Set(memberIdsFromRoute || [])),
            createdBy: me.sub,
            status: "RINGING",
            startedAt: startedAtIso,
          },
        },
        "CreateCallSession",
      );

      const sessionId = data?.createCallSession?.id;
      setCallSessionId(sessionId);
      log("CallSession created", sessionId);

      pc = ensurePC();
      const offer = await pc.createOffer(SDP_OFFER_OPTS);
      await pc.setLocalDescription(offer);

      await sendSignal(
        "OFFER",
        { ...offer, callerId: me.sub, callerName: "Unknown caller" },
        sessionId,
      );
      log("OFFER sent", { callSessionId: sessionId });

      startRingTimer(sessionId);
      startRingingPoll(sessionId);
    } catch (e) {
      log("startCall error", e);
      Alert.alert("Call failed", "Unable to start the call.");
      setStatus("IDLE");
      setIsCaller(false);
      clearRingTimer();
      clearRingingPoll();
    }
  }, [
    me?.sub,
    conversationId,
    memberIdsFromRoute,
    ensurePC,
    getLocalStream,
    sendSignal,
    status,
    startRingTimer,
    startRingingPoll,
    clearRingTimer,
    clearRingingPoll,
  ]);

  const hangUp = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;

    setStatus("ENDED");
    clearRingTimer();
    clearRingingPoll();

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
  }, [me?.sub, sendSignal, clearRingTimer, clearRingingPoll]);

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
