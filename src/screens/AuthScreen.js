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
  Platform,
} from "react-native";
import { signIn, getCurrentUser } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/api";
import { theme } from "../ui/theme";

const client = generateClient();

const isWeb = Platform.OS === "web";

const devLog = (...args) => {
  if (__DEV__) console.log("[AUTH_SCREEN]", ...args);
};

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

const getFriendlyAuthMessage = (err) => {
  const code = err?.name || err?.code || "";
  const message = err?.message || "";

  if (
    code === "NotAuthorizedException" ||
    message.toLowerCase().includes("incorrect username or password")
  ) {
    return "That demo login was not accepted. Please check the configured demo credentials.";
  }

  if (code === "UserNotFoundException") {
    return "This demo account could not be found.";
  }

  if (code === "NetworkError" || message.toLowerCase().includes("network")) {
    return "We could not reach the server. Please check your connection and try again.";
  }

  return "Unable to sign in right now. Please try again.";
};

export default function AuthScreen({ navigation }) {
  const [checking, setChecking] = useState(true);
  const [loggingInRole, setLoggingInRole] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const listRef = useRef(null);

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 60,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const index = viewableItems?.[0]?.index ?? 0;
    setCurrentIndex(index);
  }).current;

  const { width: screenWidth } = useWindowDimensions();

  const appFrameWidth = useMemo(() => {
    return isWeb ? Math.min(screenWidth, 430) : screenWidth;
  }, [screenWidth]);

  const carouselCardWidth = useMemo(() => {
    const maxWidth = isWeb ? 320 : 340;
    const minWidth = isWeb ? 250 : 260;
    const idealWidth = Math.round(appFrameWidth * (isWeb ? 0.78 : 0.7));

    return Math.max(minWidth, Math.min(maxWidth, idealWidth));
  }, [appFrameWidth]);

  const carouselGap = theme.space.sm;
  const snapInterval = carouselCardWidth + carouselGap;
  const sidePadding = Math.max(0, (appFrameWidth - carouselCardWidth) / 2);

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
    return DEMO_USERS.filter((user) => user.username && user.password);
  }, []);

  const scrollToRole = useCallback(
    (index) => {
      if (!listRef.current) return;

      setCurrentIndex(index);

      listRef.current.scrollToOffset({
        offset: snapInterval * index,
        animated: true,
      });
    },
    [snapInterval],
  );

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
        Alert.alert(
          "Account setup issue",
          "Your account was found, but the app profile record is missing.",
        );
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
      devLog("routeByUserRecord error", err);
      navigation.replace("Home");
    }
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        await getCurrentUser();
        await routeByUserRecord();
      } catch (err) {
        devLog("initial session check: no active session", err?.name || err);
      } finally {
        if (isMounted) setChecking(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [routeByUserRecord]);

  const handleDemoLogin = useCallback(
    async (demoUser) => {
      if (!demoUser?.username || !demoUser?.password) {
        Alert.alert(
          "Demo account unavailable",
          "This demo role is not configured yet.",
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
        devLog("demo login error", {
          role: demoUser.key,
          name: err?.name,
          message: err?.message,
        });

        Alert.alert("Login failed", getFriendlyAuthMessage(err));
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
            : "Demo login is currently disabled."}
        </Text>
      </View>

      {DEMO_LOGIN_ENABLED ? (
        <>
          {availableDemoUsers.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Demo accounts are not configured
              </Text>
              <Text style={styles.emptyText}>
                Add the EXPO_PUBLIC_DEMO_* email and password environment
                variables, then restart Expo with cache clear:{" "}
                <Text style={styles.mono}>npx expo start -c</Text>
              </Text>
            </View>
          ) : (
            <View style={styles.carouselWrap}>
              <FlatList
                ref={listRef}
                data={availableDemoUsers}
                keyExtractor={(item) => item.key}
                horizontal
                showsHorizontalScrollIndicator={false}
                ItemSeparatorComponent={() => (
                  <View style={{ width: carouselGap }} />
                )}
                contentContainerStyle={styles.carouselContent}
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
                renderItem={({ item }) => {
                  const busy = loggingInRole === item.key;
                  const disabled = !!loggingInRole;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.roleCard,
                        { width: carouselCardWidth, marginHorizontal: 0 },
                        busy && styles.roleCardBusy,
                        disabled && !busy && styles.roleCardDimmed,
                      ]}
                      onPress={() => handleDemoLogin(item)}
                      disabled={disabled}
                      activeOpacity={0.88}
                    >
                      <View
                        style={[
                          styles.roleAccent,
                          {
                            backgroundColor:
                              roleAccent[item.key] || theme.colors.primary,
                          },
                        ]}
                      />

                      <View style={styles.cardContent}>
                        <Text style={styles.roleName}>Explore as</Text>

                        <View style={styles.rolePill}>
                          <Text style={styles.rolePillText}>{item.key}</Text>
                        </View>

                        <Text
                          style={styles.roleMeta}
                          numberOfLines={1}
                          ellipsizeMode="middle"
                        >
                          {item.username}
                        </Text>

                        <View style={styles.featureList}>
                          {item.key === "Patient" ? (
                            <>
                              <Text style={styles.bullet}>
                                • Message your care team
                              </Text>
                              <Text style={styles.bullet}>
                                • Share documents and photos
                              </Text>
                              <Text style={styles.bullet}>
                                • Start video calls
                              </Text>
                            </>
                          ) : null}

                          {item.key === "Provider" ? (
                            <>
                              <Text style={styles.bullet}>
                                • View patient list and details
                              </Text>
                              <Text style={styles.bullet}>
                                • Chat and send attachments
                              </Text>
                              <Text style={styles.bullet}>
                                • Join or host video calls
                              </Text>
                            </>
                          ) : null}

                          {item.key === "Advocate" ? (
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

                          {item.key === "Admin" ? (
                            <>
                              <Text style={styles.bullet}>
                                • Seed and reset demo data
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
                          <View style={styles.loadingWrap}>
                            <ActivityIndicator />
                            <Text style={styles.loadingText}>Signing in…</Text>
                          </View>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListHeaderComponent={<View style={{ width: sidePadding }} />}
                ListFooterComponent={<View style={{ width: sidePadding }} />}
              />

              <View style={styles.dotsWrap}>
                {availableDemoUsers.map((_, index) => (
                  <TouchableOpacity
                    key={String(index)}
                    onPress={() => scrollToRole(index)}
                    disabled={!isWeb && index === currentIndex}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.dot,
                        index === currentIndex && styles.dotActive,
                      ]}
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.footerPill}>
            <Text style={styles.footerNote}>
              {__DEV__
                ? "Demo mode is enabled in development."
                : "Demo mode is enabled by environment configuration."}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Demo login is off</Text>
          <Text style={styles.emptyText}>
            To enable it in a build, set{" "}
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
    paddingHorizontal: isWeb ? theme.space.md : theme.space.lg,
    paddingTop: isWeb ? theme.space.sm : theme.space.md,
    paddingBottom: isWeb ? theme.space.md : theme.space.lg,
    backgroundColor: theme.colors.bg,
  },

  center: {
    alignItems: "center",
    justifyContent: "center",
  },

  header: {
    alignItems: "center",
    marginBottom: isWeb ? theme.space.sm : theme.space.lg,
  },

  brandWrap: {
    alignItems: "center",
    marginBottom: isWeb ? theme.space.xs : theme.space.sm,
  },

  brandTitle: {
    ...theme.type.h1,
    fontSize: isWeb ? 26 : theme.type.h1.fontSize,
    lineHeight: isWeb ? 32 : theme.type.h1.lineHeight,
    textAlign: "center",
  },

  brandTagline: {
    ...theme.type.subtext,
    fontSize: isWeb ? 16 : theme.type.subtext.fontSize,
    lineHeight: isWeb ? 22 : theme.type.subtext.lineHeight,
    textAlign: "center",
    marginTop: isWeb ? 2 : theme.space.xs,
  },

  logoWrap: {
    alignSelf: "center",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: isWeb ? 10 : theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: isWeb ? theme.space.sm : theme.space.md,
    ...theme.shadow.floating,
  },

  logo: {
    width: isWeb ? 76 : 96,
    height: isWeb ? 76 : 96,
  },

  modePill: {
    alignSelf: "center",
    backgroundColor: theme.colors.infoBg,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: isWeb ? 5 : 6,
    marginBottom: isWeb ? 4 : theme.space.xs,
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
    fontSize: isWeb ? 15 : theme.type.subtext.fontSize,
    lineHeight: isWeb ? 20 : theme.type.subtext.lineHeight,
    textAlign: "center",
  },

  carouselWrap: {
    marginTop: isWeb ? 0 : theme.space.sm,
  },

  carouselContent: {
    alignItems: "stretch",
  },

  roleCard: {
    position: "relative",
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: isWeb ? theme.space.sm : theme.space.md,
    overflow: "hidden",
    ...theme.shadow.card,
  },

  roleCardBusy: {
    opacity: 0.7,
  },

  roleCardDimmed: {
    opacity: 0.9,
  },

  roleAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },

  cardContent: {
    paddingTop: isWeb ? theme.space.md : theme.space.lg,
    minHeight: isWeb ? 172 : 210,
  },

  roleName: {
    fontSize: isWeb ? 12 : 13,
    fontWeight: "600",
    color: theme.colors.muted,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },

  rolePill: {
    position: "absolute",
    top: isWeb ? 8 : 12,
    right: isWeb ? 8 : 12,
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

  roleMeta: {
    ...theme.type.small,
    fontSize: isWeb ? 12 : theme.type.small.fontSize,
    marginTop: theme.space.xs,
    marginBottom: isWeb ? theme.space.xs : theme.space.sm,
  },

  featureList: {
    marginTop: isWeb ? 2 : theme.space.xs,
  },

  bullet: {
    ...theme.type.small,
    fontSize: isWeb ? 12 : theme.type.small.fontSize,
    color: theme.colors.muted,
    lineHeight: isWeb ? 16 : 18,
    marginTop: isWeb ? 4 : 6,
  },

  loadingWrap: {
    marginTop: isWeb ? theme.space.sm : theme.space.md,
    alignItems: "flex-start",
  },

  loadingText: {
    marginTop: theme.space.xs,
    fontSize: theme.type.small.fontSize,
    color: theme.colors.subtext,
  },

  dotsWrap: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: isWeb ? theme.space.xs : theme.space.sm,
    marginBottom: isWeb ? theme.space.sm : theme.space.md,
  },

  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.border,
    marginHorizontal: 5,
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
    backgroundColor: theme.colors.card,
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
    marginTop: isWeb ? theme.space.sm : theme.space.lg,
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
