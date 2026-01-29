import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import PatientListItem from "../components/PatientListItem";
import RolePill from "../components/RolePill";

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
      if (data?.getUser) results[id] = data.getUser;
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

  const advocateId = currentUser?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [assignments, setAssignments] = useState([]);
  const [nextToken, setNextToken] = useState(null);
  const [error, setError] = useState(null);

  const [patients, setPatients] = useState([]);

  const [lastReadAtByConvoId, setLastReadAtByConvoId] = useState({});
  const [loadingReads, setLoadingReads] = useState(false);

  const [directConvoByPatientId, setDirectConvoByPatientId] = useState({});
  const [careTeamConvoByPairKey, setCareTeamConvoByPairKey] = useState({});

  const assignmentsRef = useRef([]);
  const nextTokenRef = useRef(null);

  const lastReadAtRef = useRef({});
  const directConvoRef = useRef({});
  const careTeamConvoRef = useRef({});

  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  useEffect(() => {
    nextTokenRef.current = nextToken;
  }, [nextToken]);

  useEffect(() => {
    lastReadAtRef.current = lastReadAtByConvoId;
  }, [lastReadAtByConvoId]);

  useEffect(() => {
    directConvoRef.current = directConvoByPatientId;
  }, [directConvoByPatientId]);

  useEffect(() => {
    careTeamConvoRef.current = careTeamConvoByPairKey;
  }, [careTeamConvoByPairKey]);

  const displayName = currentUser?.displayName ?? "Advocate";

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
          nextToken: reset ? null : nextTokenRef.current,
        };

        const { data } = await client.graphql({
          query: LIST_MY_ADVOCATE_ASSIGNMENTS,
          variables,
          authMode: "userPool",
        });

        const result = data?.listAdvocateAssignments;
        const newItems = result?.items ?? [];

        const merged = reset
          ? newItems
          : [...(assignmentsRef.current || []), ...newItems];

        assignmentsRef.current = merged;
        nextTokenRef.current = result?.nextToken ?? null;

        setAssignments(merged);
        setNextToken(result?.nextToken ?? null);
        setError(null);

        await processAssignments(merged);
      } catch (err) {
        log("Error fetching assignments:", err);
        setError("Unable to load your patients.");
      }
    },
    [advocateId, processAssignments],
  );

  const readsInFlightRef = useRef(false);

  const fetchMyReadState = useCallback(async () => {
    if (!advocateId) return;
    if (readsInFlightRef.current) return;

    readsInFlightRef.current = true;
    setLoadingReads(true);

    try {
      let next = null;
      const map = {};

      do {
        const { data } = await client.graphql({
          query: CONVERSATION_PARTICIPANTS_BY_USER,
          variables: {
            userId: advocateId,
            limit: 200,
            nextToken: next,
          },
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
    } catch (err) {
      log("fetchMyReadState error:", err);
      lastReadAtRef.current = {};
      setLastReadAtByConvoId({});
    } finally {
      setLoadingReads(false);
      readsInFlightRef.current = false;
    }
  }, [advocateId]);

  const convosInFlightRef = useRef(false);

  const fetchMyConversationsAndIndex = useCallback(async () => {
    if (!advocateId) return;
    if (convosInFlightRef.current) return;

    convosInFlightRef.current = true;

    try {
      let nt = null;
      const all = [];

      do {
        const { data } = await client.graphql({
          query: LIST_MY_CONVERSATIONS,
          variables: { sub: advocateId, limit: 200, nextToken: nt },
          authMode: "userPool",
        });

        const res = data?.listConversations;
        const items = res?.items || [];
        nt = res?.nextToken || null;

        all.push(...items);
      } while (nt);

      const directMap = {};
      const groupConvos = [];

      all.forEach((c) => {
        if (!c) return;

        if (c.isGroup === true) {
          groupConvos.push(c);
          return;
        }

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

      const groupById = {};
      groupConvos.forEach((c) => {
        if (c?.id) groupById[c.id] = c;
      });

      directConvoRef.current = directMap;
      setDirectConvoByPatientId(directMap);

      const careTeamMap = { __groupById: groupById };
      careTeamConvoRef.current = careTeamMap;
      setCareTeamConvoByPairKey(careTeamMap);
    } catch (err) {
      log("fetchMyConversationsAndIndex error:", err);
      directConvoRef.current = {};
      careTeamConvoRef.current = {};
      setDirectConvoByPatientId({});
      setCareTeamConvoByPairKey({});
    } finally {
      convosInFlightRef.current = false;
    }
  }, [advocateId]);

  useEffect(() => {
    if (!advocateId) {
      if (!loadingCurrentUser) setLoading(false);
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
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);

    Promise.all([
      fetchAssignments({ reset: true }).catch(() => {}),
      fetchMyReadState().catch(() => {}),
      fetchMyConversationsAndIndex().catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [fetchAssignments, fetchMyReadState, fetchMyConversationsAndIndex]);

  const loadMore = () => {
    if (nextTokenRef.current && !loading) {
      fetchAssignments({ reset: false }).catch(() => {});
    }
  };

  const focusStaleRef = useRef({ lastAt: 0 });

  useFocusEffect(
    useCallback(() => {
      if (!advocateId) return;

      const now = Date.now();
      const STALE_MS = 15000;

      if (now - focusStaleRef.current.lastAt < STALE_MS) return;

      focusStaleRef.current.lastAt = now;

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

  const computeUnreadForRow = useCallback(
    (row) => {
      const directConvo = directConvoRef.current?.[row.patientId] || null;

      const groupById = careTeamConvoRef.current?.__groupById || {};
      const candidateGroups = Object.values(groupById);

      const careTeamConvo =
        candidateGroups.find((c) => {
          const ids = Array.isArray(c?.memberIds) ? c.memberIds : [];
          return (
            c?.isGroup === true &&
            ids.includes(advocateId) &&
            ids.includes(row.patientId) &&
            ids.includes(row.providerId)
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

      return convos.some(unreadForConvo);
    },
    [advocateId],
  );

  const renderPatientItem = ({ item }) => {
    const subtitle = `Provider: ${item.providerName || "Unknown Provider"}`;
    const isUnread = computeUnreadForRow(item);

    return (
      <View style={{ marginBottom: 10 }}>
        <PatientListItem
          name={item.patientName || "Patient"}
          subtitle={subtitle}
          unread={isUnread}
          onPress={() => handleOpenPatient(item)}
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
        { paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {displayName}</Text>
        </View>

        <RolePill role="ADVOCATE" />
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

      {loadingReads ? (
        <View style={styles.readsSpinner}>
          <ActivityIndicator size="small" />
        </View>
      ) : null}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  greeting: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
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

  readsSpinner: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
