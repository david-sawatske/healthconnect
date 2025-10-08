import { useEffect, useRef } from "react";
import { generateClient } from "aws-amplify/api";
import { useCall } from "../context/CallContext";

const client = generateClient();

const OnSignalSub = /* GraphQL */ `
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

export function useCallSignals({ conversationId, currentUserId }) {
  const { ring, hide } = useCall();
  const subRef = useRef(null);
  const rangSessionsRef = useRef(new Set());

  useEffect(() => {
    if (!conversationId) return;

    try {
      subRef.current?.unsubscribe?.();
    } catch {}
    console.log("[CALL] Subscribing to onSignal for", conversationId);

    subRef.current = client
      .graphql({
        query: OnSignalSub,
        variables: { conversationId },
        authMode: "userPool",
      })
      .subscribe({
        next: ({ data }) => {
          const evt = data?.onSignal;
          if (!evt) return;

          if (!currentUserId) return;

          const { type, callSessionId } = evt;
          const payload = safeParseJSON(evt.payload);

          if (evt.senderId === currentUserId) return;
          if (payload?.callerId && payload.callerId === currentUserId) return;

          console.log(
            "[CALL] onSignal",
            type,
            "from",
            evt.senderId,
            "sess",
            callSessionId,
          );

          if (
            type === "OFFER" &&
            payload?.callerId &&
            !rangSessionsRef.current.has(callSessionId)
          ) {
            rangSessionsRef.current.add(callSessionId);
            ring({
              callerId: payload.callerId,
              callerName: payload.callerName ?? "Unknown caller",
              callSessionId: callSessionId || payload.callSessionId,
              conversationId: evt.conversationId,
              createdAt: evt.createdAt,
              offer: payload.sdp
                ? { sdp: payload.sdp, type: payload.sdpType || "offer" }
                : null,
              rawPayload: payload,
            });
            return;
          }

          if (type === "ACCEPTED") {
            hide();
            return;
          }

          if (
            type === "CALL_CANCELED" ||
            type === "DECLINED" ||
            type === "BYE" ||
            type === "ENDED"
          ) {
            hide();
            return;
          }
        },
        error: (err) => console.log("[CALL] onSignal subscription error", err),
      });

    return () => {
      try {
        subRef.current?.unsubscribe?.();
      } catch {}
    };
  }, [conversationId, currentUserId, ring, hide]);
}

function safeParseJSON(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
