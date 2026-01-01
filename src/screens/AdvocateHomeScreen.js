import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import {
  ensureDirectConversation,
  ensureCareTeamConversation,
} from "../utils/conversations";

const client = generateClient();

const log = (...args) => console.log("[ADVOCATE_HOME]", ...args);

const LIST_MY_ADVOCATE_ASSIGNMENTS = /* GraphQL */ `
  query ListMyAdvocateAssignments(
    $advocateId: ID!
    $limit: Int
    $nextToken: String
  ) {
    listAdvocateAssignments(
      filter: { advocateId: { eq: $advocateId }, active: { eq: true } }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        active
        createdAt
      }
      nextToken
    }
  }
`;

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

const LIST_ADVOCATE_ASSIGNMENTS_FOR_PROVIDER_PATIENT = /* GraphQL */ `
  query ListAdvocateAssignmentsForProviderPatient(
    $patientId: ID!
    $providerId: ID!
  ) {
    listAdvocateAssignments(
      filter: {
        patientId: { eq: $patientId }
        providerId: { eq: $providerId }
        active: { eq: true }
      }
      limit: 50
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        active
        createdAt
      }
    }
  }
`;

const batchFetchUsers = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  const results = {};

  for (const id of unique) {
    try {
      const { data } = await client.graphql({
        query: GET_USER,
        variables: { id },
        authMode: "userPool",
      });
      if (data?.getUser) {
        results[id] = data.getUser;
      }
    } catch (err) {
      log("Failed to fetch user:", id, err);
    }
  }

  return results;
};

const AdvocateHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [assignments, setAssignments] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);

  const [advocateIdsByKey, setAdvocateIdsByKey] = useState({});
  const [usersById, setUsersById] = useState({});

  const advocateId = currentUser?.id ?? null;

  const roleLabelMap = useMemo(
    () => ({
      PATIENT: "Patient",
      PROVIDER: "Provider",
      ADVOCATE: "Advocate",
      ADMIN: "Admin",
    }),
    [],
  );

  const displayName = currentUser?.displayName ?? "Advocate";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Advocate";

  const processAssignments = useCallback(async (assignmentsList) => {
    try {
      const activeAssignments = assignmentsList.filter(
        (a) => a.active !== false,
      );
      const patientIds = activeAssignments.map((a) => a.patientId);
      const providerIds = activeAssignments.map((a) => a.providerId);
      const allIds = [...patientIds, ...providerIds];

      const fetched = await batchFetchUsers(allIds);

      setUsersById((prev) => ({ ...prev, ...fetched }));

      const map = {};
      activeAssignments.forEach((a) => {
        const pId = a.patientId;
        if (!pId) return;

        const key = `${pId}#${a.providerId || "NONE"}`;

        if (!map[key]) {
          map[key] = {
            patientId: pId,
            patientName:
              fetched[pId]?.displayName ??
              prevName(prevName) ??
              "Unknown Patient",
            providerId: a.providerId,
            providerName:
              fetched[a.providerId]?.displayName ??
              (a.providerId ? "Unknown Provider" : "No Provider"),
            createdAt: a.createdAt,
          };
        }
      });

      function prevName() {
        return null;
      }

      setPatients(Object.values(map));
    } catch (err) {
      log("Error processing assignments:", err);
    }
  }, []);

  const fetchAssignments = useCallback(
    async ({ reset = false } = {}) => {
      if (!advocateId) return;

      try {
        const variables = {
          advocateId,
          limit: 50,
          nextToken: reset ? null : nextToken,
        };

        const { data } = await client.graphql({
          query: LIST_MY_ADVOCATE_ASSIGNMENTS,
          variables,
          authMode: "userPool",
        });

        const result = data?.listAdvocateAssignments;
        const newItems = result?.items ?? [];

        const merged = reset ? newItems : [...assignments, ...newItems];

        setAssignments(merged);
        setNextToken(result?.nextToken ?? null);
        setError(null);

        await processAssignments(merged);
      } catch (err) {
        log("Error fetching assignments:", err);
        setError("Unable to load your patients.");
      }
    },
    [advocateId, nextToken, assignments, processAssignments],
  );

  useEffect(() => {
    if (!advocateId) {
      if (!loadingCurrentUser && loading) setLoading(false);
      return;
    }

    let isMounted = true;

    const bootstrap = async () => {
      try {
        setLoading(true);
        await fetchAssignments({ reset: true });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [advocateId, loadingCurrentUser, fetchAssignments]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setAdvocateIdsByKey({});
    setUsersById({});
    fetchAssignments({ reset: true })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [fetchAssignments]);

  const loadMore = () => {
    if (nextToken && !loading) {
      fetchAssignments({ reset: false }).catch(() => {});
    }
  };

  const handleOpenPatient = useCallback(
    (patient) => {
      navigation.navigate("PatientDetail", {
        patientId: patient.patientId,
        patientName: patient.patientName,
        providerId: patient.providerId,
        advocateId,
        fromRole: "ADVOCATE",
      });
    },
    [navigation, advocateId],
  );

  const loadAdvocateIdsForPatient = useCallback(
    async (patientId, providerId) => {
      if (!patientId || !providerId) return [];

      const cacheKey = `${patientId}#${providerId}`;
      if (advocateIdsByKey[cacheKey]) return advocateIdsByKey[cacheKey];

      try {
        const res = await client.graphql({
          query: LIST_ADVOCATE_ASSIGNMENTS_FOR_PROVIDER_PATIENT,
          variables: { patientId, providerId },
          authMode: "userPool",
        });

        const items = res?.data?.listAdvocateAssignments?.items || [];
        const advocateIds = Array.from(
          new Set(items.map((a) => a.advocateId).filter(Boolean)),
        );

        setAdvocateIdsByKey((prev) => ({
          ...prev,
          [cacheKey]: advocateIds,
        }));

        const missing = advocateIds.filter((id) => !usersById[id]);
        if (missing.length > 0) {
          const fetched = await batchFetchUsers(missing);
          setUsersById((prev) => ({ ...prev, ...fetched }));
        }

        return advocateIds;
      } catch (err) {
        log("loadAdvocateIdsForPatient error:", patientId, providerId, err);
        return [];
      }
    },
    [advocateIdsByKey, usersById],
  );

  const handleMessagePatient = useCallback(
    async (patient) => {
      if (!patient?.patientId || !advocateId) {
        Alert.alert("Error", "Missing user information to start a chat.");
        return;
      }

      try {
        const conversation = await ensureDirectConversation({
          currentUserId: advocateId,
          memberIds: [advocateId, patient.patientId],
          title: `${currentUser?.displayName || "Advocate"} ↔ ${
            patient.patientName || "Patient"
          }`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || patient.patientName || "Conversation",
        });
      } catch (err) {
        log("handleMessagePatient error:", err);
        Alert.alert(
          "Unable to open chat",
          "Something went wrong while opening the conversation.",
        );
      }
    },
    [advocateId, currentUser?.displayName, navigation],
  );

  const handleMessageProvider = useCallback(
    async (patient) => {
      if (!patient?.providerId || !advocateId) {
        Alert.alert("Error", "Missing provider information to start a chat.");
        return;
      }

      try {
        const providerName = patient.providerName || "Provider";

        const conversation = await ensureDirectConversation({
          currentUserId: advocateId,
          memberIds: [advocateId, patient.providerId],
          title: `${currentUser?.displayName || "Advocate"} ↔ ${providerName}`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || providerName || "Conversation",
        });
      } catch (err) {
        log("handleMessageProvider error:", err);
        Alert.alert(
          "Unable to open chat",
          "Something went wrong while opening the conversation.",
        );
      }
    },
    [advocateId, currentUser?.displayName, navigation],
  );

  const handleCareTeamChat = useCallback(
    async (patient) => {
      if (!patient?.patientId || !patient?.providerId || !advocateId) {
        Alert.alert("Error", "Missing information to start a care team chat.");
        return;
      }

      try {
        const advocateIds = await loadAdvocateIdsForPatient(
          patient.patientId,
          patient.providerId,
        );

        if (!advocateIds.length) {
          Alert.alert(
            "Care team unavailable",
            "No active advocate assignments were found for this provider relationship.",
          );
          return;
        }

        const conversation = await ensureCareTeamConversation({
          currentUserId: advocateId,
          patientId: patient.patientId,
          providerId: patient.providerId,
          advocateIds,
          title: `Care Team: ${patient.patientName || "Patient"} • ${
            patient.providerName || "Provider"
          }`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || "Care Team Chat",
        });
      } catch (err) {
        log("handleCareTeamChat error:", err);
        Alert.alert(
          "Unable to open care team chat",
          "Something went wrong while opening the care team conversation.",
        );
      }
    },
    [advocateId, loadAdvocateIdsForPatient, navigation],
  );

  const getCareTeamPreview = useCallback(
    (patient) => {
      const key = `${patient.patientId}#${patient.providerId}`;
      const ids = advocateIdsByKey[key] || [];
      const otherAdvocates = ids
        .filter((id) => id && id !== advocateId)
        .map((id) => usersById[id])
        .filter(Boolean);

      return {
        total: ids.length,
        otherAdvocates,
      };
    },
    [advocateIdsByKey, usersById, advocateId],
  );

  const renderPatientItem = ({ item }) => {
    const preview = getCareTeamPreview(item);
    const hasCachedAdvocates = preview.total > 0;

    return (
      <View style={styles.teamCard}>
        <TouchableOpacity
          onPress={() => handleOpenPatient(item)}
          style={styles.teamCardMain}
        >
          <View style={styles.rowBetween}>
            <Text style={styles.personName}>{item.patientName}</Text>
            <Text style={[styles.roleBadge, styles.patientBadge]}>Patient</Text>
          </View>

          <View style={styles.rowBetween}>
            <Text style={styles.metaText}>
              Provider: {item.providerName || "Provider"}
            </Text>
            <Text style={[styles.roleBadge, styles.providerBadge]}>
              Provider
            </Text>
          </View>

          <Text style={styles.metaText}>
            Added:{" "}
            {item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}
          </Text>

          <Text style={styles.metaText}>
            Advocates:{" "}
            {hasCachedAdvocates
              ? `${preview.total}`
              : "Tap Care Team Chat to load"}
          </Text>

          {preview.otherAdvocates.length > 0 ? (
            <Text style={styles.metaText} numberOfLines={2}>
              Other advocates:{" "}
              {preview.otherAdvocates
                .map((u) => u.displayName || u.email || "Advocate")
                .join(", ")}
            </Text>
          ) : null}
        </TouchableOpacity>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => handleCareTeamChat(item)}
          >
            <Text style={styles.primaryBtnText}>Care Team Chat</Text>
          </TouchableOpacity>

          <View style={styles.actionsRowSecondary}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => handleMessagePatient(item)}
            >
              <Text style={styles.secondaryBtnText}>Message Patient</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => handleMessageProvider(item)}
            >
              <Text style={styles.secondaryBtnText}>Message Provider</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const showGlobalLoader =
    (loading || loadingCurrentUser) && !refreshing && !patients.length;

  if (showGlobalLoader) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading your patients…</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View>
            <Text style={styles.greeting}>Hi, {displayName}</Text>
            <Text style={styles.subGreeting}>{roleLabel}</Text>
          </View>
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>{roleLabel}</Text>
          </View>
        </View>
        <Text style={styles.headerSubtitle}>
          Your assigned patients and their providers
        </Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Patients</Text>

        {patients.length === 0 ? (
          <Text style={styles.emptyText}>
            You don’t have any patients assigned yet.
          </Text>
        ) : (
          <FlatList
            data={patients}
            keyExtractor={(item) => `${item.patientId}#${item.providerId}`}
            renderItem={renderPatientItem}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: 12 }}
          />
        )}
      </View>
    </View>
  );
};

export default AdvocateHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
    paddingHorizontal: 16,
  },

  header: {
    marginBottom: 16,
    marginTop: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  greeting: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  subGreeting: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 2,
  },
  rolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#6B7280",
  },

  errorBox: {
    backgroundColor: "#FEE2E2",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    color: "#B91C1C",
  },

  section: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    color: "#111827",
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
  },

  teamCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
  },
  teamCardMain: {
    paddingBottom: 10,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },
  personName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
  },
  metaText: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 4,
  },

  roleBadge: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  patientBadge: {
    backgroundColor: "#E0E7FF",
    color: "#3730A3",
  },
  providerBadge: {
    backgroundColor: "#DBEAFE",
    color: "#1D4ED8",
  },

  actionsRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
    paddingTop: 10,
    gap: 10,
  },
  actionsRowSecondary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  primaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#1D4ED8",
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  secondaryBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  loadingText: {
    marginTop: 8,
    color: "#6B7280",
  },
});
