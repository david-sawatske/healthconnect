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
