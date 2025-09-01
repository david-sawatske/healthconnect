export const ApproveInviteServer = /* GraphQL */ `
    mutation ApproveInvite($inviteId: ID!) {
        approveInvite(inviteId: $inviteId) {
            id
            advocateId
            conversationId
            status
            approvedBy
            approvedAt
        }
    }
`;
