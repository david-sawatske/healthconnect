import React, { useEffect, useState, useCallback } from "react";
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

  const [advocateIdsByPatient, setAdvocateIdsByPatient] = useState({});

  const advocateId = currentUser?.id ?? null;

  const processAssignments = async (assignmentsList) => {
    try {
      const activeAssignments = assignmentsList.filter(
        (a) => a.active !== false,
      );
      const patientIds = activeAssignments.map((a) => a.patientId);
      const providerIds = activeAssignments.map((a) => a.providerId);
      const allIds = [...patientIds, ...providerIds];

      const userMap = await batchFetchUsers(allIds);

      const map = {};
      assignmentsList.forEach((a) => {
        const pId = a.patientId;
        if (!pId) return;

        const key = pId;

        if (!map[key]) {
          map[key] = {
            patientId: pId,
            patientName: userMap[pId]?.displayName ?? "Unknown Patient",
            providerId: a.providerId,
            providerName: userMap[a.providerId]?.displayName ?? "No Provider",
            createdAt: a.createdAt,
          };
        }
      });

      setPatients(Object.values(map));
    } catch (err) {
      log("Error processing assignments:", err);
    }
  };

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
    [advocateId, nextToken, assignments],
  );

  useEffect(() => {
    if (!advocateId) {
      if (!loadingCurrentUser && loading) {
        setLoading(false);
      }
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
  }, [advocateId, loadingCurrentUser]);

  const onRefresh = () => {
    setRefreshing(true);
    setAdvocateIdsByPatient({});
    fetchAssignments({ reset: true })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  const loadMore = () => {
    if (nextToken && !loading) {
      fetchAssignments({ reset: false }).catch(() => {});
    }
  };

  const handleOpenPatient = (patient) => {
    navigation.navigate("PatientDetail", {
      patientId: patient.patientId,
      patientName: patient.patientName,
      providerId: patient.providerId,
      advocateId,
      fromRole: "ADVOCATE",
    });
  };

  const loadAdvocateIdsForPatient = useCallback(
    async (patientId, providerId) => {
      if (!patientId || !providerId) return [];

      const cacheKey = `${patientId}#${providerId}`;
      if (advocateIdsByPatient[cacheKey]) return advocateIdsByPatient[cacheKey];

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

        setAdvocateIdsByPatient((prev) => ({
          ...prev,
          [cacheKey]: advocateIds,
        }));

        return advocateIds;
      } catch (err) {
        log("loadAdvocateIdsForPatient error:", patientId, providerId, err);
        return [];
      }
    },
    [advocateIdsByPatient],
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
          title:
            conversation.title ||
            patient.patientName ||
            "Advocate–Patient Conversation",
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
            "No advocates assigned",
            "A care team chat requires an active advocate assignment.",
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

  const renderPatientItem = ({ item }) => (
    <View style={styles.patientCard}>
      <TouchableOpacity
        onPress={() => handleOpenPatient(item)}
        style={styles.patientInfo}
      >
        <Text style={styles.patientName}>{item.patientName}</Text>
        <Text style={styles.patientMeta}>Provider: {item.providerName}</Text>
        <Text style={styles.patientMeta}>
          Added: {new Date(item.createdAt).toLocaleString()}
        </Text>
      </TouchableOpacity>

      <View style={styles.cardRight}>
        <TouchableOpacity
          style={styles.careTeamButton}
          onPress={() => handleCareTeamChat(item)}
        >
          <Text style={styles.careTeamButtonText}>Care Team</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.messageButton}
          onPress={() => handleMessagePatient(item)}
        >
          <Text style={styles.messageButtonText}>Message</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const roleLabelMap = {
    PATIENT: "Patient",
    PROVIDER: "Provider",
    ADVOCATE: "Advocate",
    ADMIN: "Admin",
  };

  const displayName = currentUser?.displayName ?? "Advocate";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Advocate";

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
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
  },
  patientCard: {
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  patientInfo: {
    flex: 1,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "600",
  },
  patientMeta: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 4,
  },
  cardRight: {
    marginLeft: 8,
    gap: 8,
    alignItems: "flex-end",
  },
  careTeamButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1D4ED8",
  },
  careTeamButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  messageButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  messageButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  loadingText: {
    marginTop: 8,
    color: "#6B7280",
  },
});
