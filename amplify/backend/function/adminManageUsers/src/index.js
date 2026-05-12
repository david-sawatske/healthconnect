/* Amplify Params - DO NOT EDIT
	AUTH_HEALTHCONNECT97A44150_USERPOOLID
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

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const ADMIN_GROUP = "Admin";
const ADMIN_GROUP_ROLE_NAME = "AdminGroupRole";

const ALLOWED_CREATE_USER_ROLES = new Set(["PATIENT", "PROVIDER", "ADVOCATE"]);

const region = process.env.REGION || process.env.AWS_REGION;

const cognito = new CognitoIdentityProviderClient({ region });

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const isMissingOrPlaceholder = (value) =>
  !value || value === "PH" || value.startsWith("PLACEHOLDER");

const isConfiguredEnvValue = (value) => !isMissingOrPlaceholder(value);

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const ok = (body = {}) =>
  jsonResponse(200, {
    ok: true,
    ...body,
  });

const badRequest = (message, details = undefined) =>
  jsonResponse(400, {
    ok: false,
    error: "BAD_REQUEST",
    message,
    ...(details ? { details } : {}),
  });

const forbidden = (message = "Admin access required") =>
  jsonResponse(403, {
    ok: false,
    error: "FORBIDDEN",
    message,
  });

const serverError = (message = "Internal server error") =>
  jsonResponse(500, {
    ok: false,
    error: "SERVER_ERROR",
    message,
  });

const parseBody = (event) => {
  if (!event?.body) return {};

  if (typeof event.body === "object") {
    return event.body;
  }

  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
};

const getCallerGroups = (event) => {
  const claims =
    event?.requestContext?.authorizer?.claims ||
    event?.requestContext?.authorizer?.jwt?.claims ||
    {};

  const rawGroups =
    claims["cognito:groups"] || claims["custom:groups"] || claims.groups || [];

  if (Array.isArray(rawGroups)) return rawGroups;

  if (typeof rawGroups === "string") {
    return rawGroups
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean);
  }

  return [];
};

const getCallerUserArn = (event) =>
  event?.requestContext?.identity?.userArn || "";

const isAdminIamRoleCaller = (event) => {
  const userArn = getCallerUserArn(event);

  return (
    typeof userArn === "string" &&
    userArn.includes(":assumed-role/") &&
    userArn.includes(ADMIN_GROUP_ROLE_NAME)
  );
};

const isAdminCaller = (event) => {
  const groups = getCallerGroups(event);

  return groups.includes(ADMIN_GROUP) || isAdminIamRoleCaller(event);
};

const normalizeEmail = (email) => {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
};

const normalizeName = (name) => {
  if (typeof name !== "string") return "";
  return name.trim();
};

const validateCreateUserInput = (body) => {
  const user = body?.user;

  if (!user || typeof user !== "object") {
    return {
      valid: false,
      message: "user object is required",
    };
  }

  const role = user.role;
  const email = normalizeEmail(user.email);
  const displayName = normalizeName(user.name);

  if (!ALLOWED_CREATE_USER_ROLES.has(role)) {
    return {
      valid: false,
      message: "user.role must be PATIENT, PROVIDER, or ADVOCATE",
    };
  }

  if (!displayName) {
    return {
      valid: false,
      message: "user.name is required",
    };
  }

  if (!email) {
    return {
      valid: false,
      message: "user.email is required",
    };
  }

  if (!email.includes("@")) {
    return {
      valid: false,
      message: "user.email must be a valid email address",
    };
  }

  return {
    valid: true,
    user: {
      role,
      email,
      displayName,
    },
  };
};

const getUserPoolId = () => {
  const userPoolId = process.env.AUTH_HEALTHCONNECT97A44150_USERPOOLID;

  if (isMissingOrPlaceholder(userPoolId)) {
    throw new Error("AUTH_HEALTHCONNECT97A44150_USERPOOLID is not configured");
  }

  return userPoolId;
};

const getUserTableName = () => {
  const tableName = process.env.TABLE_USER;

  if (isMissingOrPlaceholder(tableName)) {
    throw new Error("TABLE_USER is not configured with a real table name");
  }

  return tableName;
};

const getAttributeValue = (attributes = [], name) => {
  const attr = attributes.find((item) => item.Name === name);
  return attr?.Value || null;
};

const toCognitoUserSummaryFromAdminGetUser = (result, email) => ({
  username: result.Username,
  sub: getAttributeValue(result.UserAttributes, "sub"),
  email: getAttributeValue(result.UserAttributes, "email") || email,
  status: result.UserStatus,
  enabled: result.Enabled,
});

const toCognitoUserSummaryFromAdminCreateUser = (result, email) => ({
  username: result.User?.Username,
  sub: getAttributeValue(result.User?.Attributes, "sub"),
  email: getAttributeValue(result.User?.Attributes, "email") || email,
  status: result.User?.UserStatus,
  enabled: result.User?.Enabled,
});

const getCognitoUserByEmail = async (email) => {
  const userPoolId = getUserPoolId();

  try {
    const result = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    );

    return toCognitoUserSummaryFromAdminGetUser(result, email);
  } catch (error) {
    if (error?.name === "UserNotFoundException") {
      return null;
    }

    throw error;
  }
};

const createCognitoUser = async ({ email, displayName }) => {
  const userPoolId = getUserPoolId();

  const result = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: userPoolId,
      Username: email,
      MessageAction: "SUPPRESS",
      UserAttributes: [
        {
          Name: "email",
          Value: email,
        },
        {
          Name: "email_verified",
          Value: "true",
        },
        {
          Name: "name",
          Value: displayName,
        },
      ],
    }),
  );

  return toCognitoUserSummaryFromAdminCreateUser(result, email);
};

const ensureCognitoUser = async ({ email, displayName }) => {
  const existingUser = await getCognitoUserByEmail(email);

  if (existingUser) {
    return {
      created: false,
      user: existingUser,
    };
  }

  try {
    const createdUser = await createCognitoUser({ email, displayName });

    return {
      created: true,
      user: createdUser,
    };
  } catch (error) {
    if (error?.name === "UsernameExistsException") {
      const user = await getCognitoUserByEmail(email);

      if (user) {
        return {
          created: false,
          user,
        };
      }
    }

    throw error;
  }
};

const getUserProfile = async (id) => {
  const tableName = getUserTableName();

  const result = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: { id },
    }),
  );

  return result.Item || null;
};

const ensureUserProfile = async ({ cognitoUser, userInput }) => {
  const tableName = getUserTableName();
  const now = new Date().toISOString();

  if (!cognitoUser?.sub) {
    throw new Error("Cognito user sub is required to create User profile");
  }

  const existingProfile = await getUserProfile(cognitoUser.sub);

  const userProfile = existingProfile
    ? {
        ...existingProfile,
        email: userInput.email,
        displayName: userInput.displayName,
        role: userInput.role,
        avatarKey: Object.prototype.hasOwnProperty.call(
          existingProfile,
          "avatarKey",
        )
          ? existingProfile.avatarKey
          : null,
        updatedAt: now,
      }
    : {
        id: cognitoUser.sub,
        email: userInput.email,
        displayName: userInput.displayName,
        role: userInput.role,
        avatarKey: null,
        createdAt: now,
        updatedAt: now,
      };

  await dynamo.send(
    new PutCommand({
      TableName: tableName,
      Item: userProfile,
    }),
  );

  return {
    created: !existingProfile,
    user: userProfile,
  };
};

const getConfigStatus = () => ({
  tableUserConfigured: isConfiguredEnvValue(process.env.TABLE_USER),
  userPoolConfigured: isConfiguredEnvValue(
    process.env.AUTH_HEALTHCONNECT97A44150_USERPOOLID,
  ),
});

const handleCreateUser = async (body) => {
  const validation = validateCreateUserInput(body);

  if (!validation.valid) {
    return badRequest(validation.message);
  }

  const cognitoResult = await ensureCognitoUser(validation.user);

  const profileResult = await ensureUserProfile({
    cognitoUser: cognitoResult.user,
    userInput: validation.user,
  });

  return ok({
    action: "CREATE_USER",
    message: profileResult.created
      ? "User created successfully."
      : "User already existed. Profile updated successfully.",
    user: profileResult.user,
    cognitoUserCreated: cognitoResult.created,
    userProfileCreated: profileResult.created,
    cognitoUser: cognitoResult.user,
    ...getConfigStatus(),
  });
};

/**
 * @type {import('@types/aws-lambda').APIGatewayProxyHandler}
 */
exports.handler = async (event) => {
  console.log("[adminManageUsers] route =", {
    path: event?.path,
    httpMethod: event?.httpMethod,
    resource: event?.resource,
  });

  try {
    if (event?.httpMethod === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    if (!isAdminCaller(event)) {
      console.warn("[adminManageUsers] forbidden: caller is not Admin", {
        groups: getCallerGroups(event),
        isAdminIamRoleCaller: isAdminIamRoleCaller(event),
        authorizerKeys: Object.keys(event?.requestContext?.authorizer || {}),
        identity: {
          cognitoIdentityId: event?.requestContext?.identity?.cognitoIdentityId,
          cognitoAuthenticationType:
            event?.requestContext?.identity?.cognitoAuthenticationType,
          cognitoAuthenticationProvider:
            event?.requestContext?.identity?.cognitoAuthenticationProvider,
          userArn: event?.requestContext?.identity?.userArn,
          accountId: event?.requestContext?.identity?.accountId,
        },
      });

      return forbidden();
    }

    const body = parseBody(event);
    const action = body?.action;

    if (action === "PING") {
      return ok({
        action: "PING",
        message: "adminManageUsers Lambda is working",
        ...getConfigStatus(),
      });
    }

    if (action === "CREATE_USER") {
      return handleCreateUser(body);
    }

    return badRequest("Unsupported action", {
      supportedActions: ["PING", "CREATE_USER"],
    });
  } catch (error) {
    console.error("[adminManageUsers] failed", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      statusCode: error?.$metadata?.httpStatusCode,
      requestId: error?.$metadata?.requestId,
    });

    if (error.message === "Request body must be valid JSON") {
      return badRequest(error.message);
    }

    if (
      error.message ===
        "AUTH_HEALTHCONNECT97A44150_USERPOOLID is not configured" ||
      error.message === "TABLE_USER is not configured with a real table name"
    ) {
      return serverError(error.message);
    }

    return serverError(error?.message || "Internal server error");
  }
};
