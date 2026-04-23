import { useCallback, useEffect, useRef, useState } from "react";
import {
  mediaDevices,
  RTCPeerConnection,
  RTCIceCandidate,
} from "react-native-webrtc";
import { getCurrentUser } from "aws-amplify/auth";

import {
  createCallSession,
  createCallSignal,
  getCallSession,
  postCallEndedSystemMessage,
  subscribeToSignals,
  updateCallSession,
} from "./callSignalsService";

const log = (...args) => console.log("[CALL]", ...args);

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const SDP_OFFER_OPTS = { offerToReceiveAudio: true, offerToReceiveVideo: true };
const SDP_ANSWER_OPTS = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
};

const RING_TIMEOUT_MS = 10000;

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

function safeParseJson(x) {
  if (x == null) return null;
  if (typeof x !== "string") return x;
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

export function useCall({
  conversationId,
  conversationMemberIds = [],
  memberIdsFromRoute = [],
  incomingOffer = null,
  incomingSessionId = null,
  navigation,
}) {
  const [me, setMe] = useState(null);

  const [status, setStatus] = useState("IDLE");
  const [isCaller, setIsCaller] = useState(false);

  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);

  const [hasLocal, setHasLocal] = useState(false);
  const [hasRemote, setHasRemote] = useState(false);

  const [callSessionId, _setCallSessionId] = useState(null);
  const callSessionIdRef = useRef(null);
  const setCallSessionId = (id) => {
    callSessionIdRef.current = id;
    _setCallSessionId(id);
  };

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  const earlyIceRef = useRef([]);
  const endingRef = useRef(false);
  const answeredOnceRef = useRef(false);
  const connectedOnceRef = useRef(false);

  const startedAtRef = useRef(null);

  const ringTimerRef = useRef(null);
  const ringPollRef = useRef(null);
  const subRef = useRef(null);

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
    if (!ringTimerRef.current) return;
    clearTimeout(ringTimerRef.current);
    ringTimerRef.current = null;
    log("ring timer cleared");
  }, []);

  const clearRingingPoll = useCallback(() => {
    if (!ringPollRef.current) return;
    clearInterval(ringPollRef.current);
    ringPollRef.current = null;
    log("ring poll cleared");
  }, []);

  const stopTracksAndPC = useCallback(() => {
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
  }, [clearRingTimer, clearRingingPoll]);

  const leaveToChat = useCallback(() => {
    try {
      navigation?.goBack?.();
    } catch {}
  }, [navigation]);

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

  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    log("PC ctor", pc?._peerConnectionId);

    pc.onicecandidate = (event) => {
      const cand = event?.candidate;
      if (!cand) return;
      if (!callSessionIdRef.current || !me?.sub) return;

      createCallSignal({
        conversationId,
        callSessionId: callSessionIdRef.current,
        senderId: me.sub,
        type: "ICE",
        payload: { candidate: cand },
      }).catch((e) => log("send ICE error", e));
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams || [];
      if (!stream) return;
      remoteStreamRef.current = stream;
      setHasRemote(true);
      log("ontrack remote stream", stream?.id);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      log("connectionState", s);
      if (s === "connected") {
        connectedOnceRef.current = true;
        setStatus("CONNECTED");
        clearRingTimer();
        clearRingingPoll();
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log("iceConnectionState", s);
      if (s === "connected" || s === "completed") {
        connectedOnceRef.current = true;
        setStatus("CONNECTED");
        clearRingTimer();
        clearRingingPoll();
      }
    };

    return pc;
  }, [conversationId, me?.sub, clearRingTimer, clearRingingPoll]);

  const ensurePC = useCallback(() => {
    const existing = pcRef.current;
    if (existing && !isClosed(existing)) return existing;

    try {
      existing?.close?.();
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

    localStreamRef.current = stream;
    setHasLocal(true);

    const pc = ensurePC();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    log("local tracks added to PC", pc?._peerConnectionId);

    return stream;
  }, [ensurePC]);

  const postEndedSystemMessage = useCallback(
    async (opts = {}) => {
      try {
        let callStartIso = startedAtRef.current;

        if (!callStartIso && callSessionIdRef.current) {
          const sess = await getCallSession(callSessionIdRef.current);
          callStartIso = sess?.startedAt || callStartIso || null;
        }

        const endedAtIso = new Date().toISOString();
        const callStartText = timeLabel(callStartIso || endedAtIso);

        try {
          await updateCallSession({
            id: callSessionIdRef.current,
            status: "ENDED",
            endedAt: endedAtIso,
          });
        } catch {}

        const {
          declined = false,
          timeout = false,
          canceled = false,
          failed = false,
          connected = connectedOnceRef.current,
        } = opts;

        let bodyText;

        if (declined) {
          bodyText = `📞 Call declined • ${callStartText}`;
        } else if (timeout) {
          bodyText = `📞 Missed call • ${callStartText}`;
        } else if (canceled) {
          bodyText = `📞 Call canceled • ${callStartText}`;
        } else if (failed) {
          bodyText = `📞 Call failed • ${callStartText}`;
        } else if (connected) {
          let durationText = "";
          if (callStartIso) {
            const ms =
              new Date(endedAtIso).getTime() - new Date(callStartIso).getTime();
            const pretty = formatDuration(ms);
            if (pretty) durationText = ` • Duration: ${pretty}`;
          }
          bodyText = `📞 Call • ${callStartText}${durationText}`;
        } else {
          bodyText = `📞 Call ended • ${callStartText}`;
        }

        const combinedMemberIds = [
          ...(conversationMemberIds || []),
          ...(memberIdsFromRoute || []),
        ];

        const derivedMemberIds =
          typeof conversationId === "string" && conversationId.startsWith("DM:")
            ? conversationId.split(":").slice(1).filter(Boolean)
            : [];

        const visibleToAll = Array.from(
          new Set([...combinedMemberIds, ...derivedMemberIds].filter(Boolean)),
        );

        log("postEndedSystemMessage audience", {
          conversationId,
          me: me?.sub,
          conversationMemberIds,
          visibleToAll,
          opts,
        });

        await postCallEndedSystemMessage({
          conversationId,
          senderId: me?.sub,
          memberIds: visibleToAll,
          body: bodyText,
        });
      } catch (e) {
        log("postEndedSystemMessage failed", e?.message || e);
      }
    },
    [conversationId, conversationMemberIds, me?.sub],
  );

  const startRingingPoll = useCallback(
    (sid) => {
      clearRingingPoll();

      ringPollRef.current = setInterval(async () => {
        try {
          const sess = await getCallSession(sid);
          const st = sess?.status;

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
    [clearRingTimer, clearRingingPoll, stopTracksAndPC, leaveToChat],
  );

  const startRingTimer = useCallback(
    (sid) => {
      clearRingTimer();

      ringTimerRef.current = setTimeout(async () => {
        log("ring timeout fired");
        if (endingRef.current) return;
        endingRef.current = true;

        try {
          await createCallSignal({
            conversationId,
            callSessionId: sid || callSessionIdRef.current,
            senderId: me?.sub,
            type: "BYE",
            payload: { reason: "no-answer", at: Date.now() },
          });
        } catch (e) {
          log("send TIMEOUT(BYE) failed", e);
        }

        try {
          await updateCallSession({
            id: sid || callSessionIdRef.current,
            status: "ENDED",
            endedAt: new Date().toISOString(),
          });
        } catch {}

        stopTracksAndPC();
        setStatus("ENDED");

        await postEndedSystemMessage({ timeout: true, connected: false });
        leaveToChat();
      }, RING_TIMEOUT_MS);

      log("ring timer started", RING_TIMEOUT_MS, "ms");
    },
    [
      clearRingTimer,
      conversationId,
      me?.sub,
      postEndedSystemMessage,
      stopTracksAndPC,
      leaveToChat,
    ],
  );

  useEffect(() => {
    if (!conversationId) return;

    try {
      subRef.current?.unsubscribe?.();
    } catch {}

    log("subscribing OnSignal", conversationId);

    subRef.current = subscribeToSignals({
      conversationId,
      onSignal: async (sig) => {
        try {
          if (!sig) return;

          const pc = ensurePC();

          if (sig.type === "OFFER") {
            if (!callSessionIdRef.current) setCallSessionId(sig.callSessionId);
            log("OFFER received (ignored here; handled on accept path).");
            return;
          }

          if (sig.type === "ANSWER" && isCaller) {
            const answer = safeParseJson(sig.payload) || sig.payload;

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
            const payload = safeParseJson(sig.payload) || sig.payload;
            const candidate = payload?.candidate;

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

          const isDecline = sig.type === "DECLINE" || sig.type === "DECLINED";
          const isCancelOrTimeout =
            sig.type === "CANCEL" || sig.type === "TIMEOUT";
          const isBye = sig.type === "BYE" || sig.type === "ENDED";

          if (isDecline || isCancelOrTimeout || isBye) {
            clearRingTimer();
            clearRingingPoll();
            if (endingRef.current) return;
            endingRef.current = true;

            setStatus("ENDED");

            try {
              await updateCallSession({
                id: sig.callSessionId || callSessionIdRef.current,
                status: "ENDED",
                endedAt: new Date().toISOString(),
              });
            } catch {}

            stopTracksAndPC();
            leaveToChat();
          }
        } catch (e) {
          log("onSignal handler error", e);
        }
      },
      onError: (err) => log("OnSignal subscription error", err),
    });

    return () => {
      try {
        subRef.current?.unsubscribe?.();
      } catch {}
    };
  }, [
    conversationId,
    ensurePC,
    isCaller,
    clearRingTimer,
    clearRingingPoll,
    postEndedSystemMessage,
    stopTracksAndPC,
    leaveToChat,
  ]);

  useEffect(() => {
    (async () => {
      if (!incomingOffer || !incomingSessionId || !me?.sub) return;
      if (answeredOnceRef.current) return;
      answeredOnceRef.current = true;

      setStatus("RINGING");
      log("accepting incoming call (user accepted)", { incomingSessionId });

      connectedOnceRef.current = false;
      const sess = await getCallSession(incomingSessionId);
      startedAtRef.current = sess?.startedAt || new Date().toISOString();

      try {
        if (!callSessionIdRef.current) setCallSessionId(incomingSessionId);

        let pc = ensurePC();

        const offer = safeParseJson(incomingOffer) || incomingOffer;
        if (!offer?.type || !offer?.sdp) {
          log("Invalid incoming offer payload");
          setStatus("IDLE");
          answeredOnceRef.current = false;
          return;
        }

        if (!hasRemoteDesc(pc)) {
          await pc.setRemoteDescription(offer);
          log("setRemoteDescription(offer) OK");
        }

        await getLocalStream();

        if (isClosed(pcRef.current)) {
          pc = ensurePC();
          localStreamRef.current?.getTracks?.forEach((t) =>
            pc.addTrack(t, localStreamRef.current),
          );
        }

        pc = ensurePC();
        const answer = await pc.createAnswer(SDP_ANSWER_OPTS);
        await pc.setLocalDescription(answer);

        await createCallSignal({
          conversationId,
          callSessionId: incomingSessionId,
          senderId: me.sub,
          type: "ANSWER",
          payload: answer,
        });

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
        setStatus("IDLE");
        answeredOnceRef.current = false;
        throw e;
      }
    })().catch(() => {});
  }, [
    incomingOffer,
    incomingSessionId,
    me?.sub,
    conversationId,
    ensurePC,
    getLocalStream,
  ]);

  const startCall = useCallback(async () => {
    if (!me?.sub || !conversationId) return;
    if (status !== "IDLE") return;

    try {
      connectedOnceRef.current = false;
      endingRef.current = false;
      answeredOnceRef.current = false;

      let pc = ensurePC();
      await getLocalStream();

      if (isClosed(pcRef.current)) {
        pc = ensurePC();
        localStreamRef.current?.getTracks?.forEach((t) =>
          pc.addTrack(t, localStreamRef.current),
        );
      }

      setIsCaller(true);
      setStatus("RINGING");

      const startedAtIso = new Date().toISOString();
      startedAtRef.current = startedAtIso;

      const session = await createCallSession({
        conversationId,
        participantIds: Array.from(
          new Set((memberIdsFromRoute || []).filter(Boolean)),
        ),
        createdBy: me.sub,
        status: "RINGING",
        startedAt: startedAtIso,
      });

      const sessionId = session?.id;
      setCallSessionId(sessionId);
      log("CallSession created", sessionId);

      pc = ensurePC();
      const offer = await pc.createOffer(SDP_OFFER_OPTS);
      await pc.setLocalDescription(offer);

      await createCallSignal({
        conversationId,
        callSessionId: sessionId,
        senderId: me.sub,
        type: "OFFER",
        payload: { ...offer, callerId: me.sub, callerName: "Unknown caller" },
      });

      log("OFFER sent", { callSessionId: sessionId });

      startRingTimer(sessionId);
      startRingingPoll(sessionId);
    } catch (e) {
      log("startCall error", e);
      setStatus("IDLE");
      setIsCaller(false);
      clearRingTimer();
      clearRingingPoll();
      throw e;
    }
  }, [
    me?.sub,
    conversationId,
    memberIdsFromRoute,
    ensurePC,
    getLocalStream,
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
      await createCallSignal({
        conversationId,
        callSessionId: sid,
        senderId: me?.sub,
        type: "BYE",
        payload: { endedBy: me?.sub },
      });
    } catch (e) {
      log("send BYE failed", e);
    }

    try {
      await updateCallSession({
        id: sid,
        status: "ENDED",
        endedAt: new Date().toISOString(),
      });
    } catch {}

    stopTracksAndPC();
    await postEndedSystemMessage({
      canceled: !connectedOnceRef.current,
      connected: connectedOnceRef.current,
    });
    leaveToChat();
  }, [
    conversationId,
    me?.sub,
    clearRingTimer,
    clearRingingPoll,
    stopTracksAndPC,
    postEndedSystemMessage,
    leaveToChat,
  ]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setMuted((m) => !m);
  }, []);

  const toggleVideo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
    setVideoEnabled((v) => !v);
  }, []);

  useEffect(() => {
    return () => {
      log("unmount cleanup");
      try {
        subRef.current?.unsubscribe?.();
      } catch {}
      stopTracksAndPC();
    };
  }, [stopTracksAndPC]);

  return {
    me,

    status,
    isCaller,
    callSessionId,

    muted,
    videoEnabled,
    hasLocal,
    hasRemote,
    localStream: localStreamRef.current,
    remoteStream: remoteStreamRef.current,

    startCall,
    hangUp,
    toggleMute,
    toggleVideo,
  };
}
