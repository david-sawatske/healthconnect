import { useEffect, useMemo, useRef, useState } from "react";
import { getGraphqlClient } from "../amplify/client";
import { useCall } from "../../context/CallContext";
import {
  shouldNotifyForMessage,
  toIncomingBannerPayload,
} from "../../features/chat/chatRealtimeHelpers";
import { handleIncomingOfferSignal } from "../../features/calls/callRealtimeHelpers";

const client = getGraphqlClient();

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

const LIST_MY_CONVERSATIONS = /* GraphQL */ `
  query ListMyConversations($myId: String!, $limit: Int, $nextToken: String) {
    listConversations(
      filter: { memberIds: { contains: $myId } }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        memberIds
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

async function listConversationIdsByMemberContains(myId) {
  const ids = new Set();
  let nextToken = null;

  do {
    const { data, errors } = await client.graphql({
      query: LIST_MY_CONVERSATIONS,
      variables: { myId, limit: 200, nextToken },
      authMode: "userPool",
    });

    if (errors?.length) {
      log("listConversations errors", errors);
      break;
    }

    const page = data?.listConversations;
    const items = page?.items || [];
    items.forEach((c) => {
      if (c?.id) ids.add(c.id);
    });

    nextToken = page?.nextToken || null;
  } while (nextToken);

  return Array.from(ids);
}

export default function GlobalRealtimeListener({
  navRef,
  currentUser,
  onIncomingMessage,
}) {
  const call = useCall();

  const [conversationIds, setConversationIds] = useState([]);
  const subsRef = useRef([]);

  const myId = currentUser?.id || null;

  const conversationIdSet = useMemo(
    () => new Set(conversationIds),
    [conversationIds],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!myId) {
        log("No currentUser.id yet; skipping conversationId fetch");
        return;
      }

      log("Fetching conversationIds for app user id", myId);

      let ids = await listConversationIdsForUser(myId).catch((e) => {
        log("conversationParticipantsByUser error", e?.message || e);
        return [];
      });

      if (!ids.length) {
        log(
          "No ConversationParticipant rows found; falling back to listConversations contains(memberIds)",
        );
        ids = await listConversationIdsByMemberContains(myId).catch((e) => {
          log("listConversations fallback error", e?.message || e);
          return [];
        });
      }

      if (!cancelled) {
        log("conversationIds =", ids.length);
        setConversationIds(ids);
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

                const s = data?.onSignal;
                if (!s) return;

                handleIncomingOfferSignal({ signal: s, myId, call });
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
  }, [
    conversationIds,
    navRef,
    myId,
    call,
    onIncomingMessage,
    conversationIdSet,
  ]);

  return null;
}
