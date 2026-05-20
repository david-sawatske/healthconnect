import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import PatientListItem from "../components/PatientListItem";
import RolePill from "../components/RolePill";
import { DeclineAdvocateInvite } from "../graphql/advocateInvites";
import { ApproveInviteServer } from "../graphql/customMutations";
import {
  listAllConversationsForUser,
  listConversationReadStateForUser,
} from "../features/chat/conversationService";
import { getUserDisplayName, getUsersByIds } from "../services/userService";
import { theme } from "../ui/theme";

const client = generateClient();

const devLog = (...args) => {
  if (__DEV__) console.log("[ADVOCATE_HOME]", ...args);
};

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

const LIST_MY_PENDING_ADVOCATE_INVITES = /* GraphQL */ `
  query ListMyPendingAdvocateInvites(
    $advocateId: String!
    $limit: Int
    $nextToken: String
  ) {
    listAdvocateInvites(
      filter: { advocateId: { eq: $advocateId }, status: { eq: PENDING } }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        conversationId
        status
        createdBy
        approvedBy
        approvedAt
        createdAt
        updatedAt
      }
      nextToken
    }
  }
`;

function getProviderSummary(providers = []) {
  const names = providers.map((p) => p.providerName).filter(Boolean);

  if (names.length === 0) return "No providers";
  if (names.length === 1) return `Provider: ${names[0]}`;

  return `${names.length} providers • ${names[0]} +${names.length - 1}`;
}

const AdvocateHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const advocateId = currentUser?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [assignments, setAssignments] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [loadingPendingInvites, setLoadingPendingInvites] = useState(false);
  const [nextToken, setNextToken] = useState(null);
  const [error, setError] = useState(null);

  const [patients, setPatients] = useState([]);
  const [inviteUsersById, setInviteUsersById] = useState({});

  const [lastReadAtByConvoId, setLastReadAtByConvoId] = useState({});
  const [loadingReads, setLoadingReads] = useState(false);

  const [directConvoByPatientId, setDirectConvoByPatientId] = useState({});
  const [careTeamConvoByPairKey, setCareTeamConvoByPairKey] = useState({});

  const [selectedInvite, setSelectedInvite] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

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

  const closeInviteModal = useCallback(() => {
    if (inviteBusy) return;
    setModalVisible(false);
    setSelectedInvite(null);
  }, [inviteBusy]);

  const processAssignments = useCallback(async (assignmentsList) => {
    try {
      const activeAssignments = (assignmentsList || []).filter(
        (a) => a.active !== false,
      );

      const patientIds = activeAssignments.map((a) => a.patientId);
      const providerIds = activeAssignments.map((a) => a.providerId);
      const allIds = [...patientIds, ...providerIds];

      const userMap = await getUsersByIds(allIds);

      const patientMap = {};

      activeAssignments.forEach((assignment) => {
        const patientId = assignment.patientId;
        const providerId = assignment.providerId;

        if (!patientId || !providerId) return;

        if (!patientMap[patientId]) {
          patientMap[patientId] = {
            patientId,
            patientName: getUserDisplayName(
              userMap[patientId],
              "Unknown Patient",
            ),
            providers: [],
            createdAt: assignment.createdAt,
          };
        }

        const existingProvider = patientMap[patientId].providers.some(
          (provider) => provider.providerId === providerId,
        );

        if (!existingProvider) {
          patientMap[patientId].providers.push({
            providerId,
            providerName: getUserDisplayName(
              userMap[providerId],
              "Unknown Provider",
            ),
            assignmentId: assignment.id,
            createdAt: assignment.createdAt,
          });
        }

        const currentCreatedAt = new Date(
          patientMap[patientId].createdAt || 0,
        ).getTime();
        const assignmentCreatedAt = new Date(
          assignment.createdAt || 0,
        ).getTime();

        if (assignmentCreatedAt > currentCreatedAt) {
          patientMap[patientId].createdAt = assignment.createdAt;
        }
      });

      const rows = Object.values(patientMap)
        .map((patient) => ({
          ...patient,
          providers: [...(patient.providers || [])].sort((a, b) =>
            (a.providerName || "").localeCompare(b.providerName || ""),
          ),
        }))
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );

      setPatients(rows);
    } catch (err) {
      devLog("Error processing assignments:", err);
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
        devLog("Error fetching assignments:", err);
        setError("Unable to load your patients.");
      }
    },
    [advocateId, processAssignments],
  );

  const fetchPendingInvites = useCallback(async () => {
    if (!advocateId) return;

    setLoadingPendingInvites(true);

    try {
      let nt = null;
      const all = [];

      do {
        const { data } = await client.graphql({
          query: LIST_MY_PENDING_ADVOCATE_INVITES,
          variables: {
            advocateId,
            limit: 100,
            nextToken: nt,
          },
          authMode: "userPool",
        });

        const res = data?.listAdvocateInvites;
        const items = res?.items || [];
        nt = res?.nextToken || null;

        all.push(...items);
      } while (nt);

      setPendingInvites(all);

      const userIds = all.flatMap((invite) => [
        invite.patientId,
        invite.providerId,
        invite.createdBy,
      ]);

      if (userIds.length > 0) {
        const userMap = await getUsersByIds(userIds);
        setInviteUsersById(userMap);
      } else {
        setInviteUsersById({});
      }
    } catch (err) {
      devLog("Error fetching pending invites:", err);
    } finally {
      setLoadingPendingInvites(false);
    }
  }, [advocateId]);

  const readsInFlightRef = useRef(false);

  const fetchMyReadState = useCallback(async () => {
    if (!advocateId) return;
    if (readsInFlightRef.current) return;

    readsInFlightRef.current = true;
    setLoadingReads(true);

    try {
      const map = await listConversationReadStateForUser(advocateId, {
        limit: 200,
      });

      lastReadAtRef.current = map;
      setLastReadAtByConvoId(map);
    } catch (err) {
      devLog("fetchMyReadState error:", err);
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
      const all = await listAllConversationsForUser(advocateId, {
        limit: 200,
      });

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
      devLog("fetchMyConversationsAndIndex error:", err);
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
          fetchPendingInvites(),
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
    fetchPendingInvites,
    fetchMyReadState,
    fetchMyConversationsAndIndex,
  ]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);

    Promise.all([
      fetchAssignments({ reset: true }).catch(() => {}),
      fetchPendingInvites().catch(() => {}),
      fetchMyReadState().catch(() => {}),
      fetchMyConversationsAndIndex().catch(() => {}),
    ])
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [
    fetchAssignments,
    fetchPendingInvites,
    fetchMyReadState,
    fetchMyConversationsAndIndex,
  ]);

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
      const firstProvider = patient.providers?.[0] || null;

      navigation.navigate("PatientDetail", {
        patientId: patient.patientId,
        patientName: patient.patientName,
        providers: patient.providers || [],
        providerId: firstProvider?.providerId || null,
        providerName: firstProvider?.providerName || null,
        advocateId,
        fromRole: "ADVOCATE",
      });
    },
    [navigation, advocateId],
  );

  const pendingInviteRows = useMemo(() => {
    return [...pendingInvites]
      .sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime(),
      )
      .map((invite) => {
        const providerUser =
          inviteUsersById[invite.providerId] ||
          inviteUsersById[invite.createdBy] ||
          null;

        return {
          ...invite,
          patientName: getUserDisplayName(
            inviteUsersById[invite.patientId],
            "Unknown Patient",
          ),
          providerName: getUserDisplayName(providerUser, "Unknown Provider"),
        };
      });
  }, [pendingInvites, inviteUsersById]);

  const computeUnreadForRow = useCallback(
    (row) => {
      const directConvo = directConvoRef.current?.[row.patientId] || null;

      const groupById = careTeamConvoRef.current?.__groupById || {};
      const candidateGroups = Object.values(groupById);

      const careTeamConvos = (row.providers || [])
        .map((provider) => {
          return (
            candidateGroups.find((c) => {
              const ids = Array.isArray(c?.memberIds) ? c.memberIds : [];
              return (
                c?.isGroup === true &&
                ids.includes(advocateId) &&
                ids.includes(row.patientId) &&
                ids.includes(provider.providerId)
              );
            }) || null
          );
        })
        .filter(Boolean);

      const convos = [directConvo, ...careTeamConvos].filter(Boolean);

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

  const handleAcceptInvite = useCallback(async () => {
    if (!selectedInvite?.id) return;

    try {
      setInviteBusy(true);

      const res = await client.graphql({
        query: ApproveInviteServer,
        variables: { inviteId: selectedInvite.id },
        authMode: "userPool",
      });

      devLog("Approve invite success:", res);

      setModalVisible(false);
      setSelectedInvite(null);

      await Promise.all([
        fetchPendingInvites(),
        fetchAssignments({ reset: true }),
        fetchMyReadState(),
        fetchMyConversationsAndIndex(),
      ]);
    } catch (err) {
      devLog("Accept invite failed:", err);
      Alert.alert("Error", "Failed to accept invite.");
    } finally {
      setInviteBusy(false);
    }
  }, [
    selectedInvite,
    fetchPendingInvites,
    fetchAssignments,
    fetchMyReadState,
    fetchMyConversationsAndIndex,
  ]);

  const handleDeclineInvite = useCallback(async () => {
    if (!selectedInvite?.id) return;

    try {
      setInviteBusy(true);

      const res = await client.graphql({
        query: DeclineAdvocateInvite,
        variables: {
          input: {
            id: selectedInvite.id,
            status: "DECLINED",
          },
        },
        authMode: "userPool",
      });

      devLog("Decline invite success:", res);

      setModalVisible(false);
      setSelectedInvite(null);

      await fetchPendingInvites();
    } catch (err) {
      devLog("Decline invite failed:", err);
      Alert.alert("Error", "Failed to decline invite.");
    } finally {
      setInviteBusy(false);
    }
  }, [selectedInvite, fetchPendingInvites]);

  const renderPatientItem = ({ item }) => {
    const subtitle = getProviderSummary(item.providers);
    const isUnread = computeUnreadForRow(item);

    return (
      <View style={{ marginBottom: theme.space.xs }}>
        <PatientListItem
          name={item.patientName || "Patient"}
          subtitle={subtitle}
          unread={isUnread}
          onPress={() => handleOpenPatient(item)}
          testID={`patient-${item.patientId}`}
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
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {displayName}</Text>
        </View>

        <RolePill role="ADVOCATE" />
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.pendingSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Pending Invites</Text>
          {loadingPendingInvites ? <ActivityIndicator size="small" /> : null}
        </View>

        {pendingInviteRows.length === 0 ? (
          <Text style={styles.emptyText}>No pending invites right now.</Text>
        ) : (
          pendingInviteRows.map((invite) => (
            <TouchableOpacity
              key={invite.id}
              style={styles.inviteCard}
              onPress={() => {
                setSelectedInvite(invite);
                setModalVisible(true);
              }}
              activeOpacity={0.85}
            >
              <View style={styles.inviteCardTop}>
                <Text style={styles.invitePatientName} numberOfLines={1}>
                  {invite.patientName}
                </Text>
                <View style={styles.pendingPill}>
                  <Text style={styles.pendingPillText}>Pending</Text>
                </View>
              </View>

              <Text style={styles.inviteMeta} numberOfLines={1}>
                Provider: {invite.providerName}
              </Text>
              <Text style={styles.inviteMeta} numberOfLines={1}>
                Sent: {new Date(invite.createdAt).toLocaleDateString()}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Patients</Text>

        {patients.length === 0 ? (
          <Text style={styles.emptyText}>
            You don’t have any patients assigned yet.
          </Text>
        ) : (
          <FlatList
            data={patients}
            keyExtractor={(item) => item.patientId}
            renderItem={renderPatientItem}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: theme.space.sm }}
          />
        )}
      </View>

      {loadingReads ? (
        <View style={styles.readsSpinner}>
          <ActivityIndicator size="small" />
        </View>
      ) : null}

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeInviteModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Care Team Invite</Text>

            <Text style={styles.modalText}>
              {selectedInvite?.patientName || "Unknown Patient"}
            </Text>

            <Text style={styles.modalSubtext}>
              Invited by {selectedInvite?.providerName || "Unknown Provider"}
            </Text>

            {inviteBusy ? (
              <ActivityIndicator style={styles.modalSpinner} />
            ) : (
              <>
                <TouchableOpacity
                  style={styles.acceptBtn}
                  onPress={handleAcceptInvite}
                  activeOpacity={0.85}
                >
                  <Text style={styles.acceptText}>Accept</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.declineBtn}
                  onPress={handleDeclineInvite}
                  activeOpacity={0.85}
                >
                  <Text style={styles.declineText}>Decline</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={closeInviteModal}
              disabled={inviteBusy}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default AdvocateHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    paddingHorizontal: theme.space.sm,
  },

  header: {
    marginBottom: theme.space.sm,
    marginTop: theme.space.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  greeting: {
    ...theme.type.h2,
  },

  errorBox: {
    backgroundColor: theme.colors.dangerBg,
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    marginBottom: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  errorText: {
    ...theme.type.subtext,
    color: theme.colors.dangerText,
  },

  pendingSection: {
    marginBottom: theme.space.md,
  },

  section: {
    flex: 1,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: theme.space.xs,
  },

  sectionTitle: {
    ...theme.type.h3,
    marginBottom: theme.space.xs,
  },

  emptyText: {
    ...theme.type.subtext,
  },

  loadingText: {
    ...theme.type.subtext,
    marginTop: theme.space.xs,
  },

  inviteCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: theme.space.xs,
    ...theme.shadow.card,
  },

  inviteCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },

  invitePatientName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: theme.colors.text,
  },

  inviteMeta: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.subtext,
  },

  pendingPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  pendingPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.infoText,
  },

  readsSpinner: {
    position: "absolute",
    right: theme.space.sm,
    bottom: theme.space.sm,
    backgroundColor: theme.colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },

  modalCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
    color: theme.colors.text,
  },

  modalText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text,
  },

  modalSubtext: {
    fontSize: 13,
    color: theme.colors.subtext,
    marginTop: 4,
    marginBottom: 16,
  },

  modalSpinner: {
    marginTop: 16,
    marginBottom: 8,
  },

  acceptBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },

  acceptText: {
    color: theme.colors.primaryText || "#FFFFFF",
    textAlign: "center",
    fontWeight: "700",
  },

  declineBtn: {
    backgroundColor: theme.colors.dangerBg,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },

  declineText: {
    color: theme.colors.dangerText,
    textAlign: "center",
    fontWeight: "700",
  },

  cancelBtn: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 6,
  },

  cancelText: {
    color: theme.colors.subtext,
    fontWeight: "600",
  },
});
