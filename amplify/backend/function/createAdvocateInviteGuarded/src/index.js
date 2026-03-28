/* Amplify Params - DO NOT EDIT
  ENV
  REGION
  TABLE_ADVOCATE_ASSIGNMENT
  TABLE_ADVOCATE_INVITE
  TABLE_CONVERSATION
Amplify Params - DO NOT EDIT */

"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const region = process.env.AWS_REGION || process.env.REGION;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_ADVOCATE_ASSIGNMENT =
  process.env.STORAGE_HEALTHCONNECT_ADVOCATEASSIGNMENT_NAME ||
  process.env.TABLE_ADVOCATE_ASSIGNMENT;

const TABLE_ADVOCATE_INVITE =
  process.env.STORAGE_HEALTHCONNECT_ADVOCATEINVITE_NAME ||
  process.env.TABLE_ADVOCATE_INVITE;

const TABLE_CONVERSATION =
  process.env.STORAGE_HEALTHCONNECT_CONVERSATION_NAME ||
  process.env.TABLE_CONVERSATION;

const log = (...args) =>
  console.log("[CREATE_ADVOCATE_INVITE_GUARDED]", ...args);

const fail = (code, message, extra = {}) => {
  const err = new Error(message);
  err.name = code;
  err.code = code;
  Object.assign(err, extra);
  throw err;
};

const isoNow = () => new Date().toISOString();

const careTeamConversationId = ({ patientId, providerId }) =>
  `CARE_TEAM:${patientId}:${providerId}`;

const advocateAssignmentId = ({ patientId, providerId, advocateId }) =>
  `PA:${patientId}:PR:${providerId}:ADV:${advocateId}`;

const advocateInviteId = ({ patientId, advocateId, conversationId }) =>
  `ADVOCATE_INVITE:PATIENT:${patientId}:ADVOCATE:${advocateId}:CONVERSATION:${conversationId}`;

const getCallerSub = (event) =>
  event?.identity?.sub ||
  event?.identity?.claims?.sub ||
  event?.requestContext?.identity?.sub ||
  null;

exports.handler = async (event) => {
  const patientId = event?.arguments?.patientId;
  const providerId = event?.arguments?.providerId;
  const advocateId = event?.arguments?.advocateId;
  const createdBy = getCallerSub(event);

  if (
    !TABLE_ADVOCATE_ASSIGNMENT ||
    !TABLE_ADVOCATE_INVITE ||
    !TABLE_CONVERSATION
  ) {
    fail("CONFIG_ERROR", "Missing required table configuration.");
  }

  if (!patientId || !providerId || !advocateId) {
    fail(
      "INVALID_INPUT",
      "patientId, providerId, and advocateId are required.",
    );
  }

  if (!createdBy) {
    fail("UNAUTHORIZED", "Unable to determine caller identity.");
  }

  const conversationId = careTeamConversationId({ patientId, providerId });
  const assignmentId = advocateAssignmentId({
    patientId,
    providerId,
    advocateId,
  });
  const inviteId = advocateInviteId({
    patientId,
    advocateId,
    conversationId,
  });

  const conversationResp = await ddb.send(
    new GetCommand({
      TableName: TABLE_CONVERSATION,
      Key: { id: conversationId },
    }),
  );

  const conversation = conversationResp?.Item;

  if (!conversation) {
    fail(
      "CARE_TEAM_CONVERSATION_NOT_FOUND",
      `Conversation ${conversationId} not found.`,
    );
  }

  const memberIds = Array.isArray(conversation.memberIds)
    ? conversation.memberIds
    : [];

  if (memberIds.includes(advocateId)) {
    fail(
      "ADVOCATE_ALREADY_IN_CONVERSATION",
      "Advocate is already in the care team conversation.",
    );
  }

  const assignmentResp = await ddb.send(
    new GetCommand({
      TableName: TABLE_ADVOCATE_ASSIGNMENT,
      Key: { id: assignmentId },
    }),
  );

  if (assignmentResp?.Item?.active === true) {
    fail(
      "ACTIVE_ASSIGNMENT_EXISTS",
      "Active advocate assignment already exists.",
    );
  }

  const existingInviteResp = await ddb.send(
    new GetCommand({
      TableName: TABLE_ADVOCATE_INVITE,
      Key: { id: inviteId },
    }),
  );

  if (existingInviteResp?.Item?.status === "PENDING") {
    fail("PENDING_INVITE_EXISTS", "A pending invite already exists.");
  }

  const now = isoNow();

  const item = {
    id: inviteId,
    patientId,
    advocateId,
    conversationId,
    status: "PENDING",
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_ADVOCATE_INVITE,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  } catch (error) {
    if (
      error?.name === "ConditionalCheckFailedException" ||
      error?.name === "ConditionalCheckFailed"
    ) {
      fail("PENDING_INVITE_EXISTS", "A pending invite already exists.");
    }

    throw error;
  }

  log("Invite created", { inviteId });

  return item;
};
