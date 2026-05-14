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

const SEED_VERSION = "demo-scenario-matrix-v1";

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
  TABLE_ADVOCATE_INVITE,
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

requireEnv(
  "AUTH_HEALTHCONNECT97A44150_USERPOOLID",
  AUTH_HEALTHCONNECT97A44150_USERPOOLID,
);
requireEnv("TABLE_USER", TABLE_USER);
requireEnv("TABLE_PROVIDER_PATIENT", TABLE_PROVIDER_PATIENT);
requireEnv("TABLE_ADVOCATE_ASSIGNMENT", TABLE_ADVOCATE_ASSIGNMENT);
requireEnv("TABLE_CONVERSATION", TABLE_CONVERSATION);
requireEnv("TABLE_CONVERSATION_PARTICIPANT", TABLE_CONVERSATION_PARTICIPANT);
requireEnv("TABLE_MESSAGE", TABLE_MESSAGE);
requireEnv("TABLE_ADVOCATE_INVITE", TABLE_ADVOCATE_INVITE);

function careTeamTitle(providerName) {
  return `Care Team: ${providerName || "Provider"}`;
}

exports.handler = async (event) => {
  console.log("[ADMIN_SEED] event.raw =", JSON.stringify(event));
  console.log("[ADMIN_SEED] SEED_VERSION =", SEED_VERSION);

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
      !TABLE_ADVOCATE_INVITE && "TABLE_ADVOCATE_INVITE",
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

        for (const it of res.Items || []) {
          if (it?.id) ids.push(it.id);
        }

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
      return deleteByIds(tableName, ids);
    };

    const withModelTimestamps = (item, defaultCreatedAt = now) => {
      const createdAt = item.createdAt ?? defaultCreatedAt;
      const updatedAt = item.updatedAt ?? createdAt;

      return {
        ...item,
        createdAt,
        updatedAt,
      };
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

    const patient2Id = await findCognitoUserIdByEmail("morgan.patient2@example.com");
    const patient3Id = await findCognitoUserIdByEmail("taylor.patient3@example.com");
    const provider2Id = await findCognitoUserIdByEmail("dr.provider2@example.com");
    const advocate2Id = await findCognitoUserIdByEmail("alex.advocate2@example.com");

    const patientName = "Jordan Patient";
    const providerName = "Dr. Avery Provider";
    const advocateName = "Casey Advocate";

    const patient2Name = "Morgan Reed";
    const patient3Name = "Taylor Nguyen";
    const provider2Name = "Dr. Riley Chen";
    const advocate2Name = "Alex Rivera";

    console.log("[ADMIN_SEED] resolved ids", {
      patientId,
      providerId,
      advocateId,
      patient2Id,
      patient3Id,
      provider2Id,
      advocate2Id,
    });

    const deleteSummary = {
      usersDeleted: 0,
      Message: 0,
      ConversationParticipant: 0,
      Conversation: 0,
      ProviderPatient: 0,
      AdvocateAssignment: 0,
      AdvocateInvite: 0,
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
    deleteSummary.AdvocateInvite = await clearTable(TABLE_ADVOCATE_INVITE);
    deleteSummary.ProviderPatient = await clearTable(TABLE_PROVIDER_PATIENT);
    deleteSummary.AdvocateAssignment = await clearTable(
      TABLE_ADVOCATE_ASSIGNMENT,
    );

    const CARE_TEAM_ID = (pId, prId) => `CARE_TEAM:${pId}:${prId}`;

    const DM_ID = (a, b) => {
      const [minId, maxId] = [a, b].sort();
      return `DM:${minId}:${maxId}`;
    };

    const providerPatientId = ({ providerId, patientId }) =>
      `PP:${providerId}:${patientId}`;

    const advocateAssignmentId = ({ patientId, providerId, advocateId }) =>
      `PA:${patientId}:PR:${providerId}:ADV:${advocateId}`;

    const careTeamJordanAveryId = CARE_TEAM_ID(patientId, providerId);
    const careTeamJordanRileyId = CARE_TEAM_ID(patientId, provider2Id);
    const careTeamMorganAveryId = CARE_TEAM_ID(patient2Id, providerId);

    const dmJordanAveryId = DM_ID(patientId, providerId);
    const dmJordanCaseyId = DM_ID(patientId, advocateId);
    const dmJordanRileyId = DM_ID(patientId, provider2Id);
    const dmJordanAlexId = DM_ID(patientId, advocate2Id);
    const dmMorganAveryId = DM_ID(patient2Id, providerId);

    const seedPlan = {
      users: [
        withModelTimestamps({
          id: patientId,
          email: "patient@example.com",
          displayName: patientName,
          role: "PATIENT",
        }),
        withModelTimestamps({
          id: providerId,
          email: "provider@example.com",
          displayName: providerName,
          role: "PROVIDER",
        }),
        withModelTimestamps({
          id: advocateId,
          email: "advocate@example.com",
          displayName: advocateName,
          role: "ADVOCATE",
        }),
        withModelTimestamps({
          id: patient2Id,
          email: "morgan.patient2@example.com",
          displayName: patient2Name,
          role: "PATIENT",
        }),
        withModelTimestamps({
          id: patient3Id,
          email: "taylor.patient3@example.com",
          displayName: patient3Name,
          role: "PATIENT",
        }),
        withModelTimestamps({
          id: provider2Id,
          email: "dr.provider2@example.com",
          displayName: provider2Name,
          role: "PROVIDER",
        }),
        withModelTimestamps({
          id: advocate2Id,
          email: "alex.advocate2@example.com",
          displayName: advocate2Name,
          role: "ADVOCATE",
        }),
      ],

      providerPatients: [
        withModelTimestamps({
          id: providerPatientId({ providerId, patientId }),
          providerId,
          patientId,
        }),
        withModelTimestamps({
          id: providerPatientId({ providerId: provider2Id, patientId }),
          providerId: provider2Id,
          patientId,
        }),
        withModelTimestamps({
          id: providerPatientId({ providerId, patientId: patient2Id }),
          providerId,
          patientId: patient2Id,
        }),
      ],

      advocateAssignments: [
        withModelTimestamps({
          id: advocateAssignmentId({ providerId, patientId, advocateId }),
          providerId,
          patientId,
          advocateId,
          active: true,
        }),
        withModelTimestamps({
          id: advocateAssignmentId({
            providerId: provider2Id,
            patientId,
            advocateId: advocate2Id,
          }),
          providerId: provider2Id,
          patientId,
          advocateId: advocate2Id,
          active: true,
        }),
      ],

      conversations: null,
      participants: null,
      messages: null,
    };

    seedPlan.conversations = (() => {
      const conv = ({
        id,
        title,
        isGroup,
        createdBy,
        memberIds,
        createdAt,
        lastMessageAt,
      }) =>
        withModelTimestamps({
          id,
          title: title ?? null,
          isGroup,
          createdBy,
          memberIds,
          createdAt,
          lastMessageAt: lastMessageAt ?? null,
          updatedAt: lastMessageAt ?? createdAt,
        });

      const convCareTeamJordanAvery = conv({
        id: careTeamJordanAveryId,
        title: careTeamTitle(providerName),
        isGroup: true,
        createdBy: providerId,
        memberIds: [patientId, providerId, advocateId],
        createdAt: minutesAgo(360),
        lastMessageAt: minutesAgo(5),
      });

      const convCareTeamJordanRiley = conv({
        id: careTeamJordanRileyId,
        title: careTeamTitle(provider2Name),
        isGroup: true,
        createdBy: provider2Id,
        memberIds: [patientId, provider2Id, advocate2Id],
        createdAt: minutesAgo(300),
        lastMessageAt: minutesAgo(35),
      });

      const convCareTeamMorganAvery = conv({
        id: careTeamMorganAveryId,
        title: careTeamTitle(providerName),
        isGroup: true,
        createdBy: providerId,
        memberIds: [patient2Id, providerId],
        createdAt: minutesAgo(240),
        lastMessageAt: minutesAgo(40),
      });

      const convJordanAvery = conv({
        id: dmJordanAveryId,
        title: null,
        isGroup: false,
        createdBy: patientId,
        memberIds: [patientId, providerId],
        createdAt: minutesAgo(420),
        lastMessageAt: minutesAgo(55),
      });

      const convJordanCasey = conv({
        id: dmJordanCaseyId,
        title: null,
        isGroup: false,
        createdBy: advocateId,
        memberIds: [patientId, advocateId],
        createdAt: minutesAgo(390),
        lastMessageAt: minutesAgo(12),
      });

      const convJordanRiley = conv({
        id: dmJordanRileyId,
        title: null,
        isGroup: false,
        createdBy: provider2Id,
        memberIds: [patientId, provider2Id],
        createdAt: minutesAgo(280),
        lastMessageAt: minutesAgo(75),
      });

      const convJordanAlex = conv({
        id: dmJordanAlexId,
        title: null,
        isGroup: false,
        createdBy: advocate2Id,
        memberIds: [patientId, advocate2Id],
        createdAt: minutesAgo(260),
        lastMessageAt: minutesAgo(50),
      });

      const convMorganAvery = conv({
        id: dmMorganAveryId,
        title: null,
        isGroup: false,
        createdBy: patient2Id,
        memberIds: [patient2Id, providerId],
        createdAt: minutesAgo(230),
        lastMessageAt: minutesAgo(65),
      });

      const list = [
        convCareTeamJordanAvery,
        convCareTeamJordanRiley,
        convCareTeamMorganAvery,
        convJordanAvery,
        convJordanCasey,
        convJordanRiley,
        convJordanAlex,
        convMorganAvery,
      ];

      const byId = Object.fromEntries(list.map((c) => [c.id, c]));

      return { list, byId };
    })();

    const cpId = (conversationId, userId) => `${conversationId}:${userId}`;

    const participant = ({ conversationId, userId, lastReadAt, createdAt }) =>
      withModelTimestamps({
        id: cpId(conversationId, userId),
        conversationId,
        userId,
        lastReadAt: lastReadAt ?? null,
        createdAt,
        updatedAt: now,
      });

    const participantsForConversation = (c, lastReadAtByUserId = {}) =>
      c.memberIds.map((uid) =>
        participant({
          conversationId: c.id,
          userId: uid,
          lastReadAt: lastReadAtByUserId[uid] ?? null,
          createdAt: c.createdAt,
        }),
      );

    seedPlan.participants = [
      ...participantsForConversation(
        seedPlan.conversations.byId[careTeamJordanAveryId],
        {
          [patientId]: minutesAgo(20),
          [providerId]: minutesAgo(5),
          [advocateId]: minutesAgo(10),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[careTeamJordanRileyId],
        {
          [patientId]: minutesAgo(35),
          [provider2Id]: minutesAgo(35),
          [advocate2Id]: minutesAgo(50),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[careTeamMorganAveryId],
        {
          [patient2Id]: minutesAgo(40),
          [providerId]: minutesAgo(40),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmJordanAveryId],
        {
          [patientId]: minutesAgo(55),
          [providerId]: minutesAgo(55),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmJordanCaseyId],
        {
          [patientId]: minutesAgo(12),
          [advocateId]: minutesAgo(30),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmJordanRileyId],
        {
          [patientId]: minutesAgo(75),
          [provider2Id]: minutesAgo(75),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmJordanAlexId],
        {
          [patientId]: minutesAgo(50),
          [advocate2Id]: minutesAgo(90),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmMorganAveryId],
        {
          [patient2Id]: minutesAgo(65),
          [providerId]: minutesAgo(200),
        },
      ),
    ];

    const message = (
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

    const m = (suffix) => `demo-msg-${suffix}`;

    seedPlan.messages = [
      message(
        m("jordan-avery-care-001"),
        careTeamJordanAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(355),
      ),
      message(
        m("jordan-avery-care-002"),
        careTeamJordanAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "TEXT",
        "Hi Jordan — checking in. How are symptoms today?",
        minutesAgo(115),
      ),
      message(
        m("jordan-avery-care-003"),
        careTeamJordanAveryId,
        patientId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "TEXT",
        "Still some pain, but it’s better than yesterday.",
        minutesAgo(112),
      ),
      message(
        m("jordan-avery-care-004"),
        careTeamJordanAveryId,
        advocateId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "TEXT",
        "Thanks for the update. I can help coordinate follow-up if needed.",
        minutesAgo(95),
      ),
      message(
        m("jordan-avery-care-005"),
        careTeamJordanAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "TEXT",
        "Let’s adjust the plan: hydration + rest, and we’ll reassess tomorrow.",
        minutesAgo(60),
      ),
      message(
        m("jordan-avery-care-006"),
        careTeamJordanAveryId,
        patientId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "TEXT",
        "Sounds good. I can do that.",
        minutesAgo(25),
      ),
      message(
        m("jordan-avery-care-007"),
        careTeamJordanAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamJordanAveryId].memberIds,
        "TEXT",
        "If anything worsens, message here and we’ll respond ASAP.",
        minutesAgo(5),
      ),

      message(
        m("jordan-riley-care-001"),
        careTeamJordanRileyId,
        provider2Id,
        seedPlan.conversations.byId[careTeamJordanRileyId].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(295),
      ),
      message(
        m("jordan-riley-care-002"),
        careTeamJordanRileyId,
        provider2Id,
        seedPlan.conversations.byId[careTeamJordanRileyId].memberIds,
        "TEXT",
        "Hi Jordan — I reviewed your notes and can provide a second opinion.",
        minutesAgo(80),
      ),
      message(
        m("jordan-riley-care-003"),
        careTeamJordanRileyId,
        advocate2Id,
        seedPlan.conversations.byId[careTeamJordanRileyId].memberIds,
        "TEXT",
        "I can help keep both care plans organized and follow up on scheduling.",
        minutesAgo(50),
      ),
      message(
        m("jordan-riley-care-004"),
        careTeamJordanRileyId,
        patientId,
        seedPlan.conversations.byId[careTeamJordanRileyId].memberIds,
        "TEXT",
        "Thank you — that helps clarify who is coordinating what.",
        minutesAgo(35),
      ),

      message(
        m("morgan-avery-care-001"),
        careTeamMorganAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamMorganAveryId].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(235),
      ),
      message(
        m("morgan-avery-care-002"),
        careTeamMorganAveryId,
        patient2Id,
        seedPlan.conversations.byId[careTeamMorganAveryId].memberIds,
        "TEXT",
        "I’m not sure which follow-up appointment I should schedule.",
        minutesAgo(120),
      ),
      message(
        m("morgan-avery-care-003"),
        careTeamMorganAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamMorganAveryId].memberIds,
        "TEXT",
        "Let’s do a 2-week follow-up. We can add an advocate later if you want help coordinating.",
        minutesAgo(70),
      ),
      message(
        m("morgan-avery-care-004"),
        careTeamMorganAveryId,
        patient2Id,
        seedPlan.conversations.byId[careTeamMorganAveryId].memberIds,
        "TEXT",
        "Afternoons are better for me.",
        minutesAgo(55),
      ),
      message(
        m("morgan-avery-care-005"),
        careTeamMorganAveryId,
        providerId,
        seedPlan.conversations.byId[careTeamMorganAveryId].memberIds,
        "TEXT",
        "Great — I’ll request an afternoon slot and confirm here.",
        minutesAgo(40),
      ),

      message(
        m("jordan-avery-dm-001"),
        dmJordanAveryId,
        patientId,
        seedPlan.conversations.byId[dmJordanAveryId].memberIds,
        "TEXT",
        "Quick question: should I take the medication with food?",
        minutesAgo(80),
      ),
      message(
        m("jordan-avery-dm-002"),
        dmJordanAveryId,
        providerId,
        seedPlan.conversations.byId[dmJordanAveryId].memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      message(
        m("jordan-avery-dm-003"),
        dmJordanAveryId,
        patientId,
        seedPlan.conversations.byId[dmJordanAveryId].memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(55),
      ),

      message(
        m("jordan-casey-dm-001"),
        dmJordanCaseyId,
        patientId,
        seedPlan.conversations.byId[dmJordanCaseyId].memberIds,
        "TEXT",
        "Can you help me understand the next steps after the appointment?",
        minutesAgo(25),
      ),
      message(
        m("jordan-casey-dm-002"),
        dmJordanCaseyId,
        advocateId,
        seedPlan.conversations.byId[dmJordanCaseyId].memberIds,
        "TEXT",
        "Absolutely — I’ll summarize what to expect and what to watch for.",
        minutesAgo(12),
      ),

      message(
        m("jordan-riley-dm-001"),
        dmJordanRileyId,
        provider2Id,
        seedPlan.conversations.byId[dmJordanRileyId].memberIds,
        "TEXT",
        "I reviewed your care plan and added notes to the care team chat.",
        minutesAgo(95),
      ),
      message(
        m("jordan-riley-dm-002"),
        dmJordanRileyId,
        patientId,
        seedPlan.conversations.byId[dmJordanRileyId].memberIds,
        "TEXT",
        "Thanks, I’ll review them today.",
        minutesAgo(75),
      ),

      message(
        m("jordan-alex-dm-001"),
        dmJordanAlexId,
        advocate2Id,
        seedPlan.conversations.byId[dmJordanAlexId].memberIds,
        "TEXT",
        "I can help organize the second-opinion follow-up if that would be useful.",
        minutesAgo(85),
      ),
      message(
        m("jordan-alex-dm-002"),
        dmJordanAlexId,
        patientId,
        seedPlan.conversations.byId[dmJordanAlexId].memberIds,
        "TEXT",
        "Yes, please. I want to make sure I understand both recommendations.",
        minutesAgo(50),
      ),

      message(
        m("morgan-avery-dm-001"),
        dmMorganAveryId,
        patient2Id,
        seedPlan.conversations.byId[dmMorganAveryId].memberIds,
        "TEXT",
        "Should I take the medication with food?",
        minutesAgo(80),
      ),
      message(
        m("morgan-avery-dm-002"),
        dmMorganAveryId,
        providerId,
        seedPlan.conversations.byId[dmMorganAveryId].memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      message(
        m("morgan-avery-dm-003"),
        dmMorganAveryId,
        patient2Id,
        seedPlan.conversations.byId[dmMorganAveryId].memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(65),
      ),
    ];

    const expectedCounts = {
      users: 7,
      providerPatients: 3,
      advocateAssignments: 2,
      conversations: 8,
      conversationParticipants: 18,
      messages: 28,
    };

    const actualCountsBeforeWrite = {
      users: seedPlan.users.length,
      providerPatients: seedPlan.providerPatients.length,
      advocateAssignments: seedPlan.advocateAssignments.length,
      conversations: seedPlan.conversations.list.length,
      conversationParticipants: seedPlan.participants.length,
      messages: seedPlan.messages.length,
    };

    console.log("[ADMIN_SEED] expectedCounts =", expectedCounts);
    console.log(
      "[ADMIN_SEED] actualCountsBeforeWrite =",
      actualCountsBeforeWrite,
    );
    console.log(
      "[ADMIN_SEED] conversation titles =",
      seedPlan.conversations.list.map((c) => ({
        id: c.id,
        title: c.title,
      })),
    );

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
    seedSummary.conversations = await seedMany(
      TABLE_CONVERSATION,
      seedPlan.conversations.list,
    );
    seedSummary.conversationParticipants = await seedMany(
      TABLE_CONVERSATION_PARTICIPANT,
      seedPlan.participants,
    );
    seedSummary.messages = await seedMany(TABLE_MESSAGE, seedPlan.messages);

    return json(200, {
      ok: true,
      seedVersion: SEED_VERSION,
      mode,
      scenario,
      resolvedIds: {
        patientId,
        providerId,
        advocateId,
        patient2Id,
        patient3Id,
        provider2Id,
        advocate2Id,
      },
      deleted: deleteSummary,
      seeded: seedSummary,
      expectedCounts,
      actualCountsBeforeWrite,
      ids: {
        providerPatientIds: seedPlan.providerPatients.map((p) => p.id),
        advocateAssignmentIds: seedPlan.advocateAssignments.map((a) => a.id),
        conversationIds: seedPlan.conversations.list.map((c) => c.id),
      },
      conversationTitles: seedPlan.conversations.list.map((c) => ({
        id: c.id,
        title: c.title,
      })),
      demoScenarios: {
        jordanPatient: "Has two providers and two advocate-backed care teams.",
        morganReed:
          "Has one provider and no advocates; use to test adding a provider and inviting an advocate.",
        taylorNguyen:
          "Has no providers and no advocates; use to test empty patient state and first provider connection.",
      },
      notes: {
        seedVersion: SEED_VERSION,
        modelTimestamps: "All @model seed items include createdAt + updatedAt",
        schemaDrift: "No ConversationParticipant.role written",
        removedChat:
          '"System Updates" and non-canonical demo group conversations are fully removed',
        deterministicIds:
          "Care team uses CARE_TEAM:${patientId}:${providerId}; DMs use DM:${minId}:${maxId}; ProviderPatient uses PP:${providerId}:${patientId}; AdvocateAssignment uses PA:${patientId}:PR:${providerId}:ADV:${advocateId}",
        conversationTitles:
          "Care-team seed titles use provider-facing format: Care Team: ${providerName}",
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
