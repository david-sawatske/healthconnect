import { getGraphqlClient } from "../../services/amplify/client";
import { getConversationParticipantId } from "../../utils/ids";
import { getUrl, uploadData } from "aws-amplify/storage";

const client = getGraphqlClient();

const MessagesByConversation = /* GraphQL */ `
  query MessagesByConversation(
    $conversationId: ID!
    $limit: Int
    $nextToken: String
  ) {
    messagesByConversation(
      conversationId: $conversationId
      sortDirection: ASC
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        conversationId
        senderId
        memberIds
        type
        body
        mediaKey
        thumbnailKey
        createdAt
      }
      nextToken
    }
  }
`;

const CreateMessage = /* GraphQL */ `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      id
      conversationId
      senderId
      memberIds
      type
      body
      mediaKey
      thumbnailKey
      createdAt
    }
  }
`;

const OnCreateMessage = /* GraphQL */ `
  subscription OnCreateMessage {
    onCreateMessage {
      id
      conversationId
      senderId
      memberIds
      body
      mediaKey
      thumbnailKey
      type
      createdAt
    }
  }
`;

const GetUser = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      displayName
      role
      email
    }
  }
`;

const GetConversationParticipant = /* GraphQL */ `
  query GetConversationParticipant($id: ID!) {
    getConversationParticipant(id: $id) {
      id
      conversationId
      userId
      lastReadAt
      createdAt
      updatedAt
    }
  }
`;

const CreateConversationParticipant = /* GraphQL */ `
  mutation CreateConversationParticipant(
    $input: CreateConversationParticipantInput!
  ) {
    createConversationParticipant(input: $input) {
      id
      conversationId
      userId
      lastReadAt
      createdAt
      updatedAt
    }
  }
`;

const UpdateConversationParticipant = /* GraphQL */ `
  mutation UpdateConversationParticipant(
    $input: UpdateConversationParticipantInput!
  ) {
    updateConversationParticipant(input: $input) {
      id
      lastReadAt
      updatedAt
    }
  }
`;

const UpdateConversationLastMessageAt = /* GraphQL */ `
  mutation UpdateConversationLastMessageAt($input: UpdateConversationInput!) {
    updateConversation(input: $input) {
      id
      lastMessageAt
      updatedAt
    }
  }
`;

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

export async function fetchConversationIdsForUser(userId) {
  const ids = new Set();
  let nextToken = null;

  do {
    const { data, errors } = await client.graphql({
      query: CONVERSATION_PARTICIPANTS_BY_USER,
      variables: { userId, limit: 500, nextToken },
      authMode: "userPool",
    });

    if (errors?.length) break;

    const page = data?.conversationParticipantsByUser;
    const items = page?.items || [];

    items.forEach((it) => {
      if (it?.conversationId) ids.add(it.conversationId);
    });

    nextToken = page?.nextToken || null;
  } while (nextToken);

  if (!ids.size) {
    nextToken = null;

    do {
      const { data, errors } = await client.graphql({
        query: LIST_MY_CONVERSATIONS,
        variables: { myId: userId, limit: 200, nextToken },
        authMode: "userPool",
      });

      if (errors?.length) break;

      const page = data?.listConversations;
      const items = page?.items || [];

      items.forEach((c) => {
        if (c?.id) ids.add(c.id);
      });

      nextToken = page?.nextToken || null;
    } while (nextToken);
  }

  return Array.from(ids);
}

export async function listMessagesByConversation(
  conversationId,
  { limit = 50 } = {},
) {
  const res = await client.graphql({
    query: MessagesByConversation,
    variables: { conversationId, limit },
    authMode: "userPool",
  });
  return res?.data?.messagesByConversation?.items ?? [];
}

export function subscribeToNewMessages({ onMessage, onError } = {}) {
  return client
    .graphql({ query: OnCreateMessage, authMode: "userPool" })
    .subscribe({
      next: ({ data }) => onMessage?.(data?.onCreateMessage ?? null),
      error: (err) => onError?.(err),
    });
}

export async function fetchUsersByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return {};

  const results = await Promise.allSettled(
    unique.map((id) =>
      client.graphql({
        query: GetUser,
        variables: { id },
        authMode: "userPool",
      }),
    ),
  );

  const map = {};
  results.forEach((r) => {
    if (r.status === "fulfilled") {
      const u = r.value?.data?.getUser;
      if (u?.id) map[u.id] = u;
    }
  });

  return map;
}

export function buildParticipantId({ conversationId, userId }) {
  if (!conversationId || !userId) return null;
  return getConversationParticipantId(conversationId, userId);
}

export async function ensureParticipantExists({ conversationId, userId }) {
  const participantId = buildParticipantId({ conversationId, userId });
  if (!participantId) return null;

  try {
    const res = await client.graphql({
      query: GetConversationParticipant,
      variables: { id: participantId },
      authMode: "userPool",
    });

    const existing = res?.data?.getConversationParticipant;
    if (existing) return existing;
  } catch {}

  try {
    const created = await client.graphql({
      query: CreateConversationParticipant,
      variables: {
        input: {
          id: participantId,
          conversationId,
          userId,
          lastReadAt: null,
        },
      },
      authMode: "userPool",
    });

    return created?.data?.createConversationParticipant ?? null;
  } catch (e) {
    const msg = e?.errors?.[0]?.message || String(e);
    const alreadyExists =
      msg.includes("ConditionalCheckFailed") ||
      msg.toLowerCase().includes("conditional request failed");

    if (alreadyExists) return { id: participantId, conversationId, userId };

    throw e;
  }
}

export async function markConversationRead({ conversationId, userId }) {
  const participantId = buildParticipantId({ conversationId, userId });
  if (!participantId) return;

  const now = new Date().toISOString();
  await client.graphql({
    query: UpdateConversationParticipant,
    variables: { input: { id: participantId, lastReadAt: now } },
    authMode: "userPool",
  });
}

export async function ensureParticipantAndMarkRead({ conversationId, userId }) {
  if (!conversationId || !userId) return;
  await ensureParticipantExists({ conversationId, userId });
  await markConversationRead({ conversationId, userId });
}

export async function bumpConversationLastMessageAt(conversationId) {
  if (!conversationId) return;
  const now = new Date().toISOString();
  await client.graphql({
    query: UpdateConversationLastMessageAt,
    variables: { input: { id: conversationId, lastMessageAt: now } },
    authMode: "userPool",
  });
}

export async function sendTextMessage({
  conversationId,
  senderId,
  memberIds,
  body,
}) {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return null;

  const { data } = await client.graphql({
    query: CreateMessage,
    variables: {
      input: {
        conversationId,
        senderId,
        memberIds,
        type: "TEXT",
        body: trimmed,
      },
    },
    authMode: "userPool",
  });

  return data?.createMessage ?? null;
}

function extFromName(name = "") {
  const m = name.toLowerCase().match(/\.(\w+)$/);
  return m ? m[1] : "";
}

export function guessMessageTypeForFile({ mimeType, name } = {}) {
  const ext = extFromName(name);
  if (
    (mimeType || "").startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext)
  ) {
    return "IMAGE";
  }
  if (
    (mimeType || "").startsWith("video/") ||
    ["mp4", "mov", "m4v", "webm"].includes(ext)
  ) {
    return "VIDEO";
  }
  return "FILE";
}

export function buildUploadKey({ conversationId, filename }) {
  const safeName = (filename || "file").replace(/\s+/g, "_");
  return `uploads/${conversationId}/${Date.now()}-${safeName}`;
}

export async function uploadAttachment({
  conversationId,
  uri,
  name,
  mimeType,
}) {
  const key = buildUploadKey({ conversationId, filename: name });
  const blob = await fetch(uri).then((r) => r.blob());

  await uploadData({
    key,
    data: blob,
    options: { contentType: mimeType || undefined },
  }).result;

  return { key };
}

export async function sendMediaMessage({
  conversationId,
  senderId,
  memberIds,
  type,
  mediaKey,
  thumbnailKey,
}) {
  const { data } = await client.graphql({
    query: CreateMessage,
    variables: {
      input: {
        conversationId,
        senderId,
        memberIds,
        type,
        mediaKey,
        thumbnailKey: thumbnailKey || undefined,
      },
    },
    authMode: "userPool",
  });

  return data?.createMessage ?? null;
}

export async function getMediaUrl(mediaKey, { expiresIn = 300 } = {}) {
  if (!mediaKey) return null;
  const u = await getUrl({ key: mediaKey, options: { expiresIn } });
  return u?.url?.toString?.() || null;
}
