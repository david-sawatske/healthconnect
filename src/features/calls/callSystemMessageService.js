import {
  getCallSession,
  postCallEndedSystemMessage,
  updateCallSession,
} from "./callSignalsService";
import { isDirectMessageConversationId } from "../../utils/ids";

export const CALL_SYSTEM_TYPES = {
  DECLINED: "DECLINED",
  TIMEOUT: "TIMEOUT",
  HANGUP: "HANGUP",
};

function uniqueNonEmpty(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function memberIdsFromDmConversationId(conversationId) {
  if (!isDirectMessageConversationId(conversationId)) return [];

  const parts = conversationId.split(":");

  if (parts.length !== 3) return [];

  return uniqueNonEmpty([parts[1], parts[2]]);
}

function buildCallMessageMemberIds({
  conversationId,
  conversationMemberIds = [],
  memberIdsFromRoute = [],
}) {
  const fromConversation = Array.isArray(conversationMemberIds)
    ? conversationMemberIds
    : [];

  const fromRoute = Array.isArray(memberIdsFromRoute) ? memberIdsFromRoute : [];
  const fromDmId = memberIdsFromDmConversationId(conversationId);

  return uniqueNonEmpty([...fromConversation, ...fromRoute, ...fromDmId]);
}

function formatCallTime(iso) {
  return new Date(iso || Date.now()).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(ms) {
  if (!ms || ms < 0) return null;

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getDurationText({ startedAt, endedAt }) {
  if (!startedAt || !endedAt) return "";

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "";

  const pretty = formatDuration(endMs - startMs);

  return pretty ? ` • Duration: ${pretty}` : "";
}

function buildCallSystemBody({ type, connected, startedAt, endedAt }) {
  const callTime = formatCallTime(startedAt || endedAt);

  if (type === CALL_SYSTEM_TYPES.DECLINED) {
    return `📞 Call declined • ${callTime}`;
  }

  if (type === CALL_SYSTEM_TYPES.TIMEOUT) {
    return `📞 Missed call • ${callTime}`;
  }

  if (type === CALL_SYSTEM_TYPES.HANGUP && connected) {
    const durationText = getDurationText({ startedAt, endedAt });
    return `📞 Call • ${callTime}${durationText}`;
  }

  return `📞 Call canceled • ${callTime}`;
}

export async function postCallSystemMessage({
  conversationId,
  senderId,
  callSessionId,
  conversationMemberIds = [],
  memberIdsFromRoute = [],
  type,
  connected = false,
  startedAt = null,
}) {
  if (!conversationId || !senderId || !callSessionId) {
    throw new Error(
      "postCallSystemMessage requires conversationId, senderId, and callSessionId",
    );
  }

  let resolvedStartedAt = startedAt;

  if (!resolvedStartedAt) {
    const session = await getCallSession(callSessionId);
    resolvedStartedAt = session?.startedAt || null;
  }

  const endedAt = new Date().toISOString();

  const memberIds = buildCallMessageMemberIds({
    conversationId,
    conversationMemberIds,
    memberIdsFromRoute,
  });

  if (!memberIds.length) {
    throw new Error(
      "postCallSystemMessage could not determine message memberIds",
    );
  }

  const body = buildCallSystemBody({
    type,
    connected,
    startedAt: resolvedStartedAt,
    endedAt,
  });

  await postCallEndedSystemMessage({
    conversationId,
    senderId,
    memberIds,
    body,
  });

  await updateCallSession({
    id: callSessionId,
    status: "ENDED",
    endedAt,
  });

  return {
    endedAt,
    body,
    memberIds,
  };
}
