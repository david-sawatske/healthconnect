import { generateClient } from "aws-amplify/api";
import { getConversationParticipant } from "../graphql/queries";
import { createConversationParticipant } from "../graphql/mutations";

const client = generateClient();

export async function ensureConversationParticipant({
  conversationId,
  userId,
}) {
  if (!conversationId || !userId) return null;

  const id = `${conversationId}:${userId}`;

  try {
    const res = await client.graphql({
      query: getConversationParticipant,
      variables: { id },
    });

    const existing = res?.data?.getConversationParticipant;
    if (existing) return existing;
  } catch (e) {
  }

  try {
    const created = await client.graphql({
      query: createConversationParticipant,
      variables: {
        input: {
          id,
          conversationId,
          userId,
          lastReadAt: null,
        },
      },
    });

    return created?.data?.createConversationParticipant ?? null;
  } catch (e) {
    const msg = e?.errors?.[0]?.message || String(e);
    const alreadyExists =
      msg.includes("ConditionalCheckFailed") ||
      msg.toLowerCase().includes("conditional request failed");

    if (alreadyExists) return { id, conversationId, userId };

    throw e;
  }
}
