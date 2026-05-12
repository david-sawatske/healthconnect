/* Amplify Params - DO NOT EDIT
  AUTH_HEALTHCONNECT97A44150_USERPOOLID
  ENV
  REGION
Amplify Params - DO NOT EDIT */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const cognito = new CognitoIdentityProviderClient({
  region: process.env.REGION,
});

const {
  AUTH_HEALTHCONNECT97A44150_USERPOOLID,
  TABLE_USER,
  TABLE_PROVIDER_PATIENT,
  TABLE_CONVERSATION,
  TABLE_CONVERSATION_PARTICIPANT,
} = process.env;

const VALID_ROLES = new Set(["ADMIN", "PATIENT", "PROVIDER", "ADVOCATE"]);

requireEnv(
  "AUTH_HEALTHCONNECT97A44150_USERPOOLID",
  AUTH_HEALTHCONNECT97A44150_USERPOOLID,
);
requireEnv("TABLE_USER", TABLE_USER);
requireEnv("TABLE_PROVIDER_PATIENT", TABLE_PROVIDER_PATIENT);
requireEnv("TABLE_CONVERSATION", TABLE_CONVERSATION);
requireEnv("TABLE_CONVERSATION_PARTICIPANT", TABLE_CONVERSATION_PARTICIPANT);

exports.handler = async (event) => {
  console.log("[ADMIN_MANAGE_USERS] event.raw =", JSON.stringify(event));

  try {
    requireAdminCaller(event);

    const body = parseBody(event);
    const action = requireNonEmptyString("action", body.action);

    if (action === "CREATE_USER") {
      const result = await createUser(body);
      return json(200, result);
    }

    if (action === "CONNECT_PATIENT_PROVIDER") {
      const result = await connectPatientProvider(body);
      return json(200, result);
    }

    return json(400, {
      ok: false,
      error: `Unsupported action: ${action}`,
    });
  } catch (e) {
    console.error("[ADMIN_MANAGE_USERS] ERROR", e);

    return json(e.statusCode || 500, {
      ok: false,
      error: e?.message ?? String(e),
    });
  }
};

async function createUser(body) {
  const userInput = body?.user || {};

  const email = normalizeEmail(userInput.email);
  const displayName = requireNonEmptyString(
    "user.name",
    userInput.name || userInput.displayName,
  );
  const role = requireValidRole(userInput.role);
  const now = new Date().toISOString();

  const cognitoResult = await ensureCognitoUserByEmail({
    email,
    displayName,
  });

  const userId = cognitoResult.sub;

  const existingProfile = await ddb.send(
    new GetCommand({
      TableName: TABLE_USER,
      Key: { id: userId },
    }),
  );

  const existingUser = existingProfile.Item;

  const user = {
    id: userId,
    email,
    displayName,
    role,
    avatarKey: existingUser?.avatarKey ?? null,
    createdAt: existingUser?.createdAt ?? now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_USER,
      Item: user,
    }),
  );

  return {
    ok: true,
    action: "CREATE_USER",
    message: "User created successfully.",
    cognitoUserCreated: cognitoResult.created,
    userProfileCreated: !existingUser,
    tableUserConfigured: true,
    cognitoUser: {
      sub: cognitoResult.sub,
      username: cognitoResult.username,
      email,
      status: cognitoResult.status,
      enabled: cognitoResult.enabled,
    },
    user,
  };
}

async function connectPatientProvider(body) {
  const patientId = requireNonEmptyString("patientId", body.patientId);
  const providerId = requireNonEmptyString("providerId", body.providerId);

  if (patientId === providerId) {
    throw httpError(400, "patientId and providerId must be different.");
  }

  const now = new Date().toISOString();

  const patient = await getUserByIdOrThrow(patientId, "PATIENT");
  const provider = await getUserByIdOrThrow(providerId, "PROVIDER");

  const providerPatient = await ensureProviderPatient({
    patientId,
    providerId,
    now,
  });

  const conversation = await ensureCareTeamConversation({
    patientId,
    providerId,
    now,
  });

  const patientParticipant = await ensureConversationParticipant({
    conversationId: conversation.id,
    userId: patientId,
    now,
  });

  const providerParticipant = await ensureConversationParticipant({
    conversationId: conversation.id,
    userId: providerId,
    now,
  });

  return {
    ok: true,
    action: "CONNECT_PATIENT_PROVIDER",
    message: "Patient connected to provider successfully.",
    patient: toPublicUser(patient),
    provider: toPublicUser(provider),
    providerPatient: {
      id: providerPatient.id,
      created: providerPatient.created,
    },
    conversation: {
      id: conversation.id,
      created: conversation.created,
      title: conversation.item.title ?? null,
      isGroup: conversation.item.isGroup,
      memberIds: conversation.item.memberIds,
    },
    participants: {
      patient: {
        id: patientParticipant.id,
        created: patientParticipant.created,
      },
      provider: {
        id: providerParticipant.id,
        created: providerParticipant.created,
      },
    },
  };
}

async function ensureCognitoUserByEmail({ email, displayName }) {
  const existing = await findCognitoUserByEmail(email);

  if (existing) {
    return {
      created: false,
      username: existing.username,
      sub: existing.sub,
      status: existing.status,
      enabled: existing.enabled,
    };
  }

  const createRes = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: AUTH_HEALTHCONNECT97A44150_USERPOOLID,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: displayName },
      ],
    }),
  );

  const createdUser = createRes.User;
  const username = createdUser?.Username;

  if (!username) {
    throw httpError(500, "Cognito user was created but no username was returned.");
  }

  const fullUser = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: AUTH_HEALTHCONNECT97A44150_USERPOOLID,
      Username: username,
    }),
  );

  const sub = getCognitoAttribute(fullUser.UserAttributes, "sub");

  if (!sub) {
    throw httpError(500, "Cognito user was created but no sub was found.");
  }

  return {
    created: true,
    username,
    sub,
    status: fullUser.UserStatus,
    enabled: fullUser.Enabled,
  };
}

async function findCognitoUserByEmail(email) {
  const res = await cognito.send(
    new ListUsersCommand({
      UserPoolId: AUTH_HEALTHCONNECT97A44150_USERPOOLID,
      Filter: `email = "${email}"`,
      Limit: 1,
    }),
  );

  const user = (res.Users || [])[0];

  if (!user) return null;

  const sub = getCognitoAttribute(user.Attributes, "sub");

  if (!sub) {
    throw httpError(500, `Existing Cognito user for ${email} has no sub.`);
  }

  return {
    username: user.Username,
    sub,
    status: user.UserStatus,
    enabled: user.Enabled,
  };
}

async function getUserByIdOrThrow(userId, expectedRole) {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_USER,
      Key: { id: userId },
    }),
  );

  const user = res.Item;

  if (!user) {
    throw httpError(404, `User not found: ${userId}`);
  }

  if (user.role !== expectedRole) {
    throw httpError(
      400,
      `Expected user ${userId} to have role ${expectedRole}, but found ${
        user.role || "UNKNOWN"
      }.`,
    );
  }

  return user;
}

async function ensureProviderPatient({ patientId, providerId, now }) {
  const id = providerPatientId({ patientId, providerId });

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_PROVIDER_PATIENT,
      Key: { id },
    }),
  );

  if (existing.Item) {
    return {
      id,
      created: false,
      item: existing.Item,
    };
  }

  const item = {
    id,
    providerId,
    patientId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_PROVIDER_PATIENT,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );

    return {
      id,
      created: true,
      item,
    };
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;

    const reread = await ddb.send(
      new GetCommand({
        TableName: TABLE_PROVIDER_PATIENT,
        Key: { id },
      }),
    );

    return {
      id,
      created: false,
      item: reread.Item,
    };
  }
}

async function ensureCareTeamConversation({ patientId, providerId, now }) {
  const id = careTeamConversationId({ patientId, providerId });

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_CONVERSATION,
      Key: { id },
    }),
  );

  if (existing.Item) {
    const normalized = await ensureConversationHasMembers({
      conversation: existing.Item,
      requiredMemberIds: [patientId, providerId],
      now,
    });

    return {
      id,
      created: false,
      item: normalized,
    };
  }

  const item = {
    id,
    title: "Care Team Chat",
    isGroup: true,
    memberIds: [patientId, providerId],
    createdBy: providerId,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_CONVERSATION,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );

    return {
      id,
      created: true,
      item,
    };
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;

    const reread = await ddb.send(
      new GetCommand({
        TableName: TABLE_CONVERSATION,
        Key: { id },
      }),
    );

    const normalized = await ensureConversationHasMembers({
      conversation: reread.Item,
      requiredMemberIds: [patientId, providerId],
      now,
    });

    return {
      id,
      created: false,
      item: normalized,
    };
  }
}

async function ensureConversationHasMembers({
                                              conversation,
                                              requiredMemberIds,
                                              now,
                                            }) {
  if (!conversation) {
    throw httpError(500, "Conversation could not be loaded after creation race.");
  }

  const existingMemberIds = Array.isArray(conversation.memberIds)
    ? conversation.memberIds
    : [];

  const nextMemberIds = uniqueStrings([
    ...existingMemberIds,
    ...requiredMemberIds,
  ]);

  const alreadyHasAllMembers =
    nextMemberIds.length === existingMemberIds.length &&
    nextMemberIds.every((id) => existingMemberIds.includes(id));

  if (alreadyHasAllMembers) {
    return conversation;
  }

  const updated = {
    ...conversation,
    memberIds: nextMemberIds,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_CONVERSATION,
      Item: updated,
    }),
  );

  return updated;
}

async function ensureConversationParticipant({ conversationId, userId, now }) {
  const id = conversationParticipantId({ conversationId, userId });

  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE_CONVERSATION_PARTICIPANT,
      Key: { id },
    }),
  );

  if (existing.Item) {
    return {
      id,
      created: false,
      item: existing.Item,
    };
  }

  const item = {
    id,
    userId,
    conversationId,
    lastReadAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_CONVERSATION_PARTICIPANT,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );

    return {
      id,
      created: true,
      item,
    };
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;

    const reread = await ddb.send(
      new GetCommand({
        TableName: TABLE_CONVERSATION_PARTICIPANT,
        Key: { id },
      }),
    );

    return {
      id,
      created: false,
      item: reread.Item,
    };
  }
}

function requireAdminCaller(event) {
  const identity = event?.requestContext?.identity || {};
  const userArn = identity.userArn || identity.arn || "";
  const caller = identity.caller || "";
  const user = identity.user || "";

  const rawIdentity = JSON.stringify({
    userArn,
    caller,
    user,
  });

  const isAdminGroupRole =
    rawIdentity.includes(":assumed-role/AdminGroupRole/") ||
    rawIdentity.includes(":role/AdminGroupRole") ||
    rawIdentity.includes("AdminGroupRole");

  if (!isAdminGroupRole) {
    throw httpError(403, "Admin access required.");
  }
}

function parseBody(event) {
  if (!event?.body) return {};

  if (typeof event.body === "string") {
    try {
      return JSON.parse(event.body);
    } catch {
      throw httpError(400, "Request body must be valid JSON.");
    }
  }

  return event.body;
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requireNonEmptyString(name, value) {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${name} is required.`);
  }

  return value.trim();
}

function normalizeEmail(value) {
  const email = requireNonEmptyString("email", value).toLowerCase();

  if (!email.includes("@")) {
    throw httpError(400, "email must be a valid email address.");
  }

  return email;
}

function requireValidRole(value) {
  const role = requireNonEmptyString("role", value).toUpperCase();

  if (!VALID_ROLES.has(role)) {
    throw httpError(
      400,
      `role must be one of: ${Array.from(VALID_ROLES).join(", ")}.`,
    );
  }

  return role;
}

function getCognitoAttribute(attributes = [], name) {
  return attributes.find((attr) => attr.Name === name)?.Value || null;
}

function careTeamConversationId({ patientId, providerId }) {
  return `CARE_TEAM:${patientId}:${providerId}`;
}

function providerPatientId({ providerId, patientId }) {
  return `PP:${providerId}:${patientId}`;
}

function conversationParticipantId({ conversationId, userId }) {
  return `${conversationId}:${userId}`;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values.filter((value) => typeof value === "string" && value.trim()),
    ),
  );
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
    },
    body: JSON.stringify(obj),
  };
}
