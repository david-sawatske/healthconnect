import { getGraphqlClient } from "../../services/amplify/client";
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

async function listAllMyConversations(currentUserId, { limit = 100 } = {}) {
  let nextToken = null;
  const all = [];

  do {
    const resp = await client.graphql({
      query: LIST_MY_CONVERSATIONS,
      variables: { sub: currentUserId, limit, nextToken },
      authMode: "userPool",
    });

    const page = resp?.data?.listConversations;
    const items = page?.items || [];
    all.push(...items);

    nextToken = page?.nextToken ?? null;
  } while (nextToken);

  return all;
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

function dmIdFor(a, b) {
  const [minId, maxId] = [a, b].sort();
  return `DM:${minId}:${maxId}`;
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
    const deterministicId = dmIdFor(desired[0], desired[1]);

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

  const items = await listAllMyConversations(currentUserId);
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

  const careTeamId = `CARE_TEAM:${patientId}:${providerId}`;

  const desiredMemberIds = normalizeSet([
    patientId,
    providerId,
    ...advocateIds,
  ]);

  if (desiredMemberIds.length < 3) {
    throw new Error("Care team chat requires at least 3 members");
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

  const items = await listAllMyConversations(currentUserId);

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

  const prefix = `CARE_TEAM:${patientId}:${providerId}`;
  const byTitlePrefix = candidates.find(
    (c) => typeof c.title === "string" && c.title.startsWith(prefix),
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
