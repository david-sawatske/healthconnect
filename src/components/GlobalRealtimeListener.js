import React, { useEffect, useMemo, useRef, useState } from "react";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

const CONVERSATION_PARTICIPANTS_BY_USER = /* GraphQL */ `
  query ConversationParticipantsByUser(
    $userId: String!
    $limit: Int
    $nextToken: String
  ) {
    conversationParticipantsByUser(
      userId: $userId
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        conversationId
        userId
        lastReadAt
        updatedAt
      }
      nextToken
    }
  }
`;

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

const log = (...args) => console.log("[GLOBAL_REALTIME]", ...args);

async function listConversationIdsForUser(userId) {
  const ids = new Set();
  let nextToken = null;

  do {
    const { data, errors } = await client.graphql({
      query: CONVERSATION_PARTICIPANTS_BY_USER,
      variables: { userId, limit: 500, nextToken },
      authMode: "userPool",
    });

    if (errors?.length) {
      log("conversationParticipantsByUser errors", errors);
      break;
    }

    const page = data?.conversationParticipantsByUser;
    const items = page?.items || [];
    items.forEach((it) => {
      if (it?.conversationId) ids.add(it.conversationId);
    });

    nextToken = page?.nextToken || null;
  } while (nextToken);

  return Array.from(ids);
}

export default function GlobalRealtimeListener({
  navRef,
  call,
  onIncomingMessage,
}) {
  const [conversationIds, setConversationIds] = useState([]);
  const subsRef = useRef([]);

  const conversationIdSet = useMemo(
    () => new Set(conversationIds),
    [conversationIds],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const u = await getCurrentUser().catch(() => null);
      const myId = u?.userId;

      if (!myId) {
        log("No current user; skipping conversationId fetch");
        return;
      }

      log("Fetching conversationIds for user", myId);
      const ids = await listConversationIdsForUser(myId).catch((e) => {
        log("listConversationIdsForUser error", e?.message || e);
        return [];
      });

      if (!cancelled) {
        log("conversationIds =", ids.length);
        setConversationIds(ids);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    subsRef.current.forEach((s) => {
      try {
        s?.unsubscribe?.();
      } catch {}
    });
    subsRef.current = [];

    let cancelled = false;

    (async () => {
      const u = await getCurrentUser().catch(() => null);
      const myId = u?.userId;
      if (!myId) return;

      try {
        const msgSub = client
          .graphql({ query: ON_CREATE_MESSAGE, authMode: "userPool" })
          .subscribe({
            next: ({ data }) => {
              if (cancelled) return;

              const m = data?.onCreateMessage;
              if (!m?.id || !m?.conversationId) return;

              if (!conversationIdSet.has(m.conversationId)) return;

              if (m.senderId === myId) return;

              if (String(m.type).toUpperCase() === "SYSTEM") return;

              const current = navRef?.isReady?.()
                ? navRef.getCurrentRoute?.()
                : null;

              const isAlreadyInChat =
                current?.name === "Chat" &&
                (current?.params?.conversationId === m.conversationId ||
                  current?.params?.id === m.conversationId ||
                  current?.params?.conversation?.id === m.conversationId);

              if (isAlreadyInChat) return;

              const preview =
                (m.body && String(m.body).trim()) ||
                (String(m.type).toUpperCase() === "IMAGE" ? "📷 Image" : "") ||
                (String(m.type).toUpperCase() === "VIDEO" ? "🎥 Video" : "") ||
                "New message";

              onIncomingMessage?.({
                id: m.id,
                conversationId: m.conversationId,
                senderId: m.senderId,
                preview,
                createdAt: m.createdAt,
              });
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

                const s = data?.onSignal;
                if (!s?.id) return;

                if (s.senderId === myId) return;

                if (String(s.type).toUpperCase() !== "OFFER") return;

                let offer = null;
                try {
                  const parsed =
                    typeof s.payload === "string"
                      ? JSON.parse(s.payload)
                      : s.payload;
                  offer = parsed?.offer ?? parsed;
                } catch {
                  offer = null;
                }

                const incoming = {
                  conversationId: s.conversationId,
                  callSessionId: s.callSessionId,
                  senderId: s.senderId,
                  offer,
                };

                const did =
                  (call?.showIncoming?.(incoming), true) ||
                  (call?.show?.(incoming), true) ||
                  (call?.setIncoming?.(incoming), true) ||
                  (call?.setIncomingCall?.(incoming), true);

                if (!did) {
                  log(
                    "Incoming OFFER received but CallContext has no showIncoming/show/setIncoming method.",
                    incoming,
                  );
                } else {
                  log("Incoming call OFFER", {
                    conversationId: incoming.conversationId,
                    callSessionId: incoming.callSessionId,
                  });
                }
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
  }, [conversationIds, navRef, call]);

  return null;
}
