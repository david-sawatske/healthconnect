import { post } from "aws-amplify/api";

const devLog = (...args) => {
  if (__DEV__) console.log("[ADMIN_SERVICE]", ...args);
};

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

    const errorBody = await readRestErrorBody(error);

    if (errorBody) {
      devLog("error body =", errorBody);
    }

    throw error;
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
  const op = await post({
    apiName: "seeding",
    path: "/admin/users",
    options: {
      body,
    },
  });

  const response = await op.response;
  const responseBody = await response.body.json();

  return {
    statusCode: response.statusCode,
    body: responseBody,
  };
};

export async function connectPatientProvider({ patientId, providerId }) {
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
  const body = await response.body.json();

  if (!body?.ok) {
    throw new Error(body?.error || "Failed to connect patient to provider.");
  }

  return body;
}
