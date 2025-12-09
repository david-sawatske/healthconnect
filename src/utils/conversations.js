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
  const memberIds = [patientId, providerId, ...advocateIds.filter(Boolean)];

  const unique = Array.from(new Set(memberIds));

  if (unique.length < 3) {
    throw new Error("Care team chat needs at least 3 members");
  }

  return ensureDirectConversation({
    currentUserId,
    memberIds: unique,
    title: title || `Care Team: ${patientId}`,
  });
}
