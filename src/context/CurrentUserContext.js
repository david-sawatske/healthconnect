import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

const client = generateClient();

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

const CurrentUserContext = createContext({
  currentUser: null,
  loadingCurrentUser: true,
  refreshCurrentUser: async () => {},
});

export const useCurrentUser = () => useContext(CurrentUserContext);

export function CurrentUserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      setLoading(true);

      const auth = await getCurrentUser().catch(() => null);

      if (!auth?.userId) {
        setCurrentUser(null);
        return;
      }

      const { data } = await client.graphql({
        query: GET_USER,
        variables: { id: auth.userId },
        authMode: "userPool",
      });

      setCurrentUser(data?.getUser ?? null);
    } catch (err) {
      console.log("[CURRENT_USER] loadUser error", err);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  useEffect(() => {
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      const event = payload?.event;
      if (
        event === "signedIn" ||
        event === "signedOut" ||
        event === "tokenRefresh"
      ) {
        loadUser();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [loadUser]);

  const value = {
    currentUser,
    loadingCurrentUser: loading,
    refreshCurrentUser: loadUser,
  };

  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  );
}
