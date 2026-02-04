/* Amplify Params - DO NOT EDIT
  AUTH_HEALTHCONNECT97A44150_USERPOOLID
  ENV
  REGION
Amplify Params - DO NOT EDIT */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  CognitoIdentityProviderClient,
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
  TABLE_ADVOCATE_ASSIGNMENT,
  TABLE_CONVERSATION,
  TABLE_CONVERSATION_PARTICIPANT,
  TABLE_MESSAGE,
} = process.env;

exports.handler = async (event) => {
  console.log("[SEED_BASIC] event.raw =", JSON.stringify(event));
  console.log("[SEED_BASIC] env.REGION =", process.env.REGION);
  console.log("[SEED_BASIC] USERPOOL =", AUTH_HEALTHCONNECT97A44150_USERPOOLID);

  try {
    const body =
      typeof event.body === "string"
        ? JSON.parse(event.body)
        : event.body || {};
    const { mode, scenario } = body;

    if (mode !== "seed")
      return json(400, { ok: false, error: "Only mode=seed" });
    if (scenario !== "basic")
      return json(400, { ok: false, error: "Only scenario=basic" });

    const missing = [
      !AUTH_HEALTHCONNECT97A44150_USERPOOLID && "AUTH_*_USERPOOLID",
      !TABLE_USER && "TABLE_USER",
      !TABLE_PROVIDER_PATIENT && "TABLE_PROVIDER_PATIENT",
      !TABLE_ADVOCATE_ASSIGNMENT && "TABLE_ADVOCATE_ASSIGNMENT",
      !TABLE_CONVERSATION && "TABLE_CONVERSATION",
      !TABLE_CONVERSATION_PARTICIPANT && "TABLE_CONVERSATION_PARTICIPANT",
      !TABLE_MESSAGE && "TABLE_MESSAGE",
    ].filter(Boolean);

    if (missing.length) {
      return json(500, { ok: false, error: `Missing: ${missing.join(", ")}` });
    }

    const iso = (ms) => new Date(ms).toISOString();
    const nowMs = Date.now();
    const now = iso(nowMs);
    const minutesAgo = (m) => iso(nowMs - m * 60 * 1000);

    const scanAllIds = async (tableName) => {
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
        for (const it of res.Items || []) if (it?.id) ids.push(it.id);
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return ids;
    };

    const deleteByIds = async (tableName, ids) => {
      for (const id of ids) {
        await ddb.send(
          new DeleteCommand({ TableName: tableName, Key: { id } }),
        );
      }
    };

    const putMany = async (tableName, items) => {
      for (const item of items) {
        await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
      }
    };

    const findCognitoUserIdByEmail = async (email) => {
      const res = await cognito.send(
        new ListUsersCommand({
          UserPoolId: AUTH_HEALTHCONNECT97A44150_USERPOOLID,
          Filter: `email = "${email}"`,
          Limit: 1,
        }),
      );

      const user = (res.Users || [])[0];
      if (!user) throw new Error(`Cognito user not found for email: ${email}`);

      return user.Username;
    };

    const patientId = await findCognitoUserIdByEmail("patient@example.com");
    const providerId = await findCognitoUserIdByEmail("provider@example.com");
    const advocateId = await findCognitoUserIdByEmail("advocate@example.com");

    console.log("[SEED_BASIC] resolved ids", {
      patientId,
      providerId,
      advocateId,
    });

    const usersToDelete = [];
    let userScanKey = undefined;

    do {
      const res = await ddb.send(
        new ScanCommand({
          TableName: TABLE_USER,
          ProjectionExpression: "id, #role, email",
          ExpressionAttributeNames: { "#role": "role" },
          ExclusiveStartKey: userScanKey,
        }),
      );

      for (const u of res.Items || []) {
        if (!u?.id) continue;

        if (!u.role || !u.email) {
          usersToDelete.push(u.id);
          continue;
        }

        if (u.role !== "ADMIN") usersToDelete.push(u.id);
      }

      userScanKey = res.LastEvaluatedKey;
    } while (userScanKey);

    await deleteByIds(TABLE_USER, usersToDelete);

    await deleteByIds(TABLE_MESSAGE, await scanAllIds(TABLE_MESSAGE));
    await deleteByIds(
      TABLE_CONVERSATION_PARTICIPANT,
      await scanAllIds(TABLE_CONVERSATION_PARTICIPANT),
    );
    await deleteByIds(TABLE_CONVERSATION, await scanAllIds(TABLE_CONVERSATION));

    await deleteByIds(
      TABLE_PROVIDER_PATIENT,
      await scanAllIds(TABLE_PROVIDER_PATIENT),
    );
    await deleteByIds(
      TABLE_ADVOCATE_ASSIGNMENT,
      await scanAllIds(TABLE_ADVOCATE_ASSIGNMENT),
    );

    const seededUsers = [
      {
        id: patientId,
        email: "patient@example.com",
        displayName: "Jordan Patient",
        role: "PATIENT",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: providerId,
        email: "provider@example.com",
        displayName: "Dr. Avery Provider",
        role: "PROVIDER",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: advocateId,
        email: "advocate@example.com",
        displayName: "Casey Advocate",
        role: "ADVOCATE",
        createdAt: now,
        updatedAt: now,
      },
    ];

    await putMany(TABLE_USER, seededUsers);

    const providerPatient = {
      id: "demo-provider-patient",
      providerId,
      patientId,
      createdAt: now,
      updatedAt: now,
    };

    const advocateAssignment = {
      id: "demo-advocate-assignment",
      providerId,
      patientId,
      advocateId,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_PROVIDER_PATIENT,
        Item: providerPatient,
      }),
    );

    await ddb.send(
      new PutCommand({
        TableName: TABLE_ADVOCATE_ASSIGNMENT,
        Item: advocateAssignment,
      }),
    );

    const convCareTeam = {
      id: "demo-care-team-conv",
      title: "Care Team Chat",
      isGroup: true,
      createdBy: providerId,
      memberIds: [patientId, providerId, advocateId],
      createdAt: minutesAgo(120),
      lastMessageAt: minutesAgo(5),
      updatedAt: minutesAgo(5),
    };

    const convPatientProvider = {
      id: "demo-patient-provider-conv",
      title: null,
      isGroup: false,
      createdBy: patientId,
      memberIds: [patientId, providerId],
      createdAt: minutesAgo(240),
      lastMessageAt: minutesAgo(55),
      updatedAt: minutesAgo(55),
    };

    const convPatientAdvocate = {
      id: "demo-patient-advocate-conv",
      title: null,
      isGroup: false,
      createdBy: advocateId,
      memberIds: [patientId, advocateId],
      createdAt: minutesAgo(180),
      lastMessageAt: minutesAgo(12),
      updatedAt: minutesAgo(12),
    };

    const conversations = [
      convCareTeam,
      convPatientProvider,
      convPatientAdvocate,
    ];
    await putMany(TABLE_CONVERSATION, conversations);

    const participants = [
      {
        id: "demo-cp-care-patient",
        conversationId: convCareTeam.id,
        userId: patientId,
        lastReadAt: minutesAgo(20),
        createdAt: convCareTeam.createdAt,
        updatedAt: now,
      },
      {
        id: "demo-cp-care-provider",
        conversationId: convCareTeam.id,
        userId: providerId,
        lastReadAt: minutesAgo(5),
        createdAt: convCareTeam.createdAt,
        updatedAt: now,
      },
      {
        id: "demo-cp-care-advocate",
        conversationId: convCareTeam.id,
        userId: advocateId,
        lastReadAt: minutesAgo(10),
        createdAt: convCareTeam.createdAt,
        updatedAt: now,
      },

      {
        id: "demo-cp-pp-patient",
        conversationId: convPatientProvider.id,
        userId: patientId,
        lastReadAt: minutesAgo(55),
        createdAt: convPatientProvider.createdAt,
        updatedAt: now,
      },
      {
        id: "demo-cp-pp-provider",
        conversationId: convPatientProvider.id,
        userId: providerId,
        lastReadAt: minutesAgo(55),
        createdAt: convPatientProvider.createdAt,
        updatedAt: now,
      },

      {
        id: "demo-cp-pa-patient",
        conversationId: convPatientAdvocate.id,
        userId: patientId,
        lastReadAt: minutesAgo(12),
        createdAt: convPatientAdvocate.createdAt,
        updatedAt: now,
      },
      {
        id: "demo-cp-pa-advocate",
        conversationId: convPatientAdvocate.id,
        userId: advocateId,
        lastReadAt: minutesAgo(30),
        createdAt: convPatientAdvocate.createdAt,
        updatedAt: now,
      },
    ];

    await putMany(TABLE_CONVERSATION_PARTICIPANT, participants);

    const msg = (
      id,
      conversationId,
      senderId,
      memberIds,
      type,
      body,
      createdAt,
    ) => ({
      id,
      conversationId,
      senderId,
      memberIds,
      type,
      body,
      createdAt,
      updatedAt: createdAt,
    });

    const messages = [
      msg(
        "demo-msg-care-001",
        convCareTeam.id,
        providerId,
        convCareTeam.memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(119),
      ),
      msg(
        "demo-msg-care-002",
        convCareTeam.id,
        providerId,
        convCareTeam.memberIds,
        "TEXT",
        "Hi Jordan — checking in. How are symptoms today?",
        minutesAgo(115),
      ),
      msg(
        "demo-msg-care-003",
        convCareTeam.id,
        patientId,
        convCareTeam.memberIds,
        "TEXT",
        "Still some pain, but it’s better than yesterday.",
        minutesAgo(112),
      ),
      msg(
        "demo-msg-care-004",
        convCareTeam.id,
        advocateId,
        convCareTeam.memberIds,
        "TEXT",
        "Thanks for the update. I can help coordinate follow-up if needed.",
        minutesAgo(95),
      ),
      msg(
        "demo-msg-care-005",
        convCareTeam.id,
        providerId,
        convCareTeam.memberIds,
        "TEXT",
        "Let’s adjust the plan: hydration + rest, and we’ll reassess tomorrow.",
        minutesAgo(60),
      ),
      msg(
        "demo-msg-care-006",
        convCareTeam.id,
        patientId,
        convCareTeam.memberIds,
        "TEXT",
        "Sounds good. I can do that.",
        minutesAgo(25),
      ),
      msg(
        "demo-msg-care-007",
        convCareTeam.id,
        providerId,
        convCareTeam.memberIds,
        "TEXT",
        "If anything worsens, message here and we’ll respond ASAP.",
        minutesAgo(5),
      ),

      msg(
        "demo-msg-pp-001",
        convPatientProvider.id,
        patientId,
        convPatientProvider.memberIds,
        "TEXT",
        "Quick question: should I take the medication with food?",
        minutesAgo(80),
      ),
      msg(
        "demo-msg-pp-002",
        convPatientProvider.id,
        providerId,
        convPatientProvider.memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      msg(
        "demo-msg-pp-003",
        convPatientProvider.id,
        patientId,
        convPatientProvider.memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(55),
      ),

      msg(
        "demo-msg-pa-001",
        convPatientAdvocate.id,
        patientId,
        convPatientAdvocate.memberIds,
        "TEXT",
        "Can you help me understand the next steps after the appointment?",
        minutesAgo(25),
      ),
      msg(
        "demo-msg-pa-002",
        convPatientAdvocate.id,
        advocateId,
        convPatientAdvocate.memberIds,
        "TEXT",
        "Absolutely — I’ll summarize what to expect and what to watch for.",
        minutesAgo(12),
      ),
    ];

    await putMany(TABLE_MESSAGE, messages);

    return json(200, {
      ok: true,
      mode,
      scenario,
      resolvedIds: { patientId, providerId, advocateId },
      deletedUsersCount: usersToDelete.length,
      seeded: {
        users: seededUsers.length,
        providerPatients: 1,
        advocateAssignments: 1,
        conversations: conversations.length,
        conversationParticipants: participants.length,
        messages: messages.length,
      },
      ids: {
        userIds: seededUsers.map((u) => u.id),
        providerPatientId: providerPatient.id,
        advocateAssignmentId: advocateAssignment.id,
        conversationIds: conversations.map((c) => c.id),
      },
    });
  } catch (e) {
    console.error("[SEED_BASIC] ERROR", e);
    return json(500, { ok: false, error: e?.message ?? String(e) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
    body: JSON.stringify(obj),
  };
}
