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
      return deleteByIds(tableName, ids);
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

    const patient2Id = "demo-patient2";
    const patient3Id = "demo-patient3";
    const provider2Id = "demo-provider2";
    const advocate2Id = "demo-advocate2";

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

    const careTeam1Id = CARE_TEAM_ID(patientId, providerId);
    const careTeam2Id = CARE_TEAM_ID(patient2Id, providerId);
    const careTeam3Id = CARE_TEAM_ID(patient3Id, providerId);

    const dmPatientProviderId = DM_ID(patientId, providerId);
    const dmPatientAdvocateId = DM_ID(patientId, advocateId);
    const dmP2ProviderId = DM_ID(patient2Id, providerId);
    const dmP3ProviderId = DM_ID(patient3Id, providerId);
    const dmP2Advocate1Id = DM_ID(patient2Id, advocateId);

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

        withModelTimestamps({
          id: patient2Id,
          email: "morgan.patient2@example.com",
          displayName: "Morgan Reed",
          role: "PATIENT",
        }),
        withModelTimestamps({
          id: patient3Id,
          email: "taylor.patient3@example.com",
          displayName: "Taylor Nguyen",
          role: "PATIENT",
        }),
        withModelTimestamps({
          id: provider2Id,
          email: "dr.provider2@example.com",
          displayName: "Dr. Riley Chen",
          role: "PROVIDER",
        }),
        withModelTimestamps({
          id: advocate2Id,
          email: "alex.advocate2@example.com",
          displayName: "Alex Rivera",
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
        withModelTimestamps({
          id: providerPatientId({ providerId, patientId: patient3Id }),
          providerId,
          patientId: patient3Id,
        }),
        withModelTimestamps({
          id: providerPatientId({
            providerId: provider2Id,
            patientId: patient2Id,
          }),
          providerId: provider2Id,
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

        withModelTimestamps({
          id: advocateAssignmentId({
            providerId,
            patientId: patient2Id,
            advocateId: advocate2Id,
          }),
          providerId,
          patientId: patient2Id,
          advocateId: advocate2Id,
          active: true,
        }),
        withModelTimestamps({
          id: advocateAssignmentId({
            providerId,
            patientId: patient3Id,
            advocateId: advocate2Id,
          }),
          providerId,
          patientId: patient3Id,
          advocateId: advocate2Id,
          active: false,
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

      const convCareTeam = conv({
        id: careTeam1Id,
        title: "Care Team Chat",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patientId, providerId, advocateId],
        createdAt: minutesAgo(120),
        lastMessageAt: minutesAgo(5),
      });

      const convPatientProvider = conv({
        id: dmPatientProviderId,
        title: null,
        isGroup: false,
        createdBy: patientId,
        memberIds: [patientId, providerId],
        createdAt: minutesAgo(240),
        lastMessageAt: minutesAgo(55),
      });

      const convPatientAdvocate = conv({
        id: dmPatientAdvocateId,
        title: null,
        isGroup: false,
        createdBy: advocateId,
        memberIds: [patientId, advocateId],
        createdAt: minutesAgo(180),
        lastMessageAt: minutesAgo(12),
      });

      const convCareTeam2 = conv({
        id: careTeam2Id,
        title: "Care Team — Morgan",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patient2Id, providerId, advocate2Id],
        createdAt: minutesAgo(600),
        lastMessageAt: minutesAgo(40),
      });

      const convCareTeam3 = conv({
        id: careTeam3Id,
        title: "Care Team — Taylor",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patient3Id, providerId, advocate2Id],
        createdAt: minutesAgo(900),
        lastMessageAt: minutesAgo(90),
      });

      const convP2Provider = conv({
        id: dmP2ProviderId,
        title: null,
        isGroup: false,
        createdBy: patient2Id,
        memberIds: [patient2Id, providerId],
        createdAt: minutesAgo(700),
        lastMessageAt: minutesAgo(65),
      });

      const convP3Provider = conv({
        id: dmP3ProviderId,
        title: null,
        isGroup: false,
        createdBy: providerId,
        memberIds: [patient3Id, providerId],
        createdAt: minutesAgo(800),
        lastMessageAt: minutesAgo(180),
      });

      const convP2Advocate1 = conv({
        id: dmP2Advocate1Id,
        title: null,
        isGroup: false,
        createdBy: advocateId,
        memberIds: [patient2Id, advocateId],
        createdAt: minutesAgo(500),
        lastMessageAt: minutesAgo(22),
      });

      const convGroup4 = conv({
        id: "demo-group-4",
        title: "Second Opinion — Care Coordination",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patient2Id, providerId, provider2Id, advocate2Id],
        createdAt: minutesAgo(1000),
        lastMessageAt: minutesAgo(15),
      });

      const list = [
        convCareTeam,
        convPatientProvider,
        convPatientAdvocate,
        convCareTeam2,
        convCareTeam3,
        convP2Provider,
        convP3Provider,
        convP2Advocate1,
        convGroup4,
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
      ...participantsForConversation(seedPlan.conversations.byId[careTeam1Id], {
        [patientId]: minutesAgo(20),
        [providerId]: minutesAgo(5),
        [advocateId]: minutesAgo(10),
      }),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmPatientProviderId],
        {
          [patientId]: minutesAgo(55),
          [providerId]: minutesAgo(55),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmPatientAdvocateId],
        {
          [patientId]: minutesAgo(12),
          [advocateId]: minutesAgo(30),
        },
      ),

      ...participantsForConversation(seedPlan.conversations.byId[careTeam2Id], {
        [providerId]: minutesAgo(40),
        [advocate2Id]: minutesAgo(120),
      }),

      ...participantsForConversation(seedPlan.conversations.byId[careTeam3Id], {
        [providerId]: minutesAgo(300),
        [advocate2Id]: minutesAgo(90),
        [patient3Id]: minutesAgo(95),
      }),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmP2ProviderId],
        {
          [patient2Id]: minutesAgo(65),
          [providerId]: minutesAgo(200),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmP3ProviderId],
        {
          [patient3Id]: minutesAgo(180),
          [providerId]: minutesAgo(180),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId[dmP2Advocate1Id],
        {
          [patient2Id]: minutesAgo(22),
          [advocateId]: minutesAgo(200),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-group-4"],
        {
          [providerId]: minutesAgo(15),
          [advocate2Id]: minutesAgo(60),
          [provider2Id]: minutesAgo(500),
          [patient2Id]: minutesAgo(300),
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
        m("care-001"),
        careTeam1Id,
        providerId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(119),
      ),
      message(
        m("care-002"),
        careTeam1Id,
        providerId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "TEXT",
        "Hi Jordan — checking in. How are symptoms today?",
        minutesAgo(115),
      ),
      message(
        m("care-003"),
        careTeam1Id,
        patientId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "TEXT",
        "Still some pain, but it’s better than yesterday.",
        minutesAgo(112),
      ),
      message(
        m("care-004"),
        careTeam1Id,
        advocateId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "TEXT",
        "Thanks for the update. I can help coordinate follow-up if needed.",
        minutesAgo(95),
      ),
      message(
        m("care-005"),
        careTeam1Id,
        providerId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "TEXT",
        "Let’s adjust the plan: hydration + rest, and we’ll reassess tomorrow.",
        minutesAgo(60),
      ),
      message(
        m("care-006"),
        careTeam1Id,
        patientId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "TEXT",
        "Sounds good. I can do that.",
        minutesAgo(25),
      ),
      message(
        m("care-007"),
        careTeam1Id,
        providerId,
        seedPlan.conversations.byId[careTeam1Id].memberIds,
        "TEXT",
        "If anything worsens, message here and we’ll respond ASAP.",
        minutesAgo(5),
      ),

      message(
        m("pp-001"),
        dmPatientProviderId,
        patientId,
        seedPlan.conversations.byId[dmPatientProviderId].memberIds,
        "TEXT",
        "Quick question: should I take the medication with food?",
        minutesAgo(80),
      ),
      message(
        m("pp-002"),
        dmPatientProviderId,
        providerId,
        seedPlan.conversations.byId[dmPatientProviderId].memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      message(
        m("pp-003"),
        dmPatientProviderId,
        patientId,
        seedPlan.conversations.byId[dmPatientProviderId].memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(55),
      ),

      message(
        m("pa-001"),
        dmPatientAdvocateId,
        patientId,
        seedPlan.conversations.byId[dmPatientAdvocateId].memberIds,
        "TEXT",
        "Can you help me understand the next steps after the appointment?",
        minutesAgo(25),
      ),
      message(
        m("pa-002"),
        dmPatientAdvocateId,
        advocateId,
        seedPlan.conversations.byId[dmPatientAdvocateId].memberIds,
        "TEXT",
        "Absolutely — I’ll summarize what to expect and what to watch for.",
        minutesAgo(12),
      ),

      message(
        m("ct2-001"),
        careTeam2Id,
        providerId,
        seedPlan.conversations.byId[careTeam2Id].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(590),
      ),
      message(
        m("ct2-002"),
        careTeam2Id,
        patient2Id,
        seedPlan.conversations.byId[careTeam2Id].memberIds,
        "TEXT",
        "I’m not sure which follow-up appointment I should schedule.",
        minutesAgo(120),
      ),
      message(
        m("ct2-003"),
        careTeam2Id,
        advocate2Id,
        seedPlan.conversations.byId[careTeam2Id].memberIds,
        "TEXT",
        "I can help coordinate with the clinic — do you prefer mornings or afternoons?",
        minutesAgo(90),
      ),
      message(
        m("ct2-004"),
        careTeam2Id,
        providerId,
        seedPlan.conversations.byId[careTeam2Id].memberIds,
        "TEXT",
        "Let’s do a 2-week follow-up. Advocate can help schedule it.",
        minutesAgo(70),
      ),
      message(
        m("ct2-005"),
        careTeam2Id,
        patient2Id,
        seedPlan.conversations.byId[careTeam2Id].memberIds,
        "TEXT",
        "Afternoons are better for me.",
        minutesAgo(55),
      ),
      message(
        m("ct2-006"),
        careTeam2Id,
        advocate2Id,
        seedPlan.conversations.byId[careTeam2Id].memberIds,
        "TEXT",
        "Great — I’ll request an afternoon slot and confirm here.",
        minutesAgo(40),
      ),

      message(
        m("ct3-001"),
        careTeam3Id,
        providerId,
        seedPlan.conversations.byId[careTeam3Id].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(880),
      ),
      message(
        m("ct3-002"),
        careTeam3Id,
        patient3Id,
        seedPlan.conversations.byId[careTeam3Id].memberIds,
        "TEXT",
        "The new medication made me dizzy this morning.",
        minutesAgo(400),
      ),
      message(
        m("ct3-003"),
        careTeam3Id,
        providerId,
        seedPlan.conversations.byId[careTeam3Id].memberIds,
        "TEXT",
        "Please take it with food and stay hydrated. If dizziness persists, we’ll adjust.",
        minutesAgo(300),
      ),
      message(
        m("ct3-004"),
        careTeam3Id,
        advocate2Id,
        seedPlan.conversations.byId[careTeam3Id].memberIds,
        "TEXT",
        "I can also help check if transportation or timing is affecting your routine.",
        minutesAgo(90),
      ),

      message(
        m("p2p-001"),
        dmP2ProviderId,
        patient2Id,
        seedPlan.conversations.byId[dmP2ProviderId].memberIds,
        "TEXT",
        "Should I take the medication with food?",
        minutesAgo(80),
      ),
      message(
        m("p2p-002"),
        dmP2ProviderId,
        providerId,
        seedPlan.conversations.byId[dmP2ProviderId].memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      message(
        m("p2p-003"),
        dmP2ProviderId,
        patient2Id,
        seedPlan.conversations.byId[dmP2ProviderId].memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(65),
      ),

      message(
        m("p3p-001"),
        dmP3ProviderId,
        providerId,
        seedPlan.conversations.byId[dmP3ProviderId].memberIds,
        "TEXT",
        "Checking in — any changes since last visit?",
        minutesAgo(200),
      ),
      message(
        m("p3p-002"),
        dmP3ProviderId,
        patient3Id,
        seedPlan.conversations.byId[dmP3ProviderId].memberIds,
        "TEXT",
        "Much better overall. Sleep improved.",
        minutesAgo(180),
      ),

      message(
        m("p2a1-001"),
        dmP2Advocate1Id,
        patient2Id,
        seedPlan.conversations.byId[dmP2Advocate1Id].memberIds,
        "TEXT",
        "Can you explain what I should expect after the appointment?",
        minutesAgo(60),
      ),
      message(
        m("p2a1-002"),
        dmP2Advocate1Id,
        advocateId,
        seedPlan.conversations.byId[dmP2Advocate1Id].memberIds,
        "TEXT",
        "Absolutely — I’ll summarize next steps and what to watch for.",
        minutesAgo(35),
      ),
      message(
        m("p2a1-003"),
        dmP2Advocate1Id,
        patient2Id,
        seedPlan.conversations.byId[dmP2Advocate1Id].memberIds,
        "TEXT",
        "Thank you — that helps a lot.",
        minutesAgo(22),
      ),

      message(
        m("g4-001"),
        "demo-group-4",
        providerId,
        seedPlan.conversations.byId["demo-group-4"].memberIds,
        "SYSTEM",
        "Second opinion group created.",
        minutesAgo(980),
      ),
      message(
        m("g4-002"),
        "demo-group-4",
        provider2Id,
        seedPlan.conversations.byId["demo-group-4"].memberIds,
        "TEXT",
        "Happy to review the case — can you share the latest lab results summary?",
        minutesAgo(120),
      ),
      message(
        m("g4-003"),
        "demo-group-4",
        providerId,
        seedPlan.conversations.byId["demo-group-4"].memberIds,
        "TEXT",
        "Yes — sending a brief summary here now.",
        minutesAgo(40),
      ),
      message(
        m("g4-004"),
        "demo-group-4",
        advocate2Id,
        seedPlan.conversations.byId["demo-group-4"].memberIds,
        "TEXT",
        "Once reviewed, I can help coordinate scheduling and insurance questions.",
        minutesAgo(15),
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
      mode,
      scenario,
      resolvedIds: { patientId, providerId, advocateId },
      deleted: deleteSummary,
      seeded: seedSummary,
      ids: {
        providerPatientIds: seedPlan.providerPatients.map((p) => p.id),
        advocateAssignmentIds: seedPlan.advocateAssignments.map((a) => a.id),
        conversationIds: seedPlan.conversations.list.map((c) => c.id),
      },
      notes: {
        modelTimestamps: "All @model seed items include createdAt + updatedAt",
        schemaDrift: "No ConversationParticipant.role written",
        removedChat: '"System Updates" conversation fully removed',
        deterministicIds:
          "Care team uses CARE_TEAM:${patientId}:${providerId}; DMs use DM:${minId}:${maxId}; ProviderPatient uses PP:${providerId}:${patientId}; AdvocateAssignment uses PA:${patientId}:PR:${providerId}:ADV:${advocateId}",
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
