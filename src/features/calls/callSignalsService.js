import { getGraphqlClient } from "../../services/amplify/client";

const client = getGraphqlClient();

const CREATE_CALL_SESSION = /* GraphQL */ `
  mutation CreateCallSession($input: CreateCallSessionInput!) {
    createCallSession(input: $input) {
      id
      conversationId
      participantIds
      createdBy
      status
      startedAt
      createdAt
    }
  }
`;

const UPDATE_CALL_SESSION = /* GraphQL */ `
  mutation UpdateCallSession($input: UpdateCallSessionInput!) {
    updateCallSession(input: $input) {
      id
      status
      startedAt
      endedAt
      updatedAt
    }
  }
`;

const GET_CALL_SESSION = /* GraphQL */ `
  query GetCallSession($id: ID!) {
    getCallSession(id: $id) {
      id
      status
      startedAt
      endedAt
      updatedAt
    }
  }
`;

const CREATE_CALL_SIGNAL = /* GraphQL */ `
  mutation CreateCallSignal($input: CreateCallSignalInput!) {
    createCallSignal(input: $input) {
      id
      conversationId
      callSessionId
      senderId
      type
      payload
      createdAt
    }
  }
`;

const ON_SIGNAL = /* GraphQL */ `
  subscription OnSignal($conversationId: ID!) {
    onSignal(conversationId: $conversationId) {
      id
      conversationId
      callSessionId
      senderId
      type
      payload
      createdAt
    }
  }
`;

const CREATE_MESSAGE = /* GraphQL */ `
  mutation CreateMessage($input: CreateMessageInput!) {
    createMessage(input: $input) {
      id
    }
  }
`;

export async function createCallSession({
  conversationId,
  participantIds,
  createdBy,
  status = "RINGING",
  startedAt,
}) {
  const res = await client.graphql({
    query: CREATE_CALL_SESSION,
    variables: {
      input: {
        conversationId,
        participantIds,
        createdBy,
        status,
        startedAt,
      },
    },
    authMode: "userPool",
  });

  return res?.data?.createCallSession ?? null;
}

export async function updateCallSession({ id, status, startedAt, endedAt }) {
  if (!id) return null;

  const input = {
    id,
    ...(status ? { status } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
  };

  const res = await client.graphql({
    query: UPDATE_CALL_SESSION,
    variables: { input },
    authMode: "userPool",
  });

  return res?.data?.updateCallSession ?? null;
}

export async function getCallSession(id) {
  if (!id) return null;
  const res = await client.graphql({
    query: GET_CALL_SESSION,
    variables: { id },
    authMode: "userPool",
  });
  return res?.data?.getCallSession ?? null;
}

export async function createCallSignal({
  conversationId,
  callSessionId,
  senderId,
  type,
  payload,
}) {
  if (!conversationId || !callSessionId || !senderId || !type) return null;

  const encoded =
    payload == null
      ? "{}"
      : typeof payload === "string"
        ? payload
        : JSON.stringify(payload);

  const res = await client.graphql({
    query: CREATE_CALL_SIGNAL,
    variables: {
      input: {
        conversationId,
        callSessionId,
        senderId,
        type,
        payload: encoded,
      },
    },
    authMode: "userPool",
  });

  return res?.data?.createCallSignal ?? null;
}

export function subscribeToSignals({ conversationId, onSignal, onError }) {
  if (!conversationId) return null;

  return client
    .graphql({
      query: ON_SIGNAL,
      variables: { conversationId },
      authMode: "userPool",
    })
    .subscribe({
      next: ({ data }) => onSignal?.(data?.onSignal ?? null),
      error: (err) => onError?.(err),
    });
}

export async function postCallEndedSystemMessage({
  conversationId,
  senderId,
  memberIds,
  body,
}) {
  if (!conversationId || !senderId || !Array.isArray(memberIds) || !body)
    return;

  await client.graphql({
    query: CREATE_MESSAGE,
    variables: {
      input: {
        conversationId,
        senderId,
        memberIds,
        type: "SYSTEM",
        body,
      },
    },
    authMode: "userPool",
  });
}

export async function declineIncomingCall({
  conversationId,
  callSessionId,
  senderId,
  memberIds = [],
  reason = "declined",
}) {
  if (!conversationId || !callSessionId || !senderId) return;

  await createCallSignal({
    conversationId,
    callSessionId,
    senderId,
    type: "BYE",
    payload: { reason, at: Date.now() },
  });

  await updateCallSession({
    id: callSessionId,
    status: "ENDED",
    endedAt: new Date().toISOString(),
  });

  const visibleToAll = Array.from(new Set((memberIds || []).filter(Boolean)));

  if (visibleToAll.length > 0) {
    await postCallEndedSystemMessage({
      conversationId,
      senderId,
      memberIds: visibleToAll,
      body: `📞 Call declined • ${new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`,
    });
  }
}
