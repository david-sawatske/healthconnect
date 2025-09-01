import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION });

const INVITE_TABLE = process.env.API_HEALTHCONNECT_ADVOCATEINVITETABLE_NAME;
const CONVO_TABLE = process.env.API_HEALTHCONNECT_CONVERSATIONTABLE_NAME;

function unmarshallStringArray(attr) {
  if (!attr) return [];
  if (attr.L) return attr.L.map((x) => x.S);
  return [];
}

export const handler = async (event) => {
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

    if (advocateId !== sub) {
      throw new Error("Unauthorized: only invited advocate can approve");
    }
    if (status !== "PENDING") {
      throw new Error(`Invalid status: ${status}`);
    }

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
        ConditionExpression: "status = :p",
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
