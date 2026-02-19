import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as DocumentPicker from "expo-document-picker";

import {
  bumpConversationLastMessageAt,
  ensureParticipantAndMarkRead,
  fetchUsersByIds,
  guessMessageTypeForFile,
  listMessagesByConversation,
  sendMediaMessage,
  sendTextMessage,
  subscribeToNewMessages,
  uploadAttachment,
} from "./chatService";

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

export function useChat({ conversationId, conversation, currentUser }) {
  const myId = currentUser?.id || null;

  const memberIdsFromConversation = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds
    : [];

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [usersById, setUsersById] = useState({});
  const [sending, setSending] = useState(false);
  
  const activeConversationIdRef = useRef(conversationId);
  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);

  const memberIds = useMemo(() => {
    if (memberIdsFromConversation.length) return memberIdsFromConversation;
    const first = messages?.[0];
    if (Array.isArray(first?.memberIds) && first.memberIds.length)
      return first.memberIds;
    return [];
  }, [memberIdsFromConversation.join("|"), messages]);

  const memberIdsToUseForSend = useMemo(() => {
    const base = memberIds.length ? memberIds : memberIdsFromConversation;
    const merged = uniq([...(base || []), myId]);
    return merged.length ? merged : myId ? [myId] : [];
  }, [
    memberIds.length ? memberIds.join("|") : "",
    memberIdsFromConversation.join("|"),
    myId,
  ]);

  const markRead = useCallback(async () => {
    if (!conversationId || !myId) return;
    try {
      await ensureParticipantAndMarkRead({ conversationId, userId: myId });
    } catch (e) {
      console.log("[CHAT] ensure/markRead error:", e);
    }
  }, [conversationId, myId]);

  const refreshMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      const items = await listMessagesByConversation(conversationId, {
        limit: 50,
      });
      if (activeConversationIdRef.current !== conversationId) return;
      setMessages(items);
    } catch (e) {
      console.log("[CHAT] fetchMessages error:", e);
    }
  }, [conversationId]);
  
  useEffect(() => {
    if (!conversationId) return;
    refreshMessages();
    markRead();
  }, [conversationId, refreshMessages, markRead]);
  
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!conversationId) return;
      if (!memberIds.length) return;
      try {
        const map = await fetchUsersByIds(memberIds);
        if (!cancelled) setUsersById(map);
      } catch (e) {
        console.log("[CHAT] participant load error:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, memberIds.join("|")]);
  
  useEffect(() => {
    if (!conversationId) return;

    const sub = subscribeToNewMessages({
      onMessage: (msg) => {
        if (!msg?.id) return;
        if (msg.conversationId !== conversationId) return;

        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
        );
        markRead();
      },
      onError: (err) => console.log("[CHAT] subscription error:", err),
    });
    
    const retryTimer = setTimeout(() => {
      refreshMessages();
    }, 500);

    return () => {
      try {
        sub?.unsubscribe?.();
      } catch (e) {}
      clearTimeout(retryTimer);
    };
  }, [conversationId, markRead, refreshMessages]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || !conversationId || !myId) return;

    try {
      setSending(true);
      const created = await sendTextMessage({
        conversationId,
        senderId: myId,
        memberIds: memberIdsToUseForSend,
        body,
      });

      if (created) {
        await bumpConversationLastMessageAt(conversationId);
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created],
        );
      }

      setText("");
      markRead();
    } catch (e) {
      console.log("[CHAT] send error:", e);
      throw e;
    } finally {
      setSending(false);
    }
  }, [text, conversationId, myId, memberIdsToUseForSend, markRead]);

  const attach = useCallback(async () => {
    if (!conversationId || !myId) return;

    const result = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (result.canceled) return;

    const file = result.assets?.[0];
    if (!file?.uri) return;

    const type = guessMessageTypeForFile({
      mimeType: file.mimeType,
      name: file.name,
    });

    const { key } = await uploadAttachment({
      conversationId,
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
    });

    const created = await sendMediaMessage({
      conversationId,
      senderId: myId,
      memberIds: memberIdsToUseForSend,
      type,
      mediaKey: key,
    });

    if (created) {
      await bumpConversationLastMessageAt(conversationId);
      setMessages((prev) =>
        prev.some((m) => m.id === created.id) ? prev : [...prev, created],
      );
    }

    markRead();
  }, [conversationId, myId, memberIdsToUseForSend, markRead]);

  const roleForSender = useCallback(
    (senderId, type) => {
      if (String(type).toUpperCase() === "SYSTEM") return "SYSTEM";
      const r = usersById?.[senderId]?.role;
      return r || (senderId === myId ? "USER" : "USER");
    },
    [usersById, myId],
  );

  const nameForSender = useCallback(
    (senderId, type) => {
      if (String(type).toUpperCase() === "SYSTEM") return "System";
      const u = usersById?.[senderId];
      return (
        u?.displayName || u?.email || (senderId === myId ? "You" : "Member")
      );
    },
    [usersById, myId],
  );

  return {
    myId,
    memberIds,
    memberIdsToUseForSend,
    messages,
    usersById,
    text,
    setText,
    sending,
    refreshMessages,
    markRead,
    send,
    attach,
    roleForSender,
    nameForSender,
  };
}
