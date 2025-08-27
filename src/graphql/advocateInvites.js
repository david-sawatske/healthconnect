export const CreateAdvocateInvite = /* GraphQL */ `
  mutation CreateAdvocateInvite($input: CreateAdvocateInviteInput!) {
    createAdvocateInvite(input: $input) {
      id
      advocateId
      conversationId
      status
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
      patientId
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
