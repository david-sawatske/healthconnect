import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { signIn, getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/api";
import { theme } from "../ui/theme";

const client = generateClient();

const DEMO_LOGIN_ENABLED =
  __DEV__ ||
  String(process.env.EXPO_PUBLIC_DEMO_LOGIN).toLowerCase() === "true";

const DEMO_USERS = [
  {
    key: "Patient",
    username: process.env.EXPO_PUBLIC_DEMO_PATIENT_EMAIL,
    password: process.env.EXPO_PUBLIC_DEMO_PATIENT_PASSWORD,
  },
  {
    key: "Provider",
    username: process.env.EXPO_PUBLIC_DEMO_PROVIDER_EMAIL,
    password: process.env.EXPO_PUBLIC_DEMO_PROVIDER_PASSWORD,
  },
  {
    key: "Advocate",
    username: process.env.EXPO_PUBLIC_DEMO_ADVOCATE_EMAIL,
    password: process.env.EXPO_PUBLIC_DEMO_ADVOCATE_PASSWORD,
  },
  {
    key: "Admin",
    username: process.env.EXPO_PUBLIC_DEMO_ADMIN_EMAIL,
    password: process.env.EXPO_PUBLIC_DEMO_ADMIN_PASSWORD,
  },
];

const GET_USER = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      role
      displayName
    }
  }
`;

export default function AuthScreen({ navigation }) {
  const [checking, setChecking] = useState(true);
  const [loggingInRole, setLoggingInRole] = useState(null);

  const availableDemoUsers = useMemo(() => {
    return DEMO_USERS.filter((u) => u.username && u.password);
  }, []);

  const routeByUserRecord = useCallback(async () => {
    try {
      const cognitoUser = await getCurrentUser();
      const sub = cognitoUser.userId;

      const { data } = await client.graphql({
        query: GET_USER,
        variables: { id: sub },
        authMode: "userPool",
      });

      const user = data?.getUser;

      if (!user) {
        Alert.alert("Login error", "User record not found in database");
        navigation.replace("Home");
        return;
      }

      const role = (user.role || "").toUpperCase();

      if (role === "PROVIDER") {
        navigation.replace("ProviderHome");
      } else if (role === "ADVOCATE") {
        navigation.replace("AdvocateHome");
      } else if (role === "PATIENT") {
        navigation.replace("PatientHome");
      } else if (role === "ADMIN") {
        navigation.replace("AdminHome");
      } else {
        navigation.replace("Home");
      }
    } catch (err) {
      console.log("[AUTH] route error:", err);
      navigation.replace("Home");
    }
  }, [navigation]);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        await routeByUserRecord();
      } catch {
      } finally {
        setChecking(false);
      }
    })();
  }, [routeByUserRecord]);

  const handleDemoLogin = useCallback(
    async (demoUser) => {
      if (!demoUser?.username || !demoUser?.password) {
        Alert.alert(
          "Demo user not configured",
          "Missing demo credentials for this role.",
        );
        return;
      }

      try {
        setLoggingInRole(demoUser.key);
        await signIn({
          username: demoUser.username,
          password: demoUser.password,
        });
        await routeByUserRecord();
      } catch (err) {
        console.log("[AUTH] demo login error:", err);
        Alert.alert("Login failed", err?.message || "Unknown error");
      } finally {
        setLoggingInRole(null);
      }
    },
    [routeByUserRecord],
  );

  if (checking) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator />
        <Text style={styles.subtle}>Checking session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {DEMO_LOGIN_ENABLED ? "Demo Login" : "Sign In"}
        </Text>
        <Text style={styles.caption}>
          {DEMO_LOGIN_ENABLED
            ? "Pre-seeded accounts for reviewer convenience."
            : "Demo login is disabled."}
        </Text>
      </View>

      {DEMO_LOGIN_ENABLED ? (
        <>
          {availableDemoUsers.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Demo accounts not configured
              </Text>
              <Text style={styles.emptyText}>
                Add EXPO_PUBLIC_DEMO_* env vars (email + password) and restart
                Expo with cache clear:{" "}
                <Text style={styles.mono}>npx expo start -c</Text>
              </Text>
            </View>
          ) : (
            <View style={{ gap: theme.space.sm }}>
              {availableDemoUsers.map((u) => {
                const busy = loggingInRole === u.key;
                const disabled = !!loggingInRole;

                return (
                  <TouchableOpacity
                    key={u.key}
                    style={[
                      styles.roleCard,
                      busy && { opacity: 0.65 },
                      disabled && !busy && { opacity: 0.9 },
                    ]}
                    onPress={() => handleDemoLogin(u)}
                    disabled={disabled}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.roleName}>{u.key}</Text>
                      <Text style={styles.roleMeta}>{String(u.username)}</Text>
                    </View>

                    {busy ? (
                      <ActivityIndicator />
                    ) : (
                      <Text style={styles.arrow}>›</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.footerNote}>
            {__DEV__
              ? "Demo mode enabled (dev build)."
              : "Demo mode enabled via EXPO_PUBLIC_DEMO_LOGIN=true."}
          </Text>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Demo login is off</Text>
          <Text style={styles.emptyText}>
            To enable for a build, set{" "}
            <Text style={styles.mono}>EXPO_PUBLIC_DEMO_LOGIN=true</Text>.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.space.lg,
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
  },
  center: { alignItems: "center" },

  header: {
    alignItems: "center",
    marginBottom: theme.space.lg,
    gap: theme.space.xs,
  },
  title: {
    fontSize: theme.type.h1,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
  },
  caption: {
    fontSize: theme.type.small,
    color: theme.colors.subtext,
    textAlign: "center",
  },

  roleCard: {
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    ...theme.shadow.card,
  },
  roleName: {
    fontSize: theme.type.body,
    fontWeight: "700",
    color: theme.colors.text,
  },
  roleMeta: {
    marginTop: 2,
    fontSize: theme.type.small,
    color: theme.colors.subtext,
  },
  arrow: {
    fontSize: 24,
    color: theme.colors.muted,
    paddingHorizontal: 6,
  },

  subtle: {
    marginTop: theme.space.xs,
    color: theme.colors.subtext,
    fontSize: theme.type.small,
  },

  emptyCard: {
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    ...theme.shadow.card,
  },
  emptyTitle: {
    fontSize: theme.type.body,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.space.xs,
    textAlign: "center",
  },
  emptyText: {
    fontSize: theme.type.small,
    color: theme.colors.subtext,
    textAlign: "center",
    lineHeight: 18,
  },
  mono: {
    fontFamily: "Menlo",
    color: theme.colors.text,
  },

  footerNote: {
    marginTop: theme.space.lg,
    textAlign: "center",
    fontSize: theme.type.small,
    color: theme.colors.subtext,
  },
});
