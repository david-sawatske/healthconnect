export const getDirectMessageConversationId = (userAId, userBId) => {
  const [firstUserId, secondUserId] = [userAId, userBId].sort();
  return `DM:${firstUserId}:${secondUserId}`;
};

export const getCareTeamConversationId = (patientId, providerId) =>
  `CARE_TEAM:${patientId}:${providerId}`;

export const getProviderPatientId = (providerId, patientId) =>
  `PP:${providerId}:${patientId}`;

export const getAdvocateAssignmentId = (patientId, providerId, advocateId) =>
  `PA:${patientId}:PR:${providerId}:ADV:${advocateId}`;

export const getConversationParticipantId = (conversationId, userId) =>
  `${conversationId}:${userId}`;

export const isDirectMessageConversationId = (conversationId) =>
  typeof conversationId === "string" && conversationId.startsWith("DM:");

export const isCareTeamConversationId = (conversationId) =>
  typeof conversationId === "string" && conversationId.startsWith("CARE_TEAM:");
