import { createCallSignal } from "./callSignalsService";
import {
  CALL_SYSTEM_TYPES,
  postCallSystemMessage,
} from "./callSystemMessageService";

export async function declineIncomingCall({
  conversationId,
  callSessionId,
  senderId,
  conversationMemberIds = [],
  memberIdsFromRoute = [],
  memberIds = [],
  reason = "declined",
}) {
  if (!conversationId || !callSessionId || !senderId) return null;

  const resolvedConversationMemberIds =
    conversationMemberIds?.length > 0 ? conversationMemberIds : memberIds;

  await postCallSystemMessage({
    conversationId,
    senderId,
    callSessionId,
    conversationMemberIds: resolvedConversationMemberIds,
    memberIdsFromRoute,
    type: CALL_SYSTEM_TYPES.DECLINED,
    connected: false,
  });

  await createCallSignal({
    conversationId,
    callSessionId,
    senderId,
    type: "BYE",
    payload: { reason, at: Date.now() },
  });

  return true;
}

export async function timeoutOutgoingCall({
  conversationId,
  callSessionId,
  senderId,
  conversationMemberIds = [],
  memberIdsFromRoute = [],
  startedAt = null,
}) {
  if (!conversationId || !callSessionId || !senderId) return null;

  await postCallSystemMessage({
    conversationId,
    senderId,
    callSessionId,
    conversationMemberIds,
    memberIdsFromRoute,
    type: CALL_SYSTEM_TYPES.TIMEOUT,
    connected: false,
    startedAt,
  });

  await createCallSignal({
    conversationId,
    callSessionId,
    senderId,
    type: "BYE",
    payload: { reason: "no-answer", at: Date.now() },
  });

  return true;
}

export async function hangUpCall({
  conversationId,
  callSessionId,
  senderId,
  conversationMemberIds = [],
  memberIdsFromRoute = [],
  connected = false,
  startedAt = null,
}) {
  if (!conversationId || !callSessionId || !senderId) return null;

  await postCallSystemMessage({
    conversationId,
    senderId,
    callSessionId,
    conversationMemberIds,
    memberIdsFromRoute,
    type: CALL_SYSTEM_TYPES.HANGUP,
    connected,
    startedAt,
  });

  await createCallSignal({
    conversationId,
    callSessionId,
    senderId,
    type: "BYE",
    payload: { endedBy: senderId, at: Date.now() },
  });

  return true;
}
