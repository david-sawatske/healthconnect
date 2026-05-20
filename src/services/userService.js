import { getGraphqlClient } from "./amplify/client";

const client = getGraphqlClient();

const GET_USER = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      displayName
      role
      email
    }
  }
`;

const devLog = (...args) => {
  if (__DEV__) console.log("[USER_SERVICE]", ...args);
};

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function getUserDisplayName(user, fallback = "User") {
  return user?.displayName || user?.email || fallback;
}

export async function getUserById(userId) {
  if (!userId) return null;

  try {
    const { data } = await client.graphql({
      query: GET_USER,
      variables: { id: userId },
      authMode: "userPool",
    });

    return data?.getUser || null;
  } catch (err) {
    devLog("getUserById error:", userId, err);
    return null;
  }
}

export async function getUsersByIds(userIds = []) {
  const uniqueIds = uniq(userIds);
  if (!uniqueIds.length) return {};

  const users = await Promise.all(uniqueIds.map((id) => getUserById(id)));

  return users.reduce((map, user) => {
    if (user?.id) map[user.id] = user;
    return map;
  }, {});
}
