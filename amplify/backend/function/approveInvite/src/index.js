/* Amplify Params - DO NOT EDIT
  API_HEALTHCONNECT_GRAPHQLAPIENDPOINTOUTPUT
  API_HEALTHCONNECT_GRAPHQLAPIIDOUTPUT
  ENV
  REGION
Amplify Params - DO NOT EDIT */
"use strict";

const crypto = require("crypto");

const {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} = require("@aws-sdk/client-dynamodb");

const ddb = new DynamoDBClient({
  region: process.env.AWS_REGION || process.env.REGION,
});

const {
  TABLE_ADVOCATE_INVITE,
  TABLE_CONVERSATION,
  TABLE_ADVOCATE_ASSIGNMENT,
  TABLE_CONVERSATION_PARTICIPANT,
  TABLE_MESSAGE,
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const INVITE_TABLE = requireEnv("TABLE_ADVOCATE_INVITE", TABLE_ADVOCATE_INVITE);
const CONVO_TABLE = requireEnv("TABLE_CONVERSATION", TABLE_CONVERSATION);
const ADVOCATE_ASSIGNMENT_TABLE = requireEnv(
  "TABLE_ADVOCATE_ASSIGNMENT",
  TABLE_ADVOCATE_ASSIGNMENT,
);
const CONVO_PARTICIPANT_TABLE = requireEnv(
  "TABLE_CONVERSATION_PARTICIPANT",
  TABLE_CONVERSATION_PARTICIPANT,
);
const MESSAGE_TABLE = requireEnv("TABLE_MESSAGE", TABLE_MESSAGE);

function unmarshallStringArray(attr) {
  if (!attr || !attr.L) return [];
  return attr.L.map((x) => x.S);
}

function makeClientRequestToken(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 36);
}

exports.handler = async (event) => {
  console.log("event:", JSON.stringify(event, null, 2));

  try {
    const sub = event?.identity?.sub;
    const inviteId = event?.arguments?.inviteId;

    if (!sub) throw new Error("Unauthorized: missing identity");
    if (!inviteId) throw new Error("Missing inviteId");

    const inviteRes = await ddb.send(
      new GetItemCommand({
        TableName: INVITE_TABLE,
        Key: { id: { S: inviteId } },
      }),
    );

    const inv = inviteRes.Item;
    if (!inv) throw new Error("Invite not found");

    const advocateId = inv.advocateId?.S;
    const patientId = inv.patientId?.S;
    const status = inv.status?.S;
    const conversationId = inv.conversationId?.S;
    const providerId = inv.providerId?.S;

    if (advocateId !== sub) throw new Error("Unauthorized: wrong advocate");
    if (status !== "PENDING") throw new Error(`Invalid status: ${status}`);
    if (!conversationId) throw new Error("Invite missing conversationId");
    if (!providerId) throw new Error("Invite missing providerId");
    if (!patientId) throw new Error("Invite missing patientId");

    const convoRes = await ddb.send(
      new GetItemCommand({
        TableName: CONVO_TABLE,
        Key: { id: { S: conversationId } },
      }),
    );

    const convo = convoRes.Item;
    if (!convo) throw new Error("Conversation not found");

    const existingMembers = unmarshallStringArray(convo.memberIds);
    const unique = Array.from(
      new Set([...(existingMembers || []), advocateId]),
    );

    const existingMemberIdsList = {
      L: (existingMembers || []).map((v) => ({ S: v })),
    };

    const memberIdsList = {
      L: unique.map((v) => ({ S: v })),
    };

    const now = new Date().toISOString();
    const assignmentId = `PA:${patientId}:PR:${providerId}:ADV:${advocateId}`;
    const participantId = `${conversationId}:${advocateId}`;
    const msgId = `SYS:INVITE_APPROVED:${inviteId}`;
    const clientRequestToken = makeClientRequestToken(inviteId);

    await ddb.send(
      new TransactWriteItemsCommand({
        ClientRequestToken: clientRequestToken,
        TransactItems: [
          {
            Update: {
              TableName: INVITE_TABLE,
              Key: { id: { S: inviteId } },
              ConditionExpression: "#s = :p",
              UpdateExpression:
                "SET #s = :a, approvedBy = :by, approvedAt = :t, updatedAt = :u",
              ExpressionAttributeNames: {
                "#s": "status",
              },
              ExpressionAttributeValues: {
                ":p": { S: "PENDING" },
                ":a": { S: "APPROVED" },
                ":by": { S: advocateId },
                ":t": { S: now },
                ":u": { S: now },
              },
            },
          },
          {
            Update: {
              TableName: CONVO_TABLE,
              Key: { id: { S: conversationId } },
              ConditionExpression: "memberIds = :expectedMembers",
              UpdateExpression: "SET memberIds = :m, updatedAt = :u",
              ExpressionAttributeValues: {
                ":expectedMembers": existingMemberIdsList,
                ":m": memberIdsList,
                ":u": { S: now },
              },
            },
          },
          {
            Put: {
              TableName: ADVOCATE_ASSIGNMENT_TABLE,
              ConditionExpression: "attribute_not_exists(id)",
              Item: {
                id: { S: assignmentId },
                patientId: { S: patientId },
                providerId: { S: providerId },
                advocateId: { S: advocateId },
                active: { BOOL: true },
                createdAt: { S: now },
                updatedAt: { S: now },
              },
            },
          },
          {
            Put: {
              TableName: CONVO_PARTICIPANT_TABLE,
              ConditionExpression: "attribute_not_exists(id)",
              Item: {
                id: { S: participantId },
                userId: { S: advocateId },
                conversationId: { S: conversationId },
                createdAt: { S: now },
                updatedAt: { S: now },
              },
            },
          },
          {
            Put: {
              TableName: MESSAGE_TABLE,
              ConditionExpression: "attribute_not_exists(id)",
              Item: {
                id: { S: msgId },
                conversationId: { S: conversationId },
                senderId: { S: "system" },
                memberIds: memberIdsList,
                type: { S: "SYSTEM" },
                body: { S: "An advocate has joined the conversation." },
                createdAt: { S: now },
                updatedAt: { S: now },
              },
            },
          },
        ],
      }),
    );

    return {
      id: inviteId,
      patientId,
      advocateId,
      conversationId,
      status: "APPROVED",
      approvedBy: advocateId,
      approvedAt: now,
    };
  } catch (err) {
    console.error("approveInvite error", err);
    throw err;
  }
};
