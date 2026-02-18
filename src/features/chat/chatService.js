import { getGraphqlClient } from "../../services/amplify/client";

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
