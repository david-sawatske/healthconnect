import { getGraphqlClient } from "../../services/amplify/client";
import {
  getCareTeamConversationId,
  getDirectMessageConversationId,
} from "../../utils/ids";

const client = getGraphqlClient();

const LIST_MY_CONVERSATIONS = /* GraphQL */ `
  query ListMyConversations($sub: String!, $limit: Int, $nextToken: String) {
    listConversations(
      filter: { memberIds: { contains: $sub } }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        title
        memberIds
        isGroup
        createdBy
        createdAt
        updatedAt
        lastMessageAt
      }
      nextToken
    }
  }
`;

const GET_CONVERSATION = /* GraphQL */ `
  query GetConversation($id: ID!) {
    getConversation(id: $id) {
      id
      title
      memberIds
      isGroup
      createdBy
      createdAt
      updatedAt
      lastMessageAt
    }
  }
`;

const CREATE_CONVERSATION = /* GraphQL */ `
  mutation CreateConversation($input: CreateConversationInput!) {
    createConversation(input: $input) {
      id
      title
      memberIds
      isGroup
      createdBy
      createdAt
      updatedAt
      lastMessageAt
    }
  }
`;

const UPDATE_CONVERSATION = /* GraphQL */ `
  mutation UpdateConversation($input: UpdateConversationInput!) {
    updateConversation(input: $input) {
      id
      title
      memberIds
      isGroup
      createdBy
      createdAt
      updatedAt
      lastMessageAt
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

const LAST_MESSAGE_BY_CONVERSATION = /* GraphQL */ `
  query LastMessageByConversation($conversationId: ID!, $limit: Int) {
    messagesByConversation(
      conversationId: $conversationId
      sortDirection: DESC
      limit: $limit
    ) {
      items {
        id
        type
        body
        senderId
        createdAt
      }
    }
  }
`;

const DEMO_LOGS_ENABLED =
  __DEV__ ||
  String(process.env.EXPO_PUBLIC_DEMO_LOGIN).toLowerCase() === "true";

const log = (...args) => {
  if (!DEMO_LOGS_ENABLED) return;
  console.log("[CONVO_UTIL]", ...args);
};

const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
const normalizeSet = (arr) => uniq(arr).sort();

const sameSet = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export function getLastActivityTs(conversation) {
  return (
    conversation?.lastMessageAt ||
    conversation?.updatedAt ||
    conversation?.createdAt ||
    0
  );
}

export function sortConversationsByLastActivity(items = []) {
  return [...items].sort((a, b) => {
    const at = new Date(getLastActivityTs(a)).getTime();
    const bt = new Date(getLastActivityTs(b)).getTime();
    return bt - at;
  });
}

export async function listConversationsForUser(
  userId,
  { limit = 20, nextToken = null } = {},
) {
  if (!userId) return { items: [], nextToken: null };

  const resp = await client.graphql({
    query: LIST_MY_CONVERSATIONS,
    variables: { sub: userId, limit, nextToken },
    authMode: "userPool",
  });

  const page = resp?.data?.listConversations;

  return {
    items: page?.items || [],
    nextToken: page?.nextToken || null,
  };
}

export async function listAllConversationsForUser(
  userId,
  { limit = 100 } = {},
) {
  if (!userId) return [];

  let nextToken = null;
  const all = [];

  do {
    const page = await listConversationsForUser(userId, {
      limit,
      nextToken,
    });

    all.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken);

  return all;
}

export async function listConversationReadStateForUser(
  userId,
  { limit = 200 } = {},
) {
  if (!userId) return {};

  let nextToken = null;
  const map = {};

  do {
    const resp = await client.graphql({
      query: CONVERSATION_PARTICIPANTS_BY_USER,
      variables: {
        userId,
        limit,
        nextToken,
      },
      authMode: "userPool",
    });

    const result = resp?.data?.conversationParticipantsByUser;
    const items = result?.items || [];

    items.forEach((participant) => {
      if (participant?.conversationId) {
        map[participant.conversationId] = participant.lastReadAt || null;
      }
    });

    nextToken = result?.nextToken || null;
  } while (nextToken);

  return map;
}

export async function getLastNonSystemMessageForConversation(
  conversationId,
  { limit = 10 } = {},
) {
  if (!conversationId) return null;

  const resp = await client.graphql({
    query: LAST_MESSAGE_BY_CONVERSATION,
    variables: {
      conversationId,
      limit,
    },
    authMode: "userPool",
  });

  const items = resp?.data?.messagesByConversation?.items || [];
  return items.find((message) => message?.type !== "SYSTEM") || null;
}

async function tryGetConversation(id) {
  try {
    const resp = await client.graphql({
      query: GET_CONVERSATION,
      variables: { id },
      authMode: "userPool",
    });
    return resp?.data?.getConversation ?? null;
  } catch {
    return null;
  }
}

export async function ensureDirectConversation({
  currentUserId,
  memberIds,
  title,
}) {
  if (!currentUserId) throw new Error("Missing currentUserId");
  if (!memberIds || memberIds.length < 2) {
    throw new Error("memberIds must contain at least 2 user IDs");
  }

  const uniqueMemberIds = uniq(memberIds);
  const isGroup = uniqueMemberIds.length > 2;

  if (uniqueMemberIds.length === 2) {
    const desired = normalizeSet(uniqueMemberIds);
    const deterministicId = getDirectMessageConversationId(
      desired[0],
      desired[1],
    );

    log("ensureDirectConversation (DM) → getConversation", {
      deterministicId,
      desiredMemberIds: desired,
    });

    const existingById = await tryGetConversation(deterministicId);
    if (existingById) {
      const existingMembers = normalizeSet(existingById.memberIds);
      if (!sameSet(existingMembers, desired)) {
        log("DM exists but memberIds mismatch — fixing", {
          id: deterministicId,
          from: existingMembers,
          to: desired,
        });

        const updateResp = await client.graphql({
          query: UPDATE_CONVERSATION,
          variables: {
            input: { id: deterministicId, memberIds: desired, isGroup: false },
          },
          authMode: "userPool",
        });

        const updated = updateResp?.data?.updateConversation;
        if (updated) return updated;
      }

      return existingById;
    }

    const finalTitle = title || "Direct Chat";
    const input = {
      id: deterministicId,
      memberIds: desired,
      createdBy: currentUserId,
      isGroup: false,
      title: finalTitle,
    };

    log("Creating new DM conversation", input);

    const createResp = await client.graphql({
      query: CREATE_CONVERSATION,
      variables: { input },
      authMode: "userPool",
    });

    const created = createResp?.data?.createConversation;
    if (!created) throw new Error("Failed to create DM conversation");

    log("DM conversation created", created.id);
    return created;
  }

  log("ensureDirectConversation (group) → checking for existing convo", {
    uniqueMemberIds,
    isGroup,
  });

  const items = await listAllConversationsForUser(currentUserId);
  const desired = normalizeSet(uniqueMemberIds);

  const existing = items.find((c) => {
    if (!c) return false;
    if (!Array.isArray(c.memberIds)) return false;
    if (c.isGroup !== isGroup) return false;
    return sameSet(normalizeSet(c.memberIds), desired);
  });

  if (existing) {
    log("Found existing conversation", existing.id);
    return existing;
  }

  const finalTitle = title || "Group Chat";
  const input = {
    memberIds: uniqueMemberIds,
    createdBy: currentUserId,
    isGroup,
    title: finalTitle,
  };

  log("Creating new group conversation", input);

  const createResp = await client.graphql({
    query: CREATE_CONVERSATION,
    variables: { input },
    authMode: "userPool",
  });

  const created = createResp?.data?.createConversation;
  if (!created) throw new Error("Failed to create conversation");

  log("Group conversation created", created.id);
  return created;
}

export async function ensureCareTeamConversation({
  currentUserId,
  patientId,
  providerId,
  advocateIds = [],
  title,
}) {
  if (!currentUserId) throw new Error("Missing currentUserId");
  if (!patientId) throw new Error("Missing patientId");
  if (!providerId) throw new Error("Missing providerId");

  const careTeamId = getCareTeamConversationId(patientId, providerId);

  const desiredMemberIds = normalizeSet([
    patientId,
    providerId,
    ...advocateIds,
  ]);

  if (desiredMemberIds.length < 2) {
    throw new Error("Care team chat requires at least patient and provider");
  }

  log("ensureCareTeamConversation → desired", {
    careTeamId,
    desiredMemberIds,
  });

  const byId = await tryGetConversation(careTeamId);
  if (byId) {
    const existingMembers = normalizeSet(byId.memberIds);
    if (!sameSet(existingMembers, desiredMemberIds)) {
      log("Updating care team membership (byId)", {
        id: byId.id,
        from: existingMembers,
        to: desiredMemberIds,
      });

      const updateResp = await client.graphql({
        query: UPDATE_CONVERSATION,
        variables: {
          input: { id: byId.id, memberIds: desiredMemberIds, isGroup: true },
        },
        authMode: "userPool",
      });

      const updated = updateResp?.data?.updateConversation;
      if (updated) return updated;
    }

    return byId;
  }

  const items = await listAllConversationsForUser(currentUserId);

  const candidates = (items || []).filter((c) => {
    if (!c?.isGroup) return false;
    if (!Array.isArray(c.memberIds)) return false;
    return c.memberIds.includes(patientId) && c.memberIds.includes(providerId);
  });

  const exact = candidates.find((c) =>
    sameSet(normalizeSet(c.memberIds), desiredMemberIds),
  );

  if (exact) {
    log("Found care team by exact member set", exact.id);
    return exact;
  }

  const byTitlePrefix = candidates.find(
    (c) => typeof c.title === "string" && c.title.startsWith(careTeamId),
  );

  if (byTitlePrefix) {
    log("Found care team by title prefix fallback", byTitlePrefix.id);
    return byTitlePrefix;
  }

  const finalTitle = title
    ? `Care Team • ${title}`
    : `Care Team • ${patientId}`;

  const input = {
    id: careTeamId,
    memberIds: desiredMemberIds,
    createdBy: currentUserId,
    isGroup: true,
    title: finalTitle,
  };

  log("Creating new canonical care team conversation", input);

  const createResp = await client.graphql({
    query: CREATE_CONVERSATION,
    variables: { input },
    authMode: "userPool",
  });

  const created = createResp?.data?.createConversation;
  if (!created) throw new Error("Failed to create care team conversation");

  log("Care team conversation created", created.id);
  return created;
}
