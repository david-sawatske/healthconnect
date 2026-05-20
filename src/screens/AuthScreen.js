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
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { signIn, getCurrentUser } from "aws-amplify/auth";
import { theme } from "../ui/theme";
import { getUserById } from "../services/userService";

const isWeb = Platform.OS === "web";

const devLog = (...args) => {
  if (__DEV__) console.log("[AUTH_SCREEN]", ...args);
};

const DEMO_LOGIN_ENABLED =
  __DEV__ ||
  String(process.env.EXPO_PUBLIC_DEMO_LOGIN).toLowerCase() === "true";

const DEMO_ROLES = [
  {
    key: "PATIENT",
    label: "Patient",
    headline: "Explore as a Patient",
    description:
      "Review care teams, direct messages, group chats, and patient empty states.",
    bullets: [
      "Message providers and advocates",
      "Review care-team conversations",
      "Test patient relationship states",
    ],
  },
  {
    key: "PROVIDER",
    label: "Provider",
    headline: "Explore as a Provider",
    description:
      "Review patient lists, patient details, direct messages, and care-team chats.",
    bullets: [
      "View assigned patients",
      "Open patient details",
      "Message patients and care teams",
    ],
  },
  {
    key: "ADVOCATE",
    label: "Advocate",
    headline: "Explore as an Advocate",
    description:
      "Coordinate across patients and providers where advocate access exists.",
    bullets: [
      "View assigned patients",
      "Choose provider-specific chats",
      "Support patient care teams",
    ],
  },
  {
    key: "ADMIN",
    label: "Admin",
    headline: "Explore as Admin",
    description:
      "Test user creation, patient-provider connections, and advocate invite flows.",
    bullets: [
      "Create demo users",
      "Connect patients and providers",
      "Invite advocates to care teams",
    ],
  },
];

const DEMO_USERS_BY_ROLE = {
  PATIENT: [
    {
      id: "patient-1",
      role: "PATIENT",
      name: "Jordan Patient",
      email: process.env.EXPO_PUBLIC_DEMO_PATIENT_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_PATIENT_PASSWORD,
      scenario:
        "Has two providers and advocate-backed care teams. Best for testing established patient workflows.",
    },
    {
      id: "patient-2",
      role: "PATIENT",
      name: "Morgan Reed",
      email: process.env.EXPO_PUBLIC_DEMO_PATIENT_2_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_PATIENT_2_PASSWORD,
      scenario:
        "Has one provider and no advocates. Use to test adding a provider and inviting an advocate.",
    },
    {
      id: "patient-3",
      role: "PATIENT",
      name: "Taylor Nguyen",
      email: process.env.EXPO_PUBLIC_DEMO_PATIENT_3_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_PATIENT_3_PASSWORD,
      scenario:
        "Has no providers. Use to test empty state and first provider connection.",
    },
  ],

  PROVIDER: [
    {
      id: "provider-1",
      role: "PROVIDER",
      name: "Dr. Avery Provider",
      email: process.env.EXPO_PUBLIC_DEMO_PROVIDER_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_PROVIDER_PASSWORD,
      scenario:
        "Has multiple patients. Best for testing provider patient lists and active care-team workflows.",
    },
    {
      id: "provider-2",
      role: "PROVIDER",
      name: "Dr. Riley Chen",
      email: process.env.EXPO_PUBLIC_DEMO_PROVIDER_2_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_PROVIDER_2_PASSWORD,
      scenario:
        "Has one seeded patient and can be added to Morgan later through the admin flow.",
    },
  ],

  ADVOCATE: [
    {
      id: "advocate-1",
      role: "ADVOCATE",
      name: "Casey Advocate",
      email: process.env.EXPO_PUBLIC_DEMO_ADVOCATE_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_ADVOCATE_PASSWORD,
      scenario:
        "Assigned to Jordan + Avery. Use to test advocate access to an established care team.",
    },
    {
      id: "advocate-2",
      role: "ADVOCATE",
      name: "Alex Rivera",
      email: process.env.EXPO_PUBLIC_DEMO_ADVOCATE_2_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_ADVOCATE_2_PASSWORD,
      scenario:
        "Assigned to Jordan + Riley. Use to compare advocate access across providers.",
    },
  ],

  ADMIN: [
    {
      id: "admin-1",
      role: "ADMIN",
      name: "Admin Demo",
      email: process.env.EXPO_PUBLIC_DEMO_ADMIN_EMAIL,
      password: process.env.EXPO_PUBLIC_DEMO_ADMIN_PASSWORD,
      scenario:
        "Tests user creation, patient-provider connection, and advocate invite flows.",
    },
  ],
};

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

const getConfiguredUsers = (users) => {
  return users.filter((user) => user.email && user.password);
};

export default function AuthScreen({ navigation }) {
  const [checking, setChecking] = useState(true);
  const [loggingInUserId, setLoggingInUserId] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedRole, setSelectedRole] = useState(null);

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
    const maxWidth = isWeb ? 330 : 350;
    const minWidth = isWeb ? 260 : 270;
    const idealWidth = Math.round(appFrameWidth * (isWeb ? 0.8 : 0.72));

    return Math.max(minWidth, Math.min(maxWidth, idealWidth));
  }, [appFrameWidth]);

  const carouselGap = theme.space.sm;
  const snapInterval = carouselCardWidth + carouselGap;
  const sidePadding = Math.max(0, (appFrameWidth - carouselCardWidth) / 2);

  const roleAccent = useMemo(
    () => ({
      PATIENT: theme.colors.pillPatientText,
      PROVIDER: theme.colors.pillProviderText,
      ADVOCATE: theme.colors.pillAdvocateText,
      ADMIN: theme.colors.primary,
    }),
    [],
  );

  const rolePillColors = useMemo(
    () => ({
      PATIENT: {
        bg: theme.colors.pillPatientBg,
        text: theme.colors.pillPatientText,
      },
      PROVIDER: {
        bg: theme.colors.pillProviderBg,
        text: theme.colors.pillProviderText,
      },
      ADVOCATE: {
        bg: theme.colors.pillAdvocateBg,
        text: theme.colors.pillAdvocateText,
      },
      ADMIN: {
        bg: theme.colors.pillInfoBg,
        text: theme.colors.pillInfoText,
      },
    }),
    [],
  );

  const configuredUsersByRole = useMemo(() => {
    return DEMO_ROLES.reduce((acc, role) => {
      acc[role.key] = getConfiguredUsers(DEMO_USERS_BY_ROLE[role.key] || []);
      return acc;
    }, {});
  }, []);

  const availableDemoRoles = useMemo(() => {
    return DEMO_ROLES.filter(
      (role) => configuredUsersByRole[role.key]?.length > 0,
    );
  }, [configuredUsersByRole]);

  const selectedRoleUsers = selectedRole
    ? configuredUsersByRole[selectedRole.key] || []
    : [];

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

      const user = await getUserById(sub);

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
      if (!demoUser?.email || !demoUser?.password) {
        Alert.alert(
          "Demo account unavailable",
          "This demo user is not configured yet.",
        );
        return;
      }

      try {
        setLoggingInUserId(demoUser.id);

        await signIn({
          username: demoUser.email,
          password: demoUser.password,
        });

        await routeByUserRecord();
      } catch (err) {
        devLog("demo login error", {
          user: demoUser.name,
          role: demoUser.role,
          name: err?.name,
          message: err?.message,
        });

        Alert.alert("Login failed", getFriendlyAuthMessage(err));
      } finally {
        setLoggingInUserId(null);
      }
    },
    [routeByUserRecord],
  );

  const closeRoleModal = useCallback(() => {
    if (loggingInUserId) return;
    setSelectedRole(null);
  }, [loggingInUserId]);

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

        <Text style={styles.demoHeaderTitle}>
          {DEMO_LOGIN_ENABLED ? "Choose a role" : "Sign In"}
        </Text>

        <Text style={styles.caption}>
          {DEMO_LOGIN_ENABLED
            ? "Then select a demo user to explore a realistic workflow."
            : "Demo login is currently disabled."}
        </Text>
      </View>

      {DEMO_LOGIN_ENABLED ? (
        <>
          {availableDemoRoles.length === 0 ? (
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
                data={availableDemoRoles}
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
                  const accentColor =
                    roleAccent[item.key] || theme.colors.primary;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.roleCard,
                        { width: carouselCardWidth, marginHorizontal: 0 },
                      ]}
                      onPress={() => setSelectedRole(item)}
                      activeOpacity={0.88}
                    >
                      <View
                        style={[
                          styles.roleAccent,
                          { backgroundColor: accentColor },
                        ]}
                      />

                      <View style={styles.cardContent}>
                        <View
                          style={[
                            styles.rolePill,
                            {
                              backgroundColor:
                                rolePillColors[item.key]?.bg ||
                                theme.colors.pillInfoBg,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.rolePillText,
                              {
                                color:
                                  rolePillColors[item.key]?.text ||
                                  theme.colors.pillInfoText,
                              },
                            ]}
                          >
                            {item.label}
                          </Text>
                        </View>

                        <Text style={styles.roleHeadline}>{item.headline}</Text>

                        <Text style={styles.roleDescription}>
                          {item.description}
                        </Text>

                        <View style={styles.featureList}>
                          {item.bullets.map((bullet) => (
                            <Text key={bullet} style={styles.bullet}>
                              • {bullet}
                            </Text>
                          ))}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListHeaderComponent={<View style={{ width: sidePadding }} />}
                ListFooterComponent={<View style={{ width: sidePadding }} />}
              />

              <View style={styles.dotsWrap}>
                {availableDemoRoles.map((_, index) => (
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

          <Modal
            visible={!!selectedRole}
            transparent
            animationType="fade"
            onRequestClose={closeRoleModal}
          >
            <Pressable style={styles.modalOverlay} onPress={closeRoleModal}>
              <Pressable
                style={styles.modalCard}
                onPress={(event) => event.stopPropagation()}
              >
                <View style={styles.modalHeader}>
                  <View style={styles.modalTitleWrap}>
                    <Text style={styles.modalEyebrow}>Select demo user</Text>
                    <Text style={styles.modalTitle}>
                      {selectedRole?.label || "Demo"} accounts
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.closeButton}
                    onPress={closeRoleModal}
                    disabled={!!loggingInUserId}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.closeButtonText}>×</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalDescription}>
                  {selectedRole?.description}
                </Text>

                <ScrollView
                  style={styles.userScroll}
                  contentContainerStyle={styles.userScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedRoleUsers.map((user) => {
                    const busy = loggingInUserId === user.id;
                    const disabled = !!loggingInUserId;
                    const pillColors =
                      rolePillColors[user.role] || rolePillColors.ADMIN;

                    return (
                      <TouchableOpacity
                        key={user.id}
                        style={[
                          styles.userCard,
                          busy && styles.userCardBusy,
                          disabled && !busy && styles.userCardDimmed,
                        ]}
                        onPress={() => handleDemoLogin(user)}
                        disabled={disabled}
                        activeOpacity={0.88}
                      >
                        <View style={styles.userCardTopRow}>
                          <View style={styles.userTitleWrap}>
                            <Text style={styles.userName}>{user.name}</Text>
                            <Text
                              style={styles.userEmail}
                              numberOfLines={1}
                              ellipsizeMode="middle"
                            >
                              {user.email}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.userRolePill,
                              { backgroundColor: pillColors.bg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.userRolePillText,
                                { color: pillColors.text },
                              ]}
                            >
                              {selectedRole?.label}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.scenarioText}>{user.scenario}</Text>

                        <View style={styles.actionRow}>
                          {busy ? (
                            <>
                              <ActivityIndicator size="small" />
                              <Text style={styles.loadingText}>
                                Signing in…
                              </Text>
                            </>
                          ) : (
                            <Text style={styles.loginText}>
                              Log in as {user.name} →
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
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
    marginBottom: isWeb ? theme.space.sm : theme.space.md,
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

  demoHeaderTitle: {
    ...theme.type.h2,
    fontSize: isWeb ? 22 : theme.type.h2.fontSize,
    lineHeight: isWeb ? 28 : theme.type.h2.lineHeight,
    textAlign: "center",
    marginTop: isWeb ? theme.space.xs : 0,
    marginBottom: 2,
  },

  caption: {
    ...theme.type.subtext,
    fontSize: isWeb ? 15 : theme.type.subtext.fontSize,
    lineHeight: isWeb ? 20 : theme.type.subtext.lineHeight,
    textAlign: "center",
    maxWidth: 360,
  },

  carouselWrap: {
    marginTop: isWeb ? theme.space.xs : theme.space.sm,
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
    paddingHorizontal: isWeb ? theme.space.sm : theme.space.md,
    paddingTop: isWeb ? theme.space.xs : theme.space.sm,
    paddingBottom: isWeb ? theme.space.sm : theme.space.md,
    overflow: "hidden",
    ...theme.shadow.card,
  },

  cardContent: {
    paddingTop: isWeb ? theme.space.sm : theme.space.md,
    minHeight: isWeb ? 140 : 158,
  },

  roleAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },

  rolePill: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.pillInfoBg,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: theme.space.sm,
  },

  rolePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.pillInfoText,
  },

  roleHeadline: {
    fontSize: isWeb ? 20 : 21,
    lineHeight: isWeb ? 25 : 27,
    fontWeight: "800",
    color: theme.colors.text,
  },

  roleDescription: {
    ...theme.type.small,
    color: theme.colors.subtext,
    lineHeight: isWeb ? 12 : 14,
    marginTop: theme.space.xs,
  },

  featureList: {
    marginTop: isWeb ? theme.space.xs : theme.space.sm,
  },

  bullet: {
    ...theme.type.small,
    fontSize: isWeb ? 12 : theme.type.small.fontSize,
    color: theme.colors.muted,
    lineHeight: isWeb ? 12 : 14,
    marginTop: isWeb ? 4 : 6,
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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.xl,
  },

  modalCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "86%",
    alignSelf: "center",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: isWeb ? theme.space.lg : theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadow.floating,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.space.md,
  },

  modalTitleWrap: {
    flex: 1,
  },

  modalEyebrow: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.primary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 2,
  },

  modalTitle: {
    ...theme.type.h2,
    fontSize: isWeb ? 22 : theme.type.h2.fontSize,
    lineHeight: isWeb ? 28 : theme.type.h2.lineHeight,
  },

  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },

  closeButtonText: {
    fontSize: 24,
    lineHeight: 26,
    fontWeight: "500",
    color: theme.colors.subtext,
  },

  modalDescription: {
    ...theme.type.small,
    color: theme.colors.subtext,
    lineHeight: 18,
    marginTop: theme.space.xs,
    marginBottom: theme.space.md,
  },

  userScroll: {
    maxHeight: isWeb ? 440 : 520,
  },

  userScrollContent: {
    gap: theme.space.sm,
    paddingBottom: theme.space.xs,
  },

  userCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    backgroundColor: theme.colors.bg,
  },

  userCardBusy: {
    opacity: 0.75,
  },

  userCardDimmed: {
    opacity: 0.86,
  },

  userCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.space.sm,
  },

  userTitleWrap: {
    flex: 1,
  },

  userName: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: 2,
  },

  userEmail: {
    ...theme.type.small,
    color: theme.colors.subtext,
  },

  userRolePill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  userRolePillText: {
    fontSize: 12,
    fontWeight: "700",
  },

  scenarioText: {
    ...theme.type.small,
    color: theme.colors.muted,
    lineHeight: 18,
    marginTop: theme.space.sm,
  },

  actionRow: {
    minHeight: 22,
    marginTop: theme.space.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
  },

  loginText: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.primary,
  },

  loadingText: {
    fontSize: theme.type.small.fontSize,
    color: theme.colors.subtext,
  },
});
