export const GetUser = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      email
      displayName
      role
      avatarKey
    }
  }
`;

export const Me = /* GraphQL */ `
  query Me {
    getUser(id: "__sub") {
      id
      email
      displayName
      role
      avatarKey
    }
  }
`;
