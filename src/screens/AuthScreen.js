import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
  useWindowDimensions,
  Image,
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
  const [currentIndex, setCurrentIndex] = useState(0);

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 60,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const i = viewableItems?.[0]?.index ?? 0;
    setCurrentIndex(i);
  }).current;

  const { width: screenWidth } = useWindowDimensions();

  const carouselCardWidth = useMemo(() => {
    const maxW = 340;
    const minW = 260;
    const ideal = Math.round(screenWidth * 0.7);
    return Math.max(minW, Math.min(maxW, ideal));
  }, [screenWidth]);

  const carouselGap = 10;
  const snapInterval = carouselCardWidth + carouselGap;

  const sidePadding = Math.max(0, (screenWidth - carouselCardWidth) / 2);

  const roleAccent = useMemo(
    () => ({
      Patient: theme.colors.pillPatientText,
      Provider: theme.colors.pillProviderText,
      Advocate: theme.colors.pillAdvocateText,
      Admin: theme.colors.primary,
    }),
    [],
  );

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

      if (role === "PROVIDER") navigation.replace("ProviderHome");
      else if (role === "ADVOCATE") navigation.replace("AdvocateHome");
      else if (role === "PATIENT") navigation.replace("PatientHome");
      else if (role === "ADMIN") navigation.replace("AdminHome");
      else navigation.replace("Home");
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
        <View style={styles.brandWrap}>
          <Text style={styles.brandTitle}>HealthConnect</Text>
          <Text style={styles.brandTagline}>
            Coordinated care communication
          </Text>
        </View>

        <View style={styles.logoWrap}>
          <Image
            source={require("../../assets/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {DEMO_LOGIN_ENABLED ? (
          <View style={styles.modePill}>
            <Text style={styles.modePillText}>Demo Mode</Text>
          </View>
        ) : (
          <Text style={styles.title}>Sign In</Text>
        )}

        <Text style={styles.caption}>
          {DEMO_LOGIN_ENABLED
            ? "Choose a role to explore the app."
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
            <View style={styles.carouselWrap}>
              <FlatList
                data={availableDemoUsers}
                keyExtractor={(item) => item.key}
                horizontal
                showsHorizontalScrollIndicator={false}
                ItemSeparatorComponent={() => (
                  <View style={{ width: carouselGap }} />
                )}
                contentContainerStyle={{
                  paddingHorizontal: sidePadding,
                }}
                snapToInterval={snapInterval}
                snapToAlignment="start"
                decelerationRate="fast"
                bounces={false}
                getItemLayout={(_, index) => ({
                  length: snapInterval,
                  offset: snapInterval * index,
                  index,
                })}
                viewabilityConfig={viewabilityConfig}
                onViewableItemsChanged={onViewableItemsChanged}
                renderItem={({ item: u }) => {
                  const busy = loggingInRole === u.key;
                  const disabled = !!loggingInRole;

                  return (
                    <TouchableOpacity
                      key={u.key}
                      style={[
                        styles.roleCard,
                        { width: carouselCardWidth },
                        busy && { opacity: 0.65 },
                        disabled && !busy && { opacity: 0.9 },
                      ]}
                      onPress={() => handleDemoLogin(u)}
                      disabled={disabled}
                      activeOpacity={0.85}
                    >
                      <View
                        style={[
                          styles.roleAccent,
                          {
                            backgroundColor:
                              roleAccent[u.key] || theme.colors.primary,
                          },
                        ]}
                      />

                      <View style={styles.cardContent}>
                        <Text style={styles.roleName}>Explore as</Text>
                        <View style={styles.rolePill}>
                          <Text style={styles.rolePillText}>{u.key}</Text>
                        </View>
                        <Text style={styles.roleMeta}>
                          {String(u.username)}
                        </Text>

                        <View style={{ marginTop: 10 }}>
                          {u.key === "Patient" ? (
                            <>
                              <Text style={styles.bullet}>
                                • Message your care team
                              </Text>
                              <Text style={styles.bullet}>
                                • Share documents/photos
                              </Text>
                              <Text style={styles.bullet}>
                                • Start video calls
                              </Text>
                            </>
                          ) : null}

                          {u.key === "Provider" ? (
                            <>
                              <Text style={styles.bullet}>
                                • View patient list + details
                              </Text>
                              <Text style={styles.bullet}>
                                • Chat + send attachments
                              </Text>
                              <Text style={styles.bullet}>
                                • Join/host video calls
                              </Text>
                            </>
                          ) : null}

                          {u.key === "Advocate" ? (
                            <>
                              <Text style={styles.bullet}>
                                • Coordinate across conversations
                              </Text>
                              <Text style={styles.bullet}>
                                • Track updates in real time
                              </Text>
                              <Text style={styles.bullet}>
                                • Support patients and providers
                              </Text>
                            </>
                          ) : null}

                          {u.key === "Admin" ? (
                            <>
                              <Text style={styles.bullet}>
                                • Seed / reset demo data
                              </Text>
                              <Text style={styles.bullet}>
                                • Validate role-based routing
                              </Text>
                              <Text style={styles.bullet}>
                                • Inspect demo scenarios
                              </Text>
                            </>
                          ) : null}
                        </View>

                        {busy ? (
                          <View style={{ marginTop: theme.space.sm }}>
                            <ActivityIndicator />
                          </View>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />

              <View style={styles.dotsWrap}>
                {availableDemoUsers.map((_, i) => (
                  <View
                    key={String(i)}
                    style={[styles.dot, i === currentIndex && styles.dotActive]}
                  />
                ))}
              </View>
            </View>
          )}

          <View style={styles.footerPill}>
            <Text style={styles.footerNote}>
              {__DEV__
                ? "Demo mode enabled (dev build)."
                : "Demo mode enabled via EXPO_PUBLIC_DEMO_LOGIN=true."}
            </Text>
          </View>
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
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.colors.bg,
  },
  center: { alignItems: "center", justifyContent: "center" },

  header: {
    paddingTop: theme.space.md,
    alignItems: "center",
    marginBottom: theme.space.lg,
  },

  brandWrap: {
    alignItems: "center",
    marginBottom: theme.space.sm,
  },
  brandTitle: {
    ...theme.type.h1,
    textAlign: "center",
  },
  brandTagline: {
    ...theme.type.subtext,
    textAlign: "center",
    marginTop: 4,
  },

  logoWrap: {
    alignSelf: "center",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.floating,
    marginBottom: theme.space.md,
  },
  logo: {
    width: 96,
    height: 96,
  },

  modePill: {
    alignSelf: "center",
    backgroundColor: theme.colors.infoBg,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: theme.space.xs,
  },
  modePillText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.infoText,
    letterSpacing: 0.2,
  },

  title: {
    ...theme.type.h2,
    marginBottom: theme.space.xs,
  },
  caption: {
    ...theme.type.subtext,
    textAlign: "center",
  },

  carouselWrap: {
    marginTop: theme.space.sm,
    marginBottom: theme.space.sm,
  },

  roleCard: {
    position: "relative",
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    ...theme.shadow.card,
    overflow: "hidden",
  },

  roleAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },

  rolePill: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: theme.colors.pillInfoBg,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.pillInfoText,
  },

  cardContent: {
    paddingTop: 18,
  },

  roleName: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.muted,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  roleMeta: {
    ...theme.type.small,
    marginTop: 4,
    marginBottom: 10,
  },

  bullet: {
    ...theme.type.small,
    color: theme.colors.muted,
    lineHeight: 18,
    marginTop: 6,
  },

  dotsWrap: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: theme.space.sm,
    marginBottom: theme.space.md,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.border,
    marginHorizontal: 4,
  },
  dotActive: {
    width: 18,
    height: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },

  subtle: {
    marginTop: theme.space.xs,
    color: theme.colors.subtext,
    fontSize: theme.type.small.fontSize,
  },

  emptyCard: {
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    ...theme.shadow.card,
  },
  emptyTitle: {
    fontSize: theme.type.body.fontSize,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.space.xs,
    textAlign: "center",
  },
  emptyText: {
    fontSize: theme.type.small.fontSize,
    color: theme.colors.subtext,
    textAlign: "center",
    lineHeight: 18,
  },
  mono: {
    fontFamily: "Menlo",
    color: theme.colors.text,
  },

  footerPill: {
    alignSelf: "center",
    marginTop: theme.space.lg,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  footerNote: {
    textAlign: "center",
    fontSize: theme.type.small.fontSize,
    color: theme.colors.subtext,
  },
});
