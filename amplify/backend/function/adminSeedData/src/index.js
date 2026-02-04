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
  console.log("[ADMIN_SEED] event.raw =", JSON.stringify(event));

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

    const missingEnv = [
      !AUTH_HEALTHCONNECT97A44150_USERPOOLID && "AUTH_*_USERPOOLID",
      !TABLE_USER && "TABLE_USER",
      !TABLE_PROVIDER_PATIENT && "TABLE_PROVIDER_PATIENT",
      !TABLE_ADVOCATE_ASSIGNMENT && "TABLE_ADVOCATE_ASSIGNMENT",
      !TABLE_CONVERSATION && "TABLE_CONVERSATION",
      !TABLE_CONVERSATION_PARTICIPANT && "TABLE_CONVERSATION_PARTICIPANT",
      !TABLE_MESSAGE && "TABLE_MESSAGE",
    ].filter(Boolean);

    if (missingEnv.length) {
      return json(500, {
        ok: false,
        error: `Missing: ${missingEnv.join(", ")}`,
      });
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
          new DeleteCommand({
            TableName: tableName,
            Key: { id },
          }),
        );
      }
      return ids.length;
    };

    const clearTable = async (tableName) => {
      const ids = await scanAllIds(tableName);
      const deleted = await deleteByIds(tableName, ids);
      return deleted;
    };

    const withModelTimestamps = (item, defaultCreatedAt = now) => {
      const createdAt = item.createdAt ?? defaultCreatedAt;
      const updatedAt = item.updatedAt ?? createdAt;
      return { ...item, createdAt, updatedAt };
    };

    const seedMany = async (
      tableName,
      items,
      { requireTimestamps = true } = {},
    ) => {
      for (const raw of items) {
        const item = requireTimestamps ? withModelTimestamps(raw) : raw;
        await ddb.send(
          new PutCommand({
            TableName: tableName,
            Item: item,
          }),
        );
      }
      return items.length;
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

    console.log("[ADMIN_SEED] resolved ids", {
      patientId,
      providerId,
      advocateId,
    });

    const deleteSummary = {
      usersDeleted: 0,
      Message: 0,
      ConversationParticipant: 0,
      Conversation: 0,
      ProviderPatient: 0,
      AdvocateAssignment: 0,
    };

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

    deleteSummary.usersDeleted = await deleteByIds(TABLE_USER, usersToDelete);

    deleteSummary.Message = await clearTable(TABLE_MESSAGE);
    deleteSummary.ConversationParticipant = await clearTable(
      TABLE_CONVERSATION_PARTICIPANT,
    );
    deleteSummary.Conversation = await clearTable(TABLE_CONVERSATION);
    deleteSummary.ProviderPatient = await clearTable(TABLE_PROVIDER_PATIENT);
    deleteSummary.AdvocateAssignment = await clearTable(
      TABLE_ADVOCATE_ASSIGNMENT,
    );

    const seedPlan = {
      users: [
        withModelTimestamps({
          id: patientId,
          email: "patient@example.com",
          displayName: "Jordan Patient",
          role: "PATIENT",
        }),
        withModelTimestamps({
          id: providerId,
          email: "provider@example.com",
          displayName: "Dr. Avery Provider",
          role: "PROVIDER",
        }),
        withModelTimestamps({
          id: advocateId,
          email: "advocate@example.com",
          displayName: "Casey Advocate",
          role: "ADVOCATE",
        }),
      ],

      providerPatients: [
        withModelTimestamps({
          id: "demo-provider-patient",
          providerId,
          patientId,
        }),
      ],

      advocateAssignments: [
        withModelTimestamps({
          id: "demo-advocate-assignment",
          providerId,
          patientId,
          advocateId,
          active: true,
        }),
      ],

      conversations: (() => {
        const careTeamMemberIds = [patientId, providerId, advocateId];
        const ppMemberIds = [patientId, providerId];
        const paMemberIds = [patientId, advocateId];

        const convCareTeam = withModelTimestamps({
          id: "demo-care-team-conv",
          title: "Care Team Chat",
          isGroup: true,
          createdBy: providerId,
          memberIds: careTeamMemberIds,
          createdAt: minutesAgo(120),
          lastMessageAt: minutesAgo(5),
          updatedAt: minutesAgo(5),
        });

        const convPatientProvider = withModelTimestamps({
          id: "demo-patient-provider-conv",
          title: "Patient Provider",
          isGroup: false,
          createdBy: patientId,
          memberIds: ppMemberIds,
          createdAt: minutesAgo(240),
          lastMessageAt: minutesAgo(55),
          updatedAt: minutesAgo(55),
        });

        const convPatientAdvocate = withModelTimestamps({
          id: "demo-patient-advocate-conv",
          title: "Patient Advocate",
          isGroup: false,
          createdBy: advocateId,
          memberIds: paMemberIds,
          createdAt: minutesAgo(180),
          lastMessageAt: minutesAgo(12),
          updatedAt: minutesAgo(12),
        });

        return { convCareTeam, convPatientProvider, convPatientAdvocate };
      })(),

      participants: null,
      messages: null,
    };

    const { convCareTeam, convPatientProvider, convPatientAdvocate } =
      seedPlan.conversations;

    seedPlan.participants = [
      withModelTimestamps({
        id: "demo-cp-care-patient",
        conversationId: convCareTeam.id,
        userId: patientId,
        lastReadAt: minutesAgo(20),
        createdAt: convCareTeam.createdAt,
      }),
      withModelTimestamps({
        id: "demo-cp-care-provider",
        conversationId: convCareTeam.id,
        userId: providerId,
        lastReadAt: minutesAgo(5),
        createdAt: convCareTeam.createdAt,
      }),
      withModelTimestamps({
        id: "demo-cp-care-advocate",
        conversationId: convCareTeam.id,
        userId: advocateId,
        lastReadAt: minutesAgo(10),
        createdAt: convCareTeam.createdAt,
      }),

      withModelTimestamps({
        id: "demo-cp-pp-patient",
        conversationId: convPatientProvider.id,
        userId: patientId,
        lastReadAt: minutesAgo(55),
        createdAt: convPatientProvider.createdAt,
      }),
      withModelTimestamps({
        id: "demo-cp-pp-provider",
        conversationId: convPatientProvider.id,
        userId: providerId,
        lastReadAt: minutesAgo(55),
        createdAt: convPatientProvider.createdAt,
      }),

      withModelTimestamps({
        id: "demo-cp-pa-patient",
        conversationId: convPatientAdvocate.id,
        userId: patientId,
        lastReadAt: minutesAgo(12),
        createdAt: convPatientAdvocate.createdAt,
      }),
      withModelTimestamps({
        id: "demo-cp-pa-advocate",
        conversationId: convPatientAdvocate.id,
        userId: advocateId,
        lastReadAt: minutesAgo(30),
        createdAt: convPatientAdvocate.createdAt,
      }),
    ];

    const msg = (
      id,
      conversationId,
      senderId,
      memberIds,
      type,
      body,
      createdAt,
    ) =>
      withModelTimestamps({
        id,
        conversationId,
        senderId,
        memberIds,
        type,
        body,
        createdAt,
        updatedAt: createdAt,
      });

    seedPlan.messages = [
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

    const seedSummary = {
      users: 0,
      providerPatients: 0,
      advocateAssignments: 0,
      conversations: 0,
      conversationParticipants: 0,
      messages: 0,
    };

    seedSummary.users = await seedMany(TABLE_USER, seedPlan.users);
    seedSummary.providerPatients = await seedMany(
      TABLE_PROVIDER_PATIENT,
      seedPlan.providerPatients,
    );
    seedSummary.advocateAssignments = await seedMany(
      TABLE_ADVOCATE_ASSIGNMENT,
      seedPlan.advocateAssignments,
    );

    seedSummary.conversations = await seedMany(TABLE_CONVERSATION, [
      convCareTeam,
      convPatientProvider,
      convPatientAdvocate,
    ]);

    seedSummary.conversationParticipants = await seedMany(
      TABLE_CONVERSATION_PARTICIPANT,
      seedPlan.participants,
    );

    seedSummary.messages = await seedMany(TABLE_MESSAGE, seedPlan.messages);

    return json(200, {
      ok: true,
      mode,
      scenario,
      resolvedIds: { patientId, providerId, advocateId },
      deleted: deleteSummary,
      seeded: seedSummary,
      ids: {
        providerPatientId: seedPlan.providerPatients[0].id,
        advocateAssignmentId: seedPlan.advocateAssignments[0].id,
        conversationIds: [
          convCareTeam.id,
          convPatientProvider.id,
          convPatientAdvocate.id,
        ],
      },
      notes: {
        modelTimestamps: "All @model seed items include createdAt + updatedAt",
        schemaDrift: "No ConversationParticipant.role written",
      },
    });
  } catch (e) {
    console.error("[ADMIN_SEED] ERROR", e);
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
