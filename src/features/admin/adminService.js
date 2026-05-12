import { post } from "aws-amplify/api";
import { getGraphqlClient } from "../../services/amplify/client";

const client = getGraphqlClient();

const devLog = (...args) => {
  if (__DEV__) console.log("[ADMIN_SERVICE]", ...args);
};

const LIST_USERS_BY_ROLE = /* GraphQL */ `
  query ListUsersByRole(
    $filter: ModelUserFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listUsers(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        id
        displayName
        email
        role
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;

const LIST_PROVIDER_PATIENTS_FOR_PATIENT = /* GraphQL */ `
  query ListProviderPatientsForPatient(
    $filter: ModelProviderPatientFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listProviderPatients(
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        providerId
        patientId
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;

const parseRestResponseBody = async (body) => {
  if (body && typeof body.json === "function") {
    return body.json();
  }

  if (body && typeof body.text === "function") {
    const txt = await body.text();
    return txt ? JSON.parse(txt) : null;
  }

  return null;
};

const readRestErrorBody = async (error) => {
  try {
    const response = await error?.response;

    if (response?.body && typeof response.body.json === "function") {
      return response.body.json();
    }

    if (response?.body && typeof response.body.text === "function") {
      const txt = await response.body.text();

      if (!txt) return null;

      try {
        return JSON.parse(txt);
      } catch {
        return txt;
      }
    }

    return null;
  } catch {
    return null;
  }
};

const unwrapRestErrorMessage = async (error, fallbackMessage) => {
  const errorBody = await readRestErrorBody(error);

  if (errorBody) {
    devLog("REST error body =", errorBody);
  }

  if (typeof errorBody === "string") {
    return errorBody;
  }

  return (
    errorBody?.message || errorBody?.error || error?.message || fallbackMessage
  );
};

export const seedAdminData = async ({
  mode = "seed",
  scenario = "basic",
} = {}) => {
  try {
    const op = await post({
      apiName: "seeding",
      path: "/admin/seeding",
      options: {
        body: {
          mode,
          scenario,
        },
      },
    });

    const response = await op.response;

    devLog("status =", response.statusCode);
    devLog("headers =", response.headers);

    const data = await parseRestResponseBody(response.body);

    return {
      statusCode: response.statusCode,
      headers: response.headers,
      data,
    };
  } catch (error) {
    devLog("seedAdminData error =", error);

    const message = await unwrapRestErrorMessage(
      error,
      "Failed to seed admin data.",
    );

    throw new Error(message);
  }
};

export const seedBasicAdminData = () => {
  return seedAdminData({
    mode: "seed",
    scenario: "basic",
  });
};

export const formatSeedResultSummary = (data) => {
  if (!data) {
    return "Seed completed, but no response details were returned.";
  }

  const seeded = data.seeded || {};
  const deleted = data.deleted || {};
  const ids = data.ids || {};

  const seededLines = Object.entries(seeded).map(
    ([key, value]) => `• ${key}: ${value}`,
  );

  const deletedLines = Object.entries(deleted).map(
    ([key, value]) => `• ${key}: ${value}`,
  );

  const idLines = [];

  if (ids.patientId) {
    idLines.push(`• Patient: ${ids.patientId}`);
  }

  if (ids.providerId) {
    idLines.push(`• Provider: ${ids.providerId}`);
  }

  if (ids.advocateId) {
    idLines.push(`• Advocate: ${ids.advocateId}`);
  }

  return [
    data.ok === true ? "✅ Seed completed successfully." : "Seed completed.",
    "",
    data.mode ? `Mode: ${data.mode}` : null,
    data.scenario ? `Scenario: ${data.scenario}` : null,
    "",
    seededLines.length ? "Seeded:" : null,
    ...seededLines,
    "",
    deletedLines.length ? "Deleted:" : null,
    ...deletedLines,
    "",
    idLines.length ? "Primary IDs:" : null,
    ...idLines,
  ]
    .filter((line) => line !== null)
    .join("\n");
};

export const testAdminUsersApi = async (body = { action: "PING" }) => {
  try {
    const op = await post({
      apiName: "seeding",
      path: "/admin/users",
      options: {
        body,
      },
    });

    const response = await op.response;
    const responseBody = await parseRestResponseBody(response.body);

    return {
      statusCode: response.statusCode,
      body: responseBody,
    };
  } catch (error) {
    devLog("testAdminUsersApi error =", error);

    const message = await unwrapRestErrorMessage(
      error,
      "Unable to call /admin/users.",
    );

    throw new Error(message);
  }
};

export const fetchAdminUsersByRole = async (role) => {
  const users = [];
  let nextToken = null;

  try {
    do {
      const result = await client.graphql({
        query: LIST_USERS_BY_ROLE,
        variables: {
          filter: {
            role: {
              eq: role,
            },
          },
          limit: 100,
          nextToken,
        },
        authMode: "userPool",
      });

      const page = result?.data?.listUsers;

      users.push(...(page?.items || []).filter(Boolean));
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return users.sort((a, b) => {
      const nameA = a?.displayName || a?.email || a?.id || "";
      const nameB = b?.displayName || b?.email || b?.id || "";

      return nameA.localeCompare(nameB);
    });
  } catch (error) {
    devLog(`fetchAdminUsersByRole ${role} error =`, error);

    throw new Error(`Unable to load ${role.toLowerCase()} users.`);
  }
};

export const fetchAdminPatients = () => {
  return fetchAdminUsersByRole("PATIENT");
};

export const fetchAdminProviders = () => {
  return fetchAdminUsersByRole("PROVIDER");
};

export const fetchProviderPatientsForPatient = async (patientId) => {
  if (!patientId) {
    return [];
  }

  const relationships = [];
  let nextToken = null;

  try {
    do {
      const result = await client.graphql({
        query: LIST_PROVIDER_PATIENTS_FOR_PATIENT,
        variables: {
          filter: {
            patientId: {
              eq: patientId,
            },
          },
          limit: 100,
          nextToken,
        },
        authMode: "userPool",
      });

      const page = result?.data?.listProviderPatients;

      relationships.push(...(page?.items || []).filter(Boolean));
      nextToken = page?.nextToken || null;
    } while (nextToken);

    return relationships;
  } catch (error) {
    devLog("fetchProviderPatientsForPatient error =", error);

    throw new Error("Unable to load existing provider connections.");
  }
};

export async function connectPatientProvider({ patientId, providerId }) {
  try {
    const op = post({
      apiName: "seeding",
      path: "/admin/users",
      options: {
        body: {
          action: "CONNECT_PATIENT_PROVIDER",
          patientId,
          providerId,
        },
      },
    });

    const response = await op.response;
    const body = await parseRestResponseBody(response.body);

    if (!body?.ok) {
      throw new Error(body?.error || "Failed to connect patient to provider.");
    }

    return body;
  } catch (error) {
    devLog("connectPatientProvider error =", error);

    const message = await unwrapRestErrorMessage(
      error,
      "Failed to connect patient to provider.",
    );

    throw new Error(message);
  }
}

export const formatConnectPatientProviderSummary = (data) => {
  if (!data) {
    return "Patient/provider connection completed, but no response details were returned.";
  }

  const patientName = data?.patient?.displayName || data?.patient?.email;
  const providerName = data?.provider?.displayName || data?.provider?.email;

  return [
    data?.message || "Patient connected to provider successfully.",
    "",
    patientName ? `Patient: ${patientName}` : null,
    providerName ? `Provider: ${providerName}` : null,
    "",
    data?.providerPatient?.id
      ? `Relationship: ${data.providerPatient.id}`
      : null,
    `Relationship created: ${
      data?.providerPatient?.created ? "yes" : "already existed"
    }`,
    "",
    data?.conversation?.id ? `Care team chat: ${data.conversation.id}` : null,
    `Care team chat created: ${
      data?.conversation?.created ? "yes" : "already existed"
    }`,
    "",
    `Patient participant: ${
      data?.participants?.patient?.created ? "created" : "already existed"
    }`,
    `Provider participant: ${
      data?.participants?.provider?.created ? "created" : "already existed"
    }`,
  ]
    .filter(Boolean)
    .join("\n");
};
