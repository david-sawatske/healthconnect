import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { getUserById } from "../services/userService";

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
    setLoading(true);

    try {
      const auth = await getCurrentUser();

      if (!auth?.userId) {
        setCurrentUser(null);
        return;
      }

      console.log("[CURRENT_USER] auth.userId =", auth.userId);

      const user = await getUserById(auth.userId);

      if (!user) {
        console.log(
          "[CURRENT_USER] No User record found for id (cognito sub):",
          auth.userId,
        );
      }

      setCurrentUser(user);
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
