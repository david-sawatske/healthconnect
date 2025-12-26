import { generateClient } from "aws-amplify/api";

const client = generateClient();

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
      }
      nextToken
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
    }
  }
`;

const log = (...args) => console.log("[CONVO_UTIL]", ...args);

export async function ensureDirectConversation({
  currentUserId,
  memberIds,
  title,
}) {
  if (!currentUserId) throw new Error("Missing currentUserId");
  if (!memberIds || memberIds.length < 2) {
    throw new Error("memberIds must contain at least 2 user IDs");
  }

  const uniqueMemberIds = Array.from(new Set(memberIds));
  const isGroup = uniqueMemberIds.length > 2;

  log("ensureDirectConversation → checking for existing convo", {
    uniqueMemberIds,
    isGroup,
  });

  const listResp = await client.graphql({
    query: LIST_MY_CONVERSATIONS,
    variables: { sub: currentUserId, limit: 100, nextToken: null },
    authMode: "userPool",
  });

  const items = listResp?.data?.listConversations?.items || [];

  const existing = items.find((c) => {
    if (!c) return false;
    if (!Array.isArray(c.memberIds)) return false;
    if (c.memberIds.length !== uniqueMemberIds.length) return false;
    const match = uniqueMemberIds.every((id) => c.memberIds.includes(id));
    return match && c.isGroup === isGroup;
  });

  if (existing) {
    log("Found existing conversation", existing.id);
    return existing;
  }

  const finalTitle = title || (isGroup ? "Care Team Chat" : "Direct Chat");

  const input = {
    memberIds: uniqueMemberIds,
    createdBy: currentUserId,
    isGroup,
    title: finalTitle,
  };

  log("Creating new conversation", input);

  const createResp = await client.graphql({
    query: CREATE_CONVERSATION,
    variables: { input },
    authMode: "userPool",
  });

  const created = createResp?.data?.createConversation;
  if (!created) throw new Error("Failed to create conversation");

  log("Conversation created", created.id);
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

  const key = `CARE_TEAM:${patientId}:${providerId}`;
  const desiredMemberIds = Array.from(
    new Set([patientId, providerId, ...advocateIds].filter(Boolean)),
  );

  if (desiredMemberIds.length < 3) {
    throw new Error("Care team chat requires at least 3 members");
  }

  log("ensureCareTeamConversation → checking for existing care team", {
    key,
    desiredMemberIds,
  });

  const listResp = await client.graphql({
    query: LIST_MY_CONVERSATIONS,
    variables: { sub: currentUserId, limit: 100, nextToken: null },
    authMode: "userPool",
  });

  const items = listResp?.data?.listConversations?.items || [];

  const existing = items.find((c) => {
    if (!c?.isGroup) return false;
    if (!Array.isArray(c.memberIds)) return false;
    if (!c.memberIds.includes(patientId)) return false;
    if (!c.memberIds.includes(providerId)) return false;
    if (typeof c.title !== "string") return false;
    return c.title.startsWith(key);
  });

  if (existing) {
    const existingMembers = Array.from(new Set(existing.memberIds || []));
    const same =
      existingMembers.length === desiredMemberIds.length &&
      desiredMemberIds.every((id) => existingMembers.includes(id));

    if (!same) {
      log("Updating care team conversation membership", {
        id: existing.id,
        from: existingMembers,
        to: desiredMemberIds,
      });

      const updateResp = await client.graphql({
        query: UPDATE_CONVERSATION,
        variables: {
          input: {
            id: existing.id,
            memberIds: desiredMemberIds,
            isGroup: true,
          },
        },
        authMode: "userPool",
      });

      const updated = updateResp?.data?.updateConversation;
      if (updated) return updated;
    }

    log("Found existing care team conversation", existing.id);
    return existing;
  }

  const finalTitle = title ? `${key} • ${title}` : `${key} • Care Team`;

  const input = {
    memberIds: desiredMemberIds,
    createdBy: currentUserId,
    isGroup: true,
    title: finalTitle,
  };

  log("Creating new care team conversation", input);

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
