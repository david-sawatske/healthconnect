export function shouldNotifyForMessage({
  message,
  myId,
  conversationIdSet,
  navRef,
}) {
  if (!message?.id || !message?.conversationId) return false;

  if (!conversationIdSet?.has?.(message.conversationId)) return false;
  if (message.senderId === myId) return false;
  if (String(message.type).toUpperCase() === "SYSTEM") return false;

  const current = navRef?.isReady?.() ? navRef.getCurrentRoute?.() : null;

  const currentConversationId =
    current?.params?.conversation?.id ||
    current?.params?.conversationId ||
    current?.params?.id ||
    null;

  const isAlreadyInChat =
    current?.name === "Chat" &&
    currentConversationId === message.conversationId;

  return !isAlreadyInChat;
}

export function buildMessagePreview(message) {
  const type = String(message?.type).toUpperCase();
  const body = (message?.body && String(message.body).trim()) || "";

  return (
    body ||
    (type === "IMAGE" ? "📷 Image" : "") ||
    (type === "VIDEO" ? "🎥 Video" : "") ||
    "New message"
  );
}

export function toIncomingBannerPayload(message) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    memberIds: Array.isArray(message.memberIds) ? message.memberIds : [],
    preview: buildMessagePreview(message),
    createdAt: message.createdAt,
  };
}
