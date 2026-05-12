/* Amplify Params - DO NOT EDIT
	ENV
	REGION
	TABLE_USER
	TABLE_PROVIDER_PATIENT
	TABLE_CONVERSATION
	TABLE_CONVERSATION_PARTICIPANT
	TABLE_MESSAGE
	TABLE_ADVOCATE_INVITE
	TABLE_ADVOCATE_ASSIGNMENT
Amplify Params - DO NOT EDIT */

/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
exports.handler = async (event) => {
  console.log("[adminManageUsers] event =", JSON.stringify(event));

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
    body: JSON.stringify({
      ok: true,
      message: "adminManageUsers Lambda is working",
    }),
  };
};
