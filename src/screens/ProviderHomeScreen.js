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
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
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

const log = (...args) => console.log("[PROVIDER_HOME]", ...args);

const LIST_PROVIDER_PATIENTS = /* GraphQL */ `
  query ListProviderPatients($providerId: ID!) {
    providerPatientsByProvider(providerId: $providerId) {
      items {
        id
        patient {
          id
          displayName
          email
          role
        }
      }
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

const ProviderHomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [advocateIdsByPatient, setAdvocateIdsByPatient] = useState({});

  const [lastReadAtByConvoId, setLastReadAtByConvoId] = useState({});
  const [directConvoByPatientId, setDirectConvoByPatientId] = useState({});
  const [loadingReads, setLoadingReads] = useState(false);
  const [loadingConvos, setLoadingConvos] = useState(false);

  const lastReadAtRef = useRef({});
  const directConvoRef = useRef({});

  useEffect(() => {
    lastReadAtRef.current = lastReadAtByConvoId;
  }, [lastReadAtByConvoId]);

  useEffect(() => {
    directConvoRef.current = directConvoByPatientId;
  }, [directConvoByPatientId]);

  const roleLabelMap = useMemo(
    () => ({
      PATIENT: "Patient",
      PROVIDER: "Provider",
      ADVOCATE: "Advocate",
      ADMIN: "Admin",
    }),
    [],
  );

  const displayName = currentUser?.displayName || "Provider";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Provider";

  const fetchMyReadState = useCallback(async () => {
    if (!currentUser?.id) return;

    setLoadingReads(true);
    try {
      let next = null;
      const map = {};

      do {
        const { data } = await client.graphql({
          query: CONVERSATION_PARTICIPANTS_BY_USER,
          variables: { userId: currentUser.id, limit: 200, nextToken: next },
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
  }, [currentUser?.id]);

  const fetchMyConversationsAndIndexByPatient = useCallback(async () => {
    if (!currentUser?.id) return;

    setLoadingConvos(true);
    try {
      let nextToken = null;
      const all = [];

      do {
        const { data } = await client.graphql({
          query: LIST_MY_CONVERSATIONS,
          variables: { sub: currentUser.id, limit: 200, nextToken },
          authMode: "userPool",
        });

        const res = data?.listConversations;
        const items = res?.items || [];
        nextToken = res?.nextToken || null;

        all.push(...items);
      } while (nextToken);

      const directs = all.filter((c) => c && c.isGroup === false);

      const map = {};
      directs.forEach((c) => {
        const memberIds = Array.isArray(c.memberIds) ? c.memberIds : [];
        const otherIds = memberIds.filter((id) => id && id !== currentUser.id);
        const otherId = otherIds[0] || null;
        if (!otherId) return;

        const existing = map[otherId];
        if (!existing) {
          map[otherId] = c;
          return;
        }
        const a = new Date(
          existing.lastMessageAt || existing.updatedAt || 0,
        ).getTime();
        const b = new Date(c.lastMessageAt || c.updatedAt || 0).getTime();
        if (b > a) map[otherId] = c;
      });

      directConvoRef.current = map;
      setDirectConvoByPatientId(map);
    } catch (e) {
      log("fetchMyConversationsAndIndexByPatient error:", e);
      directConvoRef.current = {};
      setDirectConvoByPatientId({});
    } finally {
      setLoadingConvos(false);
    }
  }, [currentUser?.id]);

  const loadAdvocateIdsForPatient = useCallback(
    async (patientId) => {
      if (!currentUser?.id || !patientId) return [];

      if (advocateIdsByPatient[patientId])
        return advocateIdsByPatient[patientId];

      try {
        const res = await client.graphql({
          query: LIST_ADVOCATE_ASSIGNMENTS_FOR_PROVIDER_PATIENT,
          variables: { patientId, providerId: currentUser.id },
          authMode: "userPool",
        });

        const items = res?.data?.listAdvocateAssignments?.items || [];
        const advocateIds = Array.from(
          new Set(items.map((a) => a.advocateId).filter(Boolean)),
        );

        setAdvocateIdsByPatient((prev) => ({
          ...prev,
          [patientId]: advocateIds,
        }));

        return advocateIds;
      } catch (err) {
        log("loadAdvocateIdsForPatient error:", patientId, err);
        return [];
      }
    },
    [currentUser?.id, advocateIdsByPatient],
  );

  const loadPatients = useCallback(async () => {
    if (!currentUser?.id) return;

    setLoading(true);
    try {
      const res = await client.graphql({
        query: LIST_PROVIDER_PATIENTS,
        variables: { providerId: currentUser.id },
        authMode: "userPool",
      });

      const links = res?.data?.providerPatientsByProvider?.items || [];
      const items = links.map((link) => link.patient).filter(Boolean);

      setPatients(items);

      (async () => {
        const first = items.slice(0, 10);
        for (const p of first) {
          if (!p?.id) continue;
          if (advocateIdsByPatient[p.id]) continue;
          await loadAdvocateIdsForPatient(p.id);
        }
      })().catch(() => {});
    } catch (err) {
      log("loadPatients error:", err);
      Alert.alert("Error", "Failed to load patients.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, loadAdvocateIdsForPatient, advocateIdsByPatient]);

  useEffect(() => {
    if (currentUser?.id) {
      loadPatients();
      fetchMyReadState();
      fetchMyConversationsAndIndexByPatient();
    }
  }, [
    currentUser?.id,
    loadPatients,
    fetchMyReadState,
    fetchMyConversationsAndIndexByPatient,
  ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setAdvocateIdsByPatient({});
      await Promise.all([
        loadPatients(),
        fetchMyReadState(),
        fetchMyConversationsAndIndexByPatient(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [loadPatients, fetchMyReadState, fetchMyConversationsAndIndexByPatient]);

  useFocusEffect(
    useCallback(() => {
      if (!currentUser?.id) return;

      fetchMyReadState();
      fetchMyConversationsAndIndexByPatient();

      return () => {};
    }, [
      currentUser?.id,
      fetchMyReadState,
      fetchMyConversationsAndIndexByPatient,
    ]),
  );

  const handlePressPatient = useCallback(
    (patient) => {
      if (!currentUser?.id) {
        Alert.alert("Error", "Provider not loaded yet.");
        return;
      }

      navigation.navigate("PatientDetail", {
        patientId: patient.id,
        patientName: patient.displayName || "Patient",
        providerId: currentUser.id,
        fromRole: "PROVIDER",
      });
    },
    [currentUser?.id, navigation],
  );

  const handleMessagePatient = useCallback(
    async (patient) => {
      if (!patient?.id || !currentUser?.id) {
        Alert.alert("Error", "Missing user information to start a chat.");
        return;
      }

      try {
        const conversation = await ensureDirectConversation({
          currentUserId: currentUser.id,
          memberIds: [currentUser.id, patient.id],
          title: `${currentUser.displayName || "Provider"} ↔ ${
            patient.displayName || "Patient"
          }`,
        });

        setDirectConvoByPatientId((prev) => ({
          ...prev,
          [patient.id]: conversation,
        }));

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title:
            conversation.title ||
            patient.displayName ||
            "Provider–Patient Conversation",
        });
      } catch (err) {
        log("handleMessagePatient error:", err);
        Alert.alert(
          "Unable to open chat",
          "Something went wrong while opening the conversation.",
        );
      }
    },
    [currentUser?.id, currentUser?.displayName, navigation],
  );

  const handleCareTeamChat = useCallback(
    async (patient) => {
      if (!patient?.id || !currentUser?.id) {
        Alert.alert("Error", "Missing user information to start a chat.");
        return;
      }

      try {
        const advocateIds = await loadAdvocateIdsForPatient(patient.id);

        if (!advocateIds.length) {
          Alert.alert(
            "No advocates assigned",
            "Assign an advocate to enable a care team chat for this patient.",
          );
          return;
        }

        const conversation = await ensureCareTeamConversation({
          currentUserId: currentUser.id,
          patientId: patient.id,
          providerId: currentUser.id,
          advocateIds,
          title: `Care Team: ${patient.displayName || "Patient"}`,
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
    [currentUser?.id, loadAdvocateIdsForPatient, navigation],
  );

  const renderPatientItem = ({ item }) => {
    const cachedAdvIds = advocateIdsByPatient[item.id];
    const hasCache = Array.isArray(cachedAdvIds);
    const count = hasCache ? cachedAdvIds.length : null;

    const preview = item.email
      ? item.email
      : hasCache
        ? count > 0
          ? `Advocates assigned: ${count}`
          : "No advocates assigned (care team chat disabled)"
        : "Advocates: — (tap Care Team to load)";

    const convo = directConvoRef.current?.[item.id] || null;
    const lastMsgAt = convo?.lastMessageAt || null;
    const lastReadAt = convo?.id ? lastReadAtRef.current?.[convo.id] : null;

    const isUnread =
      !!lastMsgAt &&
      (!lastReadAt ||
        new Date(lastReadAt).getTime() < new Date(lastMsgAt).getTime());

    const timestamp = lastMsgAt || null;

    const rightAccessory = (
      <View style={styles.rowRight}>
        {isUnread ? <View style={styles.unreadDot} /> : null}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => handleCareTeamChat(item)}
        >
          <Text style={styles.secondaryButtonText}>Care Team</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.messageButton}
          onPress={() => handleMessagePatient(item)}
        >
          <Text style={styles.messageButtonText}>Message</Text>
        </TouchableOpacity>

        <Text style={styles.patientChevron}>›</Text>
      </View>
    );

    return (
      <ConversationListItem
        title={item.displayName || "Unnamed Patient"}
        preview={preview}
        timestamp={timestamp}
        unread={isUnread}
        onPress={() => handlePressPatient(item)}
        maxPreviewLines={2}
        rightAccessory={rightAccessory}
        testID={`patient-${item.id}`}
      />
    );
  };

  const showGlobalLoader = (loading || loadingCurrentUser) && !patients.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>Hi,</Text>
          <Text style={styles.headerTitle}>
            {loadingCurrentUser ? "Loading..." : displayName}
          </Text>
          <View style={styles.subRow}>
            <Text style={styles.headerSub}>My Patients</Text>
            {(loadingReads || loadingConvos) && (
              <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
            )}
          </View>
        </View>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>{roleLabel}</Text>
        </View>
      </View>

      {showGlobalLoader ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading patients…</Text>
        </View>
      ) : patients.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No patients found</Text>
          <Text style={styles.emptyText}>
            Add some seeded patients or adjust the query if you’re scoping by
            provider–patient relationships.
          </Text>
        </View>
      ) : (
        <FlatList
          data={patients}
          keyExtractor={(item) => item.id}
          renderItem={renderPatientItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
};

export default ProviderHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F5F7",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerGreeting: {
    fontSize: 14,
    color: "#6B7280",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerSub: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 2,
  },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#E0F2FE",
  },
  rolePillText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0369A1",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
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

  secondaryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1D4ED8",
  },
  secondaryButtonText: {
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
  patientChevron: {
    fontSize: 24,
    color: "#9CA3AF",
    marginLeft: 2,
  },

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: "#6B7280",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
});
