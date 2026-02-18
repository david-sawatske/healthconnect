import { getGraphqlClient } from "../../services/amplify/client";

const client = getGraphqlClient();

const CREATE_CALL_SIGNAL = /* GraphQL */ `
  mutation CreateCallSignal($input: CreateCallSignalInput!) {
    createCallSignal(input: $input) {
      id
    }
  }
`;

const UPDATE_CALL_SESSION = /* GraphQL */ `
  mutation UpdateCallSession($input: UpdateCallSessionInput!) {
    updateCallSession(input: $input) {
      id
    }
  }
`;

export async function declineIncomingCall({
  conversationId,
  callSessionId,
  senderId,
  reason = "declined",
}) {
  if (!conversationId || !callSessionId || !senderId) return;

  await client.graphql({
    query: CREATE_CALL_SIGNAL,
    variables: {
      input: {
        conversationId,
        callSessionId,
        senderId,
        type: "BYE",
        payload: JSON.stringify({ reason, at: Date.now() }),
      },
    },
    authMode: "userPool",
  });

  await client.graphql({
    query: UPDATE_CALL_SESSION,
    variables: {
      input: {
        id: callSessionId,
        status: "ENDED",
        endedAt: new Date().toISOString(),
      },
    },
    authMode: "userPool",
  });
}
