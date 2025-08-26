export const CreateAdvocateInvite = /* GraphQL */ `
  mutation CreateAdvocateInvite($input: CreateAdvocateInviteInput!) {
    createAdvocateInvite(input: $input) {
      id
      patientId
      providerId
      advocateId
      conversationId
      status
      createdBy
      approvedBy
      approvedAt
      createdAt
      updatedAt
    }
  }
`;

export const ApproveAdvocateInvite = /* GraphQL */ `
  mutation ApproveAdvocateInvite($input: UpdateAdvocateInviteInput!) {
    updateAdvocateInvite(input: $input) {
      id
      status
      approvedBy
      approvedAt
      conversationId
      advocateId
      patientId
      providerId
      updatedAt
    }
  }
`;

export const DeclineAdvocateInvite = /* GraphQL */ `
  mutation DeclineAdvocateInvite($input: UpdateAdvocateInviteInput!) {
    updateAdvocateInvite(input: $input) {
      id
      status
      updatedAt
    }
  }
`;

export const GetAdvocateInvite = /* GraphQL */ `
  query GetAdvocateInvite($id: ID!) {
    getAdvocateInvite(id: $id) {
      id
      patientId
      providerId
      advocateId
      conversationId
      status
      createdBy
      approvedBy
      approvedAt
      createdAt
      updatedAt
    }
  }
`;

export const ListMyAdvocateInvites = /* GraphQL */ `
  query ListMyAdvocateInvites($sub: String!, $limit: Int, $nextToken: String) {
    listAdvocateInvites(
      filter: {
        or: [
          { patientId: { eq: $sub } }
          { providerId: { eq: $sub } }
          { advocateId: { eq: $sub } }
          { createdBy: { eq: $sub } }
        ]
      }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        conversationId
        status
        createdBy
        approvedBy
        approvedAt
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;
