/* Amplify Params - DO NOT EDIT
	API_HEALTHCONNECT_GRAPHQLAPIENDPOINTOUTPUT
	API_HEALTHCONNECT_GRAPHQLAPIIDOUTPUT
	ENV
	REGION
Amplify Params - DO NOT EDIT */
"use strict";

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require("@aws-sdk/client-dynamodb");

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });

const INVITE_TABLE = "AdvocateInvite-5izqvjgcw5e5zdbimlgzknen3m-dev";
const CONVO_TABLE = "Conversation-5izqvjgcw5e5zdbimlgzknen3m-dev";

function unmarshallStringArray(attr) {
  if (!attr || !attr.L) return [];
  return attr.L.map((x) => x.S);
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

    if (advocateId !== sub) throw new Error("Unauthorized: wrong advocate");
    if (status !== "PENDING") throw new Error(`Invalid status: ${status}`);
    if (!conversationId) throw new Error("Invite missing conversationId");

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
    const memberIdsList = { L: unique.map((v) => ({ S: v })) };

    const now = new Date().toISOString();

    await ddb.send(
      new UpdateItemCommand({
        TableName: CONVO_TABLE,
        Key: { id: { S: conversationId } },
        UpdateExpression: "SET memberIds = :m, updatedAt = :u",
        ExpressionAttributeValues: {
          ":m": memberIdsList,
          ":u": { S: now },
        },
      }),
    );

    await ddb.send(
      new UpdateItemCommand({
        TableName: INVITE_TABLE,
        Key: { id: { S: inviteId } },
        ConditionExpression: "#s = :p",
        UpdateExpression:
          "SET #s = :a, approvedBy = :by, approvedAt = :t, updatedAt = :u",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":p": { S: "PENDING" },
          ":a": { S: "APPROVED" },
          ":by": { S: advocateId },
          ":t": { S: now },
          ":u": { S: now },
        },
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
