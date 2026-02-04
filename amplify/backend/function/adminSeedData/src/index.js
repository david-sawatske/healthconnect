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

    const now = new Date().toISOString();

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

    for (const u of seededUsers) {
      await ddb.send(new PutCommand({ TableName: TABLE_USER, Item: u }));
    }

    const ppIds = await scanAllIds(TABLE_PROVIDER_PATIENT);
    await deleteByIds(TABLE_PROVIDER_PATIENT, ppIds);

    const providerPatient = {
      id: "demo-provider-patient",
      providerId,
      patientId,
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_PROVIDER_PATIENT,
        Item: providerPatient,
      }),
    );

    const aaIds = await scanAllIds(TABLE_ADVOCATE_ASSIGNMENT);
    await deleteByIds(TABLE_ADVOCATE_ASSIGNMENT, aaIds);

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
        TableName: TABLE_ADVOCATE_ASSIGNMENT,
        Item: advocateAssignment,
      }),
    );

    await deleteByIds(TABLE_MESSAGE, await scanAllIds(TABLE_MESSAGE));
    await deleteByIds(
      TABLE_CONVERSATION_PARTICIPANT,
      await scanAllIds(TABLE_CONVERSATION_PARTICIPANT),
    );
    await deleteByIds(TABLE_CONVERSATION, await scanAllIds(TABLE_CONVERSATION));

    const conversation = {
      id: "demo-care-team-conv",
      title: "Care Team Chat",
      isGroup: true,
      createdBy: providerId,
      memberIds: [patientId, providerId, advocateId],
      updatedAt: now,
      createdAt: now,
      lastMessageAt: now,
    };

    await ddb.send(
      new PutCommand({ TableName: TABLE_CONVERSATION, Item: conversation }),
    );

    const participants = [
      {
        id: "demo-cp-patient",
        conversationId: conversation.id,
        userId: patientId,
        role: "PATIENT",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "demo-cp-provider",
        conversationId: conversation.id,
        userId: providerId,
        role: "PROVIDER",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "demo-cp-advocate",
        conversationId: conversation.id,
        userId: advocateId,
        role: "ADVOCATE",
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const p of participants) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_CONVERSATION_PARTICIPANT,
          Item: p,
        }),
      );
    }

    return json(200, {
      ok: true,
      mode,
      scenario,
      resolvedIds: { patientId, providerId, advocateId },
      deletedUsersCount: usersToDelete.length,
      seededUserIds: seededUsers.map((u) => u.id),
      seededProviderPatientId: providerPatient.id,
      seededAdvocateAssignmentId: advocateAssignment.id,
      seededConversationId: conversation.id,
      seededParticipantIds: participants.map((p) => p.id),
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
