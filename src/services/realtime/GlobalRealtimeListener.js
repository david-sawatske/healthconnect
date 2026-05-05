import { useEffect, useMemo, useRef, useState } from "react";
import { getGraphqlClient } from "../amplify/client";
import { useCall } from "../../context/CallContext";
import {
  shouldNotifyForMessage,
  toIncomingBannerPayload,
} from "../../features/chat/chatRealtimeHelpers";
import { handleIncomingOfferSignal } from "../../features/calls/callRealtimeHelpers";
import { fetchConversationIdsForUser } from "../../features/chat/chatService";

const client = getGraphqlClient();

const ON_CREATE_MESSAGE = /* GraphQL */ `
  subscription OnCreateMessage {
    onCreateMessage {
      id
      conversationId
      senderId
      memberIds
      type
      body
      createdAt
    }
  }
`;

const ON_SIGNAL = /* GraphQL */ `
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

const TERMINAL_CALL_SIGNAL_TYPES = new Set([
  "BYE",
  "ENDED",
  "CANCEL",
  "TIMEOUT",
  "DECLINE",
  "DECLINED",
]);

const log = (...args) => console.log("[GLOBAL_REALTIME]", ...args);

function isTerminalCallSignal(type) {
  return TERMINAL_CALL_SIGNAL_TYPES.has(String(type || "").toUpperCase());
}

export default function GlobalRealtimeListener({
  navRef,
  currentUser,
  onIncomingMessage,
}) {
  const call = useCall();

  const [conversationIds, setConversationIds] = useState([]);
  const subsRef = useRef([]);
  const callRef = useRef(call);

  const myId =
    currentUser?.id || currentUser?.sub || currentUser?.userId || null;

  const conversationIdSet = useMemo(
    () => new Set(conversationIds),
    [conversationIds],
  );

  useEffect(() => {
    callRef.current = call;
  }, [call]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!myId) {
        log("No currentUser id yet; skipping conversationId fetch");
        return;
      }

      log("Fetching conversationIds for app user id", myId);

      try {
        const ids = await fetchConversationIdsForUser(myId);

        if (!cancelled) {
          log("conversationIds =", ids.length);
          setConversationIds(ids);
        }
      } catch (e) {
        log("fetchConversationIdsForUser error", e?.message || e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [myId]);

  useEffect(() => {
    subsRef.current.forEach((s) => {
      try {
        s?.unsubscribe?.();
      } catch {}
    });

    subsRef.current = [];

    let cancelled = false;

    (async () => {
      if (!myId) return;

      try {
        const msgSub = client
          .graphql({ query: ON_CREATE_MESSAGE, authMode: "userPool" })
          .subscribe({
            next: ({ data }) => {
              if (cancelled) return;

              const m = data?.onCreateMessage;
              if (!m) return;

              const shouldNotify = shouldNotifyForMessage({
                message: m,
                myId,
                conversationIdSet,
                navRef,
              });

              if (!shouldNotify) return;

              onIncomingMessage?.(toIncomingBannerPayload(m));
            },
            error: (err) => log("onCreateMessage sub error", err),
          });

        subsRef.current.push(msgSub);
        log("Subscribed: onCreateMessage");
      } catch (e) {
        log("Failed subscribing to onCreateMessage", e?.message || e);
      }

      for (const conversationId of conversationIds) {
        if (cancelled) break;

        try {
          const sigSub = client
            .graphql({
              query: ON_SIGNAL,
              variables: { conversationId },
              authMode: "userPool",
            })
            .subscribe({
              next: ({ data }) => {
                if (cancelled) return;

                const signal = data?.onSignal;
                if (!signal) return;

                const isOwnSignal = signal.senderId === myId;

                if (isTerminalCallSignal(signal.type)) {
                  if (!isOwnSignal) {
                    log("Remote terminal call signal received; hiding modal", {
                      type: signal.type,
                      conversationId: signal.conversationId,
                      callSessionId: signal.callSessionId,
                    });

                    callRef.current?.hide?.();
                  }

                  return;
                }

                handleIncomingOfferSignal({
                  signal,
                  myId,
                  call: callRef.current,
                });
              },
              error: (err) =>
                log("onSignal sub error", { conversationId, err }),
            });

          subsRef.current.push(sigSub);
        } catch (e) {
          log(
            "Failed subscribing to onSignal",
            conversationId,
            e?.message || e,
          );
        }
      }

      log("Subscribed: onSignal x", conversationIds.length);
    })();

    return () => {
      cancelled = true;

      subsRef.current.forEach((s) => {
        try {
          s?.unsubscribe?.();
        } catch {}
      });

      subsRef.current = [];
    };
  }, [conversationIds, navRef, myId, onIncomingMessage, conversationIdSet]);

  return null;
}
