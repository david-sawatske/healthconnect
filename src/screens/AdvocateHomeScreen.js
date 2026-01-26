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
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import ConversationListItem from "../components/ConversationListItem";
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

const LIST_MY_CONVERSATIONS = /* GraphQL */ `
  query ListMyConversations($sub: String!, $limit: Int, $nextToken: String) {
    listConversations(
      filter: { memberIds: { contains: $sub } }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        title
        memberIds
        isGroup
        createdAt
        updatedAt
        lastMessageAt
      }
      nextToken
    }
  }
`;

const CONVERSATION_PARTICIPANTS_BY_USER = /* GraphQL */ `
  query ConversationParticipantsByUser(
    $userId: String!
    $limit: Int
    $nextToken: String
  ) {
    conversationParticipantsByUser(
      userId: $userId
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        conversationId
        userId
        lastReadAt
        updatedAt
      }
      nextToken
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

  const [lastReadAtByConvoId, setLastReadAtByConvoId] = useState({});
  const [directConvoByPatientId, setDirectConvoByPatientId] = useState({});
  const [careTeamConvoByPairKey, setCareTeamConvoByPairKey] = useState({});
  const [loadingReads, setLoadingReads] = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(false);

  const lastReadAtRef = useRef({});
  const directConvoRef = useRef({});
  const careTeamConvoRef = useRef({});

  useEffect(() => {
    lastReadAtRef.current = lastReadAtByConvoId;
  }, [lastReadAtByConvoId]);

  useEffect(() => {
    directConvoRef.current = directConvoByPatientId;
  }, [directConvoByPatientId]);

  useEffect(() => {
    careTeamConvoRef.current = careTeamConvoByPairKey;
  }, [careTeamConvoByPairKey]);

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
      const activeAssignments = (assignmentsList || []).filter(
        (a) => a.active !== false,
      );

      const patientIds = activeAssignments.map((a) => a.patientId);
      const providerIds = activeAssignments.map((a) => a.providerId);
      const allIds = [...patientIds, ...providerIds];

      const userMap = await batchFetchUsers(allIds);

      const map = {};

      activeAssignments.forEach((a) => {
        const pId = a.patientId;
        const prId = a.providerId;
        if (!pId || !prId) return;

        const key = `${pId}#${prId}`;

        if (!map[key]) {
          map[key] = {
            patientId: pId,
            patientName: userMap[pId]?.displayName ?? "Unknown Patient",
            providerId: prId,
            providerName: userMap[prId]?.displayName ?? "Unknown Provider",
            createdAt: a.createdAt,
          };
        }
      });

      const rows = Object.values(map).sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      setPatients(rows);
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

  const fetchMyReadState = useCallback(async () => {
    if (!advocateId) return;

    setLoadingReads(true);
    try {
      let next = null;
      const map = {};

      do {
        const { data } = await client.graphql({
          query: CONVERSATION_PARTICIPANTS_BY_USER,
          variables: { userId: advocateId, limit: 200, nextToken: next },
          authMode: "userPool",
        });

        const res = data?.conversationParticipantsByUser;
        const items = res?.items || [];
        next = res?.nextToken || null;

        items.forEach((p) => {
          if (p?.conversationId) map[p.conversationId] = p.lastReadAt || null;
        });
      } while (next);

      lastReadAtRef.current = map;
      setLastReadAtByConvoId(map);
    } catch (e) {
      log("fetchMyReadState error:", e);
      lastReadAtRef.current = {};
      setLastReadAtByConvoId({});
    } finally {
      setLoadingReads(false);
    }
  }, [advocateId]);

  const fetchMyConversationsAndIndex = useCallback(async () => {
    if (!advocateId) return;

    setLoadingConvos(true);
    try {
      let nextToken = null;
      const all = [];

      do {
        const { data } = await client.graphql({
          query: LIST_MY_CONVERSATIONS,
          variables: { sub: advocateId, limit: 200, nextToken },
          authMode: "userPool",
        });

        const res = data?.listConversations;
        const items = res?.items || [];
        nextToken = res?.nextToken || null;

        all.push(...items);
      } while (nextToken);

      const directMap = {};
      const careTeamMap = {};

      all
        .filter((c) => c && c.isGroup === false)
        .forEach((c) => {
          const memberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
          const otherIds = memberIds.filter((id) => id && id !== advocateId);
          const otherId = otherIds[0] || null;
          if (!otherId) return;

          const existing = directMap[otherId];
          if (!existing) {
            directMap[otherId] = c;
            return;
          }
          const a = new Date(
            existing.lastMessageAt || existing.updatedAt || 0,
          ).getTime();
          const b = new Date(c.lastMessageAt || c.updatedAt || 0).getTime();
          if (b > a) directMap[otherId] = c;
        });

      const groupConvos = all.filter((c) => c && c.isGroup === true);

      const groupById = {};
      groupConvos.forEach((c) => {
        if (c?.id) groupById[c.id] = c;
      });

      directConvoRef.current = directMap;
      setDirectConvoByPatientId(directMap);

      careTeamConvoRef.current = { __groupById: groupById };
      setCareTeamConvoByPairKey({ __groupById: groupById });
    } catch (e) {
      log("fetchMyConversationsAndIndex error:", e);
      directConvoRef.current = {};
      careTeamConvoRef.current = {};
      setDirectConvoByPatientId({});
      setCareTeamConvoByPairKey({});
    } finally {
      setLoadingConvos(false);
    }
  }, [advocateId]);

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
        await Promise.all([
          fetchAssignments({ reset: true }),
          fetchMyReadState(),
          fetchMyConversationsAndIndex(),
        ]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [
    advocateId,
    loadingCurrentUser,
    fetchAssignments,
    fetchMyReadState,
    fetchMyConversationsAndIndex,
    loading,
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setAdvocateIdsByPatient({});
    Promise.all([
      fetchAssignments({ reset: true }).catch(() => {}),
      fetchMyReadState().catch(() => {}),
      fetchMyConversationsAndIndex().catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [fetchAssignments, fetchMyReadState, fetchMyConversationsAndIndex]);

  const loadMore = () => {
    if (nextToken && !loading) {
      fetchAssignments({ reset: false }).catch(() => {});
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!advocateId) return;
      fetchMyReadState();
      fetchMyConversationsAndIndex();
      return () => {};
    }, [advocateId, fetchMyReadState, fetchMyConversationsAndIndex]),
  );

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

        setDirectConvoByPatientId((prev) => ({
          ...prev,
          [patient.patientId]: conversation,
        }));

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

  const renderPatientItem = ({ item }) => {
    const preview = `Provider: ${item.providerName || "Unknown Provider"}`;

    const directConvo = directConvoRef.current?.[item.patientId] || null;

    const groupById = careTeamConvoRef.current?.__groupById || {};
    const candidateGroupConvos = Object.values(groupById);

    const careTeamConvo =
      candidateGroupConvos.find((c) => {
        const ids = Array.isArray(c?.memberIds) ? c.memberIds : [];
        return (
          c?.isGroup === true &&
          ids.includes(advocateId) &&
          ids.includes(item.patientId) &&
          ids.includes(item.providerId)
        );
      }) || null;

    const convos = [directConvo, careTeamConvo].filter(Boolean);

    const unreadForConvo = (c) => {
      const lastMsgAt = c?.lastMessageAt || null;
      if (!lastMsgAt) return false;
      const lastReadAt = lastReadAtRef.current?.[c.id] || null;
      return (
        !lastReadAt ||
        new Date(lastReadAt).getTime() < new Date(lastMsgAt).getTime()
      );
    };

    const isUnread = convos.some(unreadForConvo);

    const latestTs = convos.reduce((acc, c) => {
      const t = c?.lastMessageAt || c?.updatedAt || c?.createdAt || null;
      if (!t) return acc;
      if (!acc) return t;
      return new Date(t).getTime() > new Date(acc).getTime() ? t : acc;
    }, null);

    const rightAccessory = (
      <View style={styles.rowRight}>
        {isUnread ? <View style={styles.unreadDot} /> : null}

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
    );

    return (
      <View style={{ marginBottom: 10 }}>
        <ConversationListItem
          title={item.patientName || "Patient"}
          preview={preview}
          timestamp={latestTs || item.createdAt}
          unread={isUnread}
          onPress={() => handleOpenPatient(item)}
          maxPreviewLines={2}
          rightAccessory={rightAccessory}
          testID={`patient-${item.patientId}-${item.providerId}`}
        />
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
            <View style={styles.greetingRow}>
              <Text style={styles.greeting}>Hi, {displayName}</Text>
              {(loadingReads || loadingConvos) && (
                <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
              )}
            </View>
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
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
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
    color: "#111827",
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
  },
  loadingText: {
    marginTop: 8,
    color: "#6B7280",
  },

  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#2563EB",
    marginRight: 2,
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
});
