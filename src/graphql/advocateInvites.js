export const CreateAdvocateInviteGuarded = /* GraphQL */ `
  mutation CreateAdvocateInviteGuarded(
    $patientId: ID!
    $providerId: ID!
    $advocateId: ID!
  ) {
    createAdvocateInviteGuarded(
      patientId: $patientId
      providerId: $providerId
      advocateId: $advocateId
    ) {
      id
      patientId
      advocateId
      conversationId
      status
      createdBy
      createdAt
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
        and: [{ advocateId: { eq: $sub } }, { status: { eq: PENDING } }]
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
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;
