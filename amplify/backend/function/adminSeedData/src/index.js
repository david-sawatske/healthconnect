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
          id: "demo-provider-patient",
          providerId,
          patientId,
        }),

        withModelTimestamps({
          id: "demo-pp-jordan-2",
          providerId: provider2Id,
          patientId,
        }),

        withModelTimestamps({
          id: "demo-pp-2",
          providerId,
          patientId: patient2Id,
        }),
        withModelTimestamps({
          id: "demo-pp-3",
          providerId,
          patientId: patient3Id,
        }),
        withModelTimestamps({
          id: "demo-pp-4",
          providerId: provider2Id,
          patientId: patient2Id,
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

        withModelTimestamps({
          id: "demo-aa-jordan-2",
          providerId: provider2Id,
          patientId,
          advocateId: advocate2Id,
          active: true,
        }),

        withModelTimestamps({
          id: "demo-aa-2",
          providerId,
          patientId: patient2Id,
          advocateId: advocate2Id,
          active: true,
        }),
        withModelTimestamps({
          id: "demo-aa-3",
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
        id: "demo-care-team-conv",
        title: "Care Team Chat",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patientId, providerId, advocateId],
        createdAt: minutesAgo(120),
        lastMessageAt: minutesAgo(5),
      });

      const convPatientProvider = conv({
        id: "demo-patient-provider-conv",
        title: null,
        isGroup: false,
        createdBy: patientId,
        memberIds: [patientId, providerId],
        createdAt: minutesAgo(240),
        lastMessageAt: minutesAgo(55),
      });

      const convPatientAdvocate = conv({
        id: "demo-patient-advocate-conv",
        title: null,
        isGroup: false,
        createdBy: advocateId,
        memberIds: [patientId, advocateId],
        createdAt: minutesAgo(180),
        lastMessageAt: minutesAgo(12),
      });

      const convCareTeam2 = conv({
        id: "demo-care-team-2",
        title: "Care Team — Morgan",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patient2Id, providerId, advocate2Id],
        createdAt: minutesAgo(600),
        lastMessageAt: minutesAgo(40),
      });

      const convCareTeam3 = conv({
        id: "demo-care-team-3",
        title: "Care Team — Taylor",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patient3Id, providerId, advocate2Id],
        createdAt: minutesAgo(900),
        lastMessageAt: minutesAgo(90),
      });

      const convP2Provider = conv({
        id: "demo-p2-provider",
        title: null,
        isGroup: false,
        createdBy: patient2Id,
        memberIds: [patient2Id, providerId],
        createdAt: minutesAgo(700),
        lastMessageAt: minutesAgo(65),
      });

      const convP3Provider = conv({
        id: "demo-p3-provider",
        title: null,
        isGroup: false,
        createdBy: providerId,
        memberIds: [patient3Id, providerId],
        createdAt: minutesAgo(800),
        lastMessageAt: minutesAgo(180),
      });

      const convP2Advocate1 = conv({
        id: "demo-p2-advocate1",
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

      const convLongTitle = conv({
        id: "demo-long-title",
        title:
          "Long Title Test — Care Team Coordination for Follow-Up, Labs, Rx, and Scheduling",
        isGroup: true,
        createdBy: providerId,
        memberIds: [patientId, providerId, advocateId, advocate2Id],
        createdAt: minutesAgo(300),
        lastMessageAt: minutesAgo(8),
      });

      const convEmpty = conv({
        id: "demo-empty-thread",
        title: null,
        isGroup: false,
        createdBy: patientId,
        memberIds: [patientId, providerId],
        createdAt: minutesAgo(30),
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
        convLongTitle,
        convEmpty,
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
        seedPlan.conversations.byId["demo-care-team-conv"],
        {
          [patientId]: minutesAgo(20),
          [providerId]: minutesAgo(5),
          [advocateId]: minutesAgo(10),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-patient-provider-conv"],
        {
          [patientId]: minutesAgo(55),
          [providerId]: minutesAgo(55),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-patient-advocate-conv"],
        {
          [patientId]: minutesAgo(12),
          [advocateId]: minutesAgo(30),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-care-team-2"],
        {
          [providerId]: minutesAgo(40),
          [advocate2Id]: minutesAgo(120),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-care-team-3"],
        {
          [providerId]: minutesAgo(300),
          [advocate2Id]: minutesAgo(90),
          [patient3Id]: minutesAgo(95),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-p2-provider"],
        {
          [patient2Id]: minutesAgo(65),
          [providerId]: minutesAgo(200),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-p3-provider"],
        {
          [patient3Id]: minutesAgo(180),
          [providerId]: minutesAgo(180),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-p2-advocate1"],
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

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-long-title"],
        {
          [patientId]: minutesAgo(120),
          [providerId]: minutesAgo(8),
          [advocateId]: minutesAgo(10),
        },
      ),

      ...participantsForConversation(
        seedPlan.conversations.byId["demo-empty-thread"],
        {},
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
        "demo-care-team-conv",
        providerId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(119),
      ),
      message(
        m("care-002"),
        "demo-care-team-conv",
        providerId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "TEXT",
        "Hi Jordan — checking in. How are symptoms today?",
        minutesAgo(115),
      ),
      message(
        m("care-003"),
        "demo-care-team-conv",
        patientId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "TEXT",
        "Still some pain, but it’s better than yesterday.",
        minutesAgo(112),
      ),
      message(
        m("care-004"),
        "demo-care-team-conv",
        advocateId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "TEXT",
        "Thanks for the update. I can help coordinate follow-up if needed.",
        minutesAgo(95),
      ),
      message(
        m("care-005"),
        "demo-care-team-conv",
        providerId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "TEXT",
        "Let’s adjust the plan: hydration + rest, and we’ll reassess tomorrow.",
        minutesAgo(60),
      ),
      message(
        m("care-006"),
        "demo-care-team-conv",
        patientId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "TEXT",
        "Sounds good. I can do that.",
        minutesAgo(25),
      ),
      message(
        m("care-007"),
        "demo-care-team-conv",
        providerId,
        seedPlan.conversations.byId["demo-care-team-conv"].memberIds,
        "TEXT",
        "If anything worsens, message here and we’ll respond ASAP.",
        minutesAgo(5),
      ),

      message(
        m("pp-001"),
        "demo-patient-provider-conv",
        patientId,
        seedPlan.conversations.byId["demo-patient-provider-conv"].memberIds,
        "TEXT",
        "Quick question: should I take the medication with food?",
        minutesAgo(80),
      ),
      message(
        m("pp-002"),
        "demo-patient-provider-conv",
        providerId,
        seedPlan.conversations.byId["demo-patient-provider-conv"].memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      message(
        m("pp-003"),
        "demo-patient-provider-conv",
        patientId,
        seedPlan.conversations.byId["demo-patient-provider-conv"].memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(55),
      ),

      message(
        m("pa-001"),
        "demo-patient-advocate-conv",
        patientId,
        seedPlan.conversations.byId["demo-patient-advocate-conv"].memberIds,
        "TEXT",
        "Can you help me understand the next steps after the appointment?",
        minutesAgo(25),
      ),
      message(
        m("pa-002"),
        "demo-patient-advocate-conv",
        advocateId,
        seedPlan.conversations.byId["demo-patient-advocate-conv"].memberIds,
        "TEXT",
        "Absolutely — I’ll summarize what to expect and what to watch for.",
        minutesAgo(12),
      ),

      message(
        m("ct2-001"),
        "demo-care-team-2",
        providerId,
        seedPlan.conversations.byId["demo-care-team-2"].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(590),
      ),
      message(
        m("ct2-002"),
        "demo-care-team-2",
        patient2Id,
        seedPlan.conversations.byId["demo-care-team-2"].memberIds,
        "TEXT",
        "I’m not sure which follow-up appointment I should schedule.",
        minutesAgo(120),
      ),
      message(
        m("ct2-003"),
        "demo-care-team-2",
        advocate2Id,
        seedPlan.conversations.byId["demo-care-team-2"].memberIds,
        "TEXT",
        "I can help coordinate with the clinic — do you prefer mornings or afternoons?",
        minutesAgo(90),
      ),
      message(
        m("ct2-004"),
        "demo-care-team-2",
        providerId,
        seedPlan.conversations.byId["demo-care-team-2"].memberIds,
        "TEXT",
        "Let’s do a 2-week follow-up. Advocate can help schedule it.",
        minutesAgo(70),
      ),
      message(
        m("ct2-005"),
        "demo-care-team-2",
        patient2Id,
        seedPlan.conversations.byId["demo-care-team-2"].memberIds,
        "TEXT",
        "Afternoons are better for me.",
        minutesAgo(55),
      ),
      message(
        m("ct2-006"),
        "demo-care-team-2",
        advocate2Id,
        seedPlan.conversations.byId["demo-care-team-2"].memberIds,
        "TEXT",
        "Great — I’ll request an afternoon slot and confirm here.",
        minutesAgo(40),
      ),

      message(
        m("ct3-001"),
        "demo-care-team-3",
        providerId,
        seedPlan.conversations.byId["demo-care-team-3"].memberIds,
        "SYSTEM",
        "Care team chat created.",
        minutesAgo(880),
      ),
      message(
        m("ct3-002"),
        "demo-care-team-3",
        patient3Id,
        seedPlan.conversations.byId["demo-care-team-3"].memberIds,
        "TEXT",
        "The new medication made me dizzy this morning.",
        minutesAgo(400),
      ),
      message(
        m("ct3-003"),
        "demo-care-team-3",
        providerId,
        seedPlan.conversations.byId["demo-care-team-3"].memberIds,
        "TEXT",
        "Please take it with food and stay hydrated. If dizziness persists, we’ll adjust.",
        minutesAgo(300),
      ),
      message(
        m("ct3-004"),
        "demo-care-team-3",
        advocate2Id,
        seedPlan.conversations.byId["demo-care-team-3"].memberIds,
        "TEXT",
        "I can also help check if transportation or timing is affecting your routine.",
        minutesAgo(90),
      ),

      message(
        m("p2p-001"),
        "demo-p2-provider",
        patient2Id,
        seedPlan.conversations.byId["demo-p2-provider"].memberIds,
        "TEXT",
        "Should I take the medication with food?",
        minutesAgo(80),
      ),
      message(
        m("p2p-002"),
        "demo-p2-provider",
        providerId,
        seedPlan.conversations.byId["demo-p2-provider"].memberIds,
        "TEXT",
        "Yes — with a small meal is best.",
        minutesAgo(70),
      ),
      message(
        m("p2p-003"),
        "demo-p2-provider",
        patient2Id,
        seedPlan.conversations.byId["demo-p2-provider"].memberIds,
        "TEXT",
        "Got it. Thanks!",
        minutesAgo(65),
      ),

      message(
        m("p3p-001"),
        "demo-p3-provider",
        providerId,
        seedPlan.conversations.byId["demo-p3-provider"].memberIds,
        "TEXT",
        "Checking in — any changes since last visit?",
        minutesAgo(200),
      ),
      message(
        m("p3p-002"),
        "demo-p3-provider",
        patient3Id,
        seedPlan.conversations.byId["demo-p3-provider"].memberIds,
        "TEXT",
        "Much better overall. Sleep improved.",
        minutesAgo(180),
      ),

      message(
        m("p2a1-001"),
        "demo-p2-advocate1",
        patient2Id,
        seedPlan.conversations.byId["demo-p2-advocate1"].memberIds,
        "TEXT",
        "Can you explain what I should expect after the appointment?",
        minutesAgo(60),
      ),
      message(
        m("p2a1-002"),
        "demo-p2-advocate1",
        advocateId,
        seedPlan.conversations.byId["demo-p2-advocate1"].memberIds,
        "TEXT",
        "Absolutely — I’ll summarize next steps and what to watch for.",
        minutesAgo(35),
      ),
      message(
        m("p2a1-003"),
        "demo-p2-advocate1",
        patient2Id,
        seedPlan.conversations.byId["demo-p2-advocate1"].memberIds,
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

      message(
        m("lt-001"),
        "demo-long-title",
        providerId,
        seedPlan.conversations.byId["demo-long-title"].memberIds,
        "SYSTEM",
        "Care coordination thread created.",
        minutesAgo(250),
      ),
      message(
        m("lt-002"),
        "demo-long-title",
        patientId,
        seedPlan.conversations.byId["demo-long-title"].memberIds,
        "TEXT",
        "I’m confused about labs vs follow-up timing. Which comes first?",
        minutesAgo(120),
      ),
      message(
        m("lt-003"),
        "demo-long-title",
        providerId,
        seedPlan.conversations.byId["demo-long-title"].memberIds,
        "TEXT",
        "Labs first this week, then follow-up next week. Advocate can help schedule.",
        minutesAgo(8),
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
        emptyThread: "demo-empty-thread intentionally has 0 messages",
        removedChat: '"System Updates" conversation fully removed',
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
