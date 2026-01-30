/* Amplify Params - DO NOT EDIT
	AUTH_HEALTHCONNECT97A44150_USERPOOLID
	ENV
	REGION
Amplify Params - DO NOT EDIT */

const crypto = require("crypto");
const {
  DynamoDBClient,
  ScanCommand,
  BatchWriteItemCommand,
  PutItemCommand,
} = require("@aws-sdk/client-dynamodb");
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const ddb = new DynamoDBClient({ region: process.env.REGION });
const cognito = new CognitoIdentityProviderClient({
  region: process.env.REGION,
});
const USER_POOL_ID = process.env.AUTH_HEALTHCONNECT97A44150_USERPOOLID;

const TABLES = {
  User: process.env.TABLE_USER,
  Conversation: process.env.TABLE_CONVERSATION,
  Message: process.env.TABLE_MESSAGE,

  ConversationParticipant: process.env.TABLE_CONVERSATION_PARTICIPANT,
  ProviderPatient: process.env.TABLE_PROVIDER_PATIENT,
  AdvocateAssignment: process.env.TABLE_ADVOCATE_ASSIGNMENT,
  AdvocateInvite: process.env.TABLE_ADVOCATE_INVITE,
  CallSession: process.env.TABLE_CALL_SESSION,
  CallSignal: process.env.TABLE_CALL_SIGNAL,
};

const DEMO = {
  patientEmail: process.env.DEMO_PATIENT_EMAIL,
  providerEmail: process.env.DEMO_PROVIDER_EMAIL,
  advocateEmail: process.env.DEMO_ADVOCATE_EMAIL,
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

function getClaims(event) {
  const claims =
    event?.requestContext?.authorizer?.claims ||
    event?.requestContext?.authorizer?.jwt?.claims ||
    {};
  return claims;
}

function requireAdmin(event) {
  const claims = getClaims(event);

  const groupsRaw = claims["cognito:groups"];
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw
    : typeof groupsRaw === "string"
      ? groupsRaw.split(",").map((s) => s.trim())
      : [];

  const isAdmin = groups.includes("Admin");

  if (!isAdmin) {
    const sub = claims.sub || "unknown";
    const err = new Error(`Forbidden: user ${sub} is not in Admin group`);
    err.statusCode = 403;
    throw err;
  }
}

function uuid() {
  return crypto.randomUUID();
}
function nowIso() {
  return new Date().toISOString();
}
function minutesAgo(min) {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

async function scanAllIds(tableName) {
  if (!tableName) return [];
  const ids = [];
  let ExclusiveStartKey = undefined;

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "id",
        ExclusiveStartKey,
      }),
    );

    const items = res.Items || [];
    for (const it of items) {
      const obj = unmarshall(it);
      if (obj?.id) ids.push({ id: obj.id });
    }

    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return ids;
}

async function batchDelete(tableName, keys) {
  if (!tableName || !keys?.length) return 0;

  let deleted = 0;
  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);

    await ddb.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: chunk.map((k) => ({
            DeleteRequest: { Key: marshall(k) },
          })),
        },
      }),
    );

    deleted += chunk.length;
  }
  return deleted;
}

async function put(tableName, item) {
  if (!tableName) throw new Error("Missing tableName for put()");
  await ddb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    }),
  );
}

async function findSubByEmail(email) {
  const res = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${email}"`,
      Limit: 1,
    }),
  );

  const user = res.Users?.[0];
  if (!user) throw new Error(`Cognito user not found for email: ${email}`);

  const sub = user.Attributes?.find((a) => a.Name === "sub")?.Value;
  if (!sub) throw new Error(`Missing sub attribute for email: ${email}`);

  return sub;
}

function requireCoreEnv() {
  if (!USER_POOL_ID) throw new Error("Missing env AUTH_*_USERPOOLID");
  if (!DEMO.patientEmail || !DEMO.providerEmail || !DEMO.advocateEmail) {
    throw new Error("Missing one or more DEMO_*_EMAIL env vars");
  }
  if (!TABLES.User || !TABLES.Conversation || !TABLES.Message) {
    throw new Error(
      "Missing one or more core TABLE_* env vars (User/Conversation/Message)",
    );
  }
}

function requireExtraTablesForFullExperience() {
  const needed = [
    "ConversationParticipant",
    "ProviderPatient",
    "AdvocateAssignment",
  ];

  const missing = needed.filter((k) => !TABLES[k]);
  if (missing.length) {
    const err = new Error(
      `Missing env table(s): ${missing
        .map((k) => `TABLE_${k.toUpperCase()}`)
        .join(", ")}. Add these env vars to enable full reset/seed.`,
    );
    err.statusCode = 500;
    throw err;
  }
}

async function resetAll() {
  const order = [
    "CallSignal",
    "CallSession",
    "Message",
    "ConversationParticipant",
    "AdvocateInvite",
    "AdvocateAssignment",
    "ProviderPatient",
    "Conversation",
  ];

  const results = {};

  for (const model of order) {
    const table = TABLES[model];
    if (!table) {
      results[model] = { skipped: true, reason: "table env not set" };
      continue;
    }

    const keys = await scanAllIds(table);
    const deleted = await batchDelete(table, keys);
    results[model] = { deleted };
  }

  return results;
}

async function seedDemoWorld() {
  requireCoreEnv();
  requireExtraTablesForFullExperience();

  const [patientSub, providerSub, advocateSub] = await Promise.all([
    findSubByEmail(DEMO.patientEmail),
    findSubByEmail(DEMO.providerEmail),
    findSubByEmail(DEMO.advocateEmail),
  ]);

  await put(TABLES.User, {
    id: patientSub,
    email: DEMO.patientEmail,
    displayName: "Jordan Lee",
    role: "PATIENT",
  });

  await put(TABLES.User, {
    id: providerSub,
    email: DEMO.providerEmail,
    displayName: "Dr. Maya Patel",
    role: "PROVIDER",
  });

  await put(TABLES.User, {
    id: advocateSub,
    email: DEMO.advocateEmail,
    displayName: "Casey Morgan",
    role: "ADVOCATE",
  });

  const providerPatientId = uuid();
  await put(TABLES.ProviderPatient, {
    id: providerPatientId,
    providerId: providerSub,
    patientId: patientSub,
  });

  const assignmentId = uuid();
  await put(TABLES.AdvocateAssignment, {
    id: assignmentId,
    patientId: patientSub,
    providerId: providerSub,
    advocateId: advocateSub,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const careTeamConversationId = uuid();
  const pvConversationId = uuid();
  const apConversationId = uuid();

  await put(TABLES.Conversation, {
    id: careTeamConversationId,
    title: "Jordan Lee • Care Team",
    isGroup: true,
    memberIds: [patientSub, providerSub, advocateSub],
    createdBy: providerSub,
    lastMessageAt: minutesAgo(30),
    createdAt: minutesAgo(240),
  });

  await put(TABLES.Conversation, {
    id: pvConversationId,
    title: "Jordan Lee ↔ Dr. Maya Patel",
    isGroup: false,
    memberIds: [patientSub, providerSub],
    createdBy: patientSub,
    lastMessageAt: minutesAgo(175),
    createdAt: minutesAgo(200),
  });

  await put(TABLES.Conversation, {
    id: apConversationId,
    title: "Casey Morgan ↔ Jordan Lee",
    isGroup: false,
    memberIds: [patientSub, advocateSub],
    createdBy: advocateSub,
    lastMessageAt: minutesAgo(30),
    createdAt: minutesAgo(60),
  });

  const mkCP = (userId, conversationId, lastReadAt) => ({
    id: uuid(),
    userId,
    conversationId,
    lastReadAt,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const cps = [
    mkCP(patientSub, careTeamConversationId, minutesAgo(40)),
    mkCP(providerSub, careTeamConversationId, minutesAgo(35)),
    mkCP(advocateSub, careTeamConversationId, minutesAgo(33)),

    mkCP(patientSub, pvConversationId, minutesAgo(170)),
    mkCP(providerSub, pvConversationId, minutesAgo(172)),

    mkCP(advocateSub, apConversationId, minutesAgo(25)),
    mkCP(patientSub, apConversationId, minutesAgo(90)),
  ];

  for (const cp of cps) await put(TABLES.ConversationParticipant, cp);

  const mkMsg = (
    conversationId,
    senderId,
    memberIds,
    type,
    body,
    createdAt,
  ) => ({
    id: uuid(),
    conversationId,
    senderId,
    memberIds,
    type,
    body,
    createdAt,
  });

  const msgs = [
    mkMsg(
      careTeamConversationId,
      providerSub,
      [patientSub, providerSub, advocateSub],
      "TEXT",
      "Hi Jordan — checking in after your last appointment. How are symptoms today?",
      minutesAgo(240),
    ),
    mkMsg(
      careTeamConversationId,
      patientSub,
      [patientSub, providerSub, advocateSub],
      "TEXT",
      "A bit better overall, but still getting headaches in the evening.",
      minutesAgo(235),
    ),
    mkMsg(
      careTeamConversationId,
      advocateSub,
      [patientSub, providerSub, advocateSub],
      "TEXT",
      "Thanks — can you keep a quick symptom log this week? Even 1–2 notes per day helps.",
      minutesAgo(230),
    ),

    mkMsg(
      pvConversationId,
      patientSub,
      [patientSub, providerSub],
      "TEXT",
      "Quick question: should I take the meds with food?",
      minutesAgo(180),
    ),
    mkMsg(
      pvConversationId,
      providerSub,
      [patientSub, providerSub],
      "TEXT",
      "Yes — with food is ideal. If nausea continues, message me here and we can adjust.",
      minutesAgo(175),
    ),

    mkMsg(
      apConversationId,
      advocateSub,
      [patientSub, advocateSub],
      "TEXT",
      "I can help schedule your follow-up. Do mornings or afternoons usually work better?",
      minutesAgo(30),
    ),
  ];

  for (const msg of msgs) await put(TABLES.Message, msg);

  return {
    demoSubs: { patientSub, providerSub, advocateSub },
    created: {
      users: 3,
      providerPatients: 1,
      advocateAssignments: 1,
      conversations: 3,
      conversationParticipants: cps.length,
      messages: msgs.length,
    },
    ids: {
      providerPatientId,
      assignmentId,
      careTeamConversationId,
      pvConversationId,
      apConversationId,
    },
  };
}

exports.handler = async (event) => {
  try {
    requireAdmin(event);

    console.log("[adminSeedData] EVENT:", JSON.stringify(event));

    const body = event?.body ? JSON.parse(event.body) : {};
    const mode = body?.mode || "resetAndReseed";

    if (mode === "reset") {
      const resetCounts = await resetAll();
      return json(200, { ok: true, mode, resetCounts });
    }

    if (mode === "seed") {
      const seeded = await seedDemoWorld();
      return json(200, { ok: true, mode, seeded });
    }

    if (mode === "resetAndReseed") {
      const resetCounts = await resetAll();
      const seeded = await seedDemoWorld();
      return json(200, { ok: true, mode, resetCounts, seeded });
    }

    return json(400, { ok: false, error: `Unknown mode: ${mode}` });
  } catch (e) {
    console.log("[adminSeedData] ERROR:", e);
    return json(e.statusCode || 500, {
      ok: false,
      error: e.message || "Error",
    });
  }
};
