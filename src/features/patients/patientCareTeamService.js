import { getGraphqlClient } from "../../services/amplify/client";
import { getUserDisplayName, getUsersByIds } from "../../services/userService";

const client = getGraphqlClient();

const PROVIDER_PATIENTS_BY_PATIENT = /* GraphQL */ `
  query ProviderPatientsByPatient($patientId: ID!) {
    providerPatientsByPatient(patientId: $patientId) {
      items {
        id
        patientId
        providerId
        provider {
          id
          displayName
          role
          email
        }
      }
    }
  }
`;

const ADVOCATE_ASSIGNMENTS_FOR_PATIENT = /* GraphQL */ `
  query AdvocateAssignmentsForPatient($patientId: ID!) {
    advocateAssignmentsByPatient(patientId: $patientId) {
      items {
        id
        patientId
        providerId
        advocateId
        createdAt
      }
    }
  }
`;

function getUserSortName(user) {
  return getUserDisplayName(user, "").toLowerCase();
}

async function listProviderPatientsForPatient(patientId) {
  if (!patientId) return [];

  const { data } = await client.graphql({
    query: PROVIDER_PATIENTS_BY_PATIENT,
    variables: { patientId },
    authMode: "userPool",
  });

  return data?.providerPatientsByPatient?.items || [];
}

async function listAdvocateAssignmentsForPatient(patientId) {
  if (!patientId) return [];

  const { data } = await client.graphql({
    query: ADVOCATE_ASSIGNMENTS_FOR_PATIENT,
    variables: { patientId },
    authMode: "userPool",
  });

  return data?.advocateAssignmentsByPatient?.items || [];
}

function buildProviderRows({ providerIds, providerToAdvocates, usersById }) {
  return providerIds
    .map((providerId) => {
      const providerUser = usersById[providerId] || null;
      const advocateIds = Array.from(
        providerToAdvocates.get(providerId) || [],
      ).filter(Boolean);

      return {
        providerId,
        providerUser,
        advocateIds,
      };
    })
    .sort((a, b) =>
      getUserSortName(a.providerUser).localeCompare(
        getUserSortName(b.providerUser),
      ),
    );
}

function buildAdvocateRows({ advocateIds, advocateToProviders, usersById }) {
  return advocateIds
    .map((advocateId) => {
      const advocateUser = usersById[advocateId] || null;
      const providerIds = Array.from(
        advocateToProviders.get(advocateId) || [],
      ).filter(Boolean);

      const providerNames = providerIds
        .map((providerId) =>
          getUserDisplayName(usersById[providerId], "Provider"),
        )
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      return {
        advocateId,
        advocateUser,
        providerIds,
        providerNames,
      };
    })
    .sort((a, b) =>
      getUserSortName(a.advocateUser).localeCompare(
        getUserSortName(b.advocateUser),
      ),
    );
}

export async function getPatientCareTeam(patientId) {
  if (!patientId) {
    return {
      providers: [],
      advocates: [],
      usersById: {},
    };
  }

  const [providerPatients, assignments] = await Promise.all([
    listProviderPatientsForPatient(patientId),
    listAdvocateAssignmentsForPatient(patientId),
  ]);

  const providerToAdvocates = new Map();
  const advocateToProviders = new Map();
  const embeddedProviderUsersById = {};

  providerPatients.forEach((providerPatient) => {
    if (!providerPatient?.providerId) return;

    if (!providerToAdvocates.has(providerPatient.providerId)) {
      providerToAdvocates.set(providerPatient.providerId, new Set());
    }

    if (providerPatient.provider?.id) {
      embeddedProviderUsersById[providerPatient.provider.id] =
        providerPatient.provider;
    }
  });

  assignments.forEach((assignment) => {
    if (!assignment?.providerId) return;

    if (!providerToAdvocates.has(assignment.providerId)) {
      providerToAdvocates.set(assignment.providerId, new Set());
    }

    if (!assignment.advocateId) return;

    providerToAdvocates.get(assignment.providerId).add(assignment.advocateId);

    if (!advocateToProviders.has(assignment.advocateId)) {
      advocateToProviders.set(assignment.advocateId, new Set());
    }

    advocateToProviders.get(assignment.advocateId).add(assignment.providerId);
  });

  const providerIds = Array.from(providerToAdvocates.keys()).filter(Boolean);
  const advocateIds = Array.from(advocateToProviders.keys()).filter(Boolean);

  const providerIdsMissingUsers = providerIds.filter(
    (providerId) => !embeddedProviderUsersById[providerId],
  );

  const fetchedUsersById = await getUsersByIds([
    ...providerIdsMissingUsers,
    ...advocateIds,
  ]);

  const usersById = {
    ...embeddedProviderUsersById,
    ...fetchedUsersById,
  };

  return {
    providers: buildProviderRows({
      providerIds,
      providerToAdvocates,
      usersById,
    }),
    advocates: buildAdvocateRows({
      advocateIds,
      advocateToProviders,
      usersById,
    }),
    usersById,
  };
}
