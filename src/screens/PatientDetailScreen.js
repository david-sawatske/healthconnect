import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import {
  ensureDirectConversation,
  ensureCareTeamConversation,
} from "../features/chat/conversationService";
import { theme } from "../ui/theme";

const client = generateClient();

const log = (...args) => console.log("[PATIENT_DETAIL]", ...args);

const LIST_ADVOCATE_USERS = /* GraphQL */ `
  query ListAdvocateUsers {
    listUsers(filter: { role: { eq: ADVOCATE } }) {
      items {
        id
        displayName
        email
        role
      }
    }
  }
`;

const LIST_ADVOCATE_ASSIGNMENTS_FOR_PATIENT = /* GraphQL */ `
  query ListAdvocateAssignmentsForPatient($patientId: ID!) {
    listAdvocateAssignments(filter: { patientId: { eq: $patientId } }) {
      items {
        id
        patientId
        providerId
        advocateId
        active
        createdAt
        updatedAt
      }
    }
  }
`;

const CREATE_ADVOCATE_ASSIGNMENT = /* GraphQL */ `
  mutation CreateAdvocateAssignment($input: CreateAdvocateAssignmentInput!) {
    createAdvocateAssignment(input: $input) {
      id
      patientId
      providerId
      advocateId
      active
      createdAt
      updatedAt
    }
  }
`;

const UPDATE_ADVOCATE_ASSIGNMENT = /* GraphQL */ `
  mutation UpdateAdvocateAssignment($input: UpdateAdvocateAssignmentInput!) {
    updateAdvocateAssignment(input: $input) {
      id
      patientId
      providerId
      advocateId
      active
      createdAt
      updatedAt
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

async function safeGql({ query, variables = {}, label }) {
  try {
    const res = await client.graphql({
      query,
      variables,
      authMode: "userPool",
    });
    log(label || "GQL", "OK", JSON.stringify(res?.data)?.slice(0, 240));
    return res;
  } catch (err) {
    log(label || "GQL", "ERR", err);
    throw err;
  }
}

const HeroActionButton = ({ variant, title, subtitle, onPress, disabled }) => {
  const base = [styles.heroBtn];
  if (variant === "primary") base.push(styles.heroBtnPrimary);
  if (variant === "secondary") base.push(styles.heroBtnSecondary);
  if (variant === "ghost") base.push(styles.heroBtnGhost);
  if (disabled) base.push(styles.heroBtnDisabled);

  const titleStyle = [styles.heroBtnTitle];
  const subStyle = [styles.heroBtnSub];
  if (variant === "primary") {
    titleStyle.push(styles.heroBtnTitleOnPrimary);
    subStyle.push(styles.heroBtnSubOnPrimary);
  }

  return (
    <TouchableOpacity style={base} onPress={onPress} disabled={disabled}>
      <Text style={titleStyle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={subStyle} numberOfLines={1}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
};

const PatientDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();

  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const {
    patientId,
    patientName,
    providerId: routeProviderId,
    fromRole,
  } = route.params || {};

  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [advocateAssignments, setAdvocateAssignments] = useState([]);
  const [advocateUsersById, setAdvocateUsersById] = useState({});

  const [advocates, setAdvocates] = useState([]);
  const [advocatesLoading, setAdvocatesLoading] = useState(false);
  const [advocatePickerVisible, setAdvocatePickerVisible] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const [providerUser, setProviderUser] = useState(null);

  const [manageExpanded, setManageExpanded] = useState(false);

  const viewerId = currentUser?.id ?? null;

  const isProviderView = !fromRole || fromRole === "PROVIDER";
  const isAdvocateView = fromRole === "ADVOCATE";

  const effectiveProviderId = useMemo(() => {
    if (routeProviderId) return routeProviderId;
    if (isProviderView) return viewerId;
    return null;
  }, [routeProviderId, isProviderView, viewerId]);

  useEffect(() => {
    if (!patientId) return;

    let mounted = true;
    (async () => {
      setLoadingAssignments(true);
      try {
        const res = await safeGql({
          query: LIST_ADVOCATE_ASSIGNMENTS_FOR_PATIENT,
          variables: { patientId },
          label: "ListAdvocateAssignmentsForPatient",
        });

        const items = res?.data?.listAdvocateAssignments?.items || [];
        if (!mounted) return;

        const sorted = [...items].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setAdvocateAssignments(sorted);

        const uniqueAdvocateIds = [
          ...new Set(sorted.map((a) => a.advocateId).filter(Boolean)),
        ];

        if (uniqueAdvocateIds.length === 0) {
          setAdvocateUsersById({});
        } else {
          const userResults = await Promise.all(
            uniqueAdvocateIds.map((id) =>
              safeGql({
                query: GET_USER,
                variables: { id },
                label: `GetAdvocateUser:${id}`,
              }).catch((err) => {
                log("GetAdvocateUser ERR", id, err);
                return null;
              }),
            ),
          );

          if (!mounted) return;

          const usersById = {};
          userResults.forEach((r) => {
            const u = r?.data?.getUser;
            if (u?.id) usersById[u.id] = u;
          });
          setAdvocateUsersById(usersById);
        }
      } catch (e) {
        if (!mounted) return;
        log("Load advocate assignments ERR", e);
      } finally {
        if (mounted) setLoadingAssignments(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [patientId]);

  useEffect(() => {
    let mounted = true;

    const loadProviderUser = async () => {
      if (!effectiveProviderId) {
        setProviderUser(null);
        return;
      }

      try {
        const res = await safeGql({
          query: GET_USER,
          variables: { id: effectiveProviderId },
          label: "GetProviderUserForPatient",
        });

        if (!mounted) return;
        setProviderUser(res?.data?.getUser || null);
      } catch (e) {
        log("GetProviderUserForPatient ERR", e);
      }
    };

    loadProviderUser();

    return () => {
      mounted = false;
    };
  }, [effectiveProviderId]);

  const providerScopedAssignments = useMemo(() => {
    if (!effectiveProviderId) return [];
    return (advocateAssignments || []).filter(
      (a) => a.providerId === effectiveProviderId,
    );
  }, [advocateAssignments, effectiveProviderId]);

  const activeAssignmentsForManagePanel = useMemo(() => {
    return (providerScopedAssignments || []).filter((a) => a.active);
  }, [providerScopedAssignments]);

  const activeAdvocatesForSummary = useMemo(() => {
    return (providerScopedAssignments || [])
      .filter((a) => a.active)
      .map((a) => advocateUsersById[a.advocateId])
      .filter(Boolean);
  }, [providerScopedAssignments, advocateUsersById]);

  const openDirectChat = useCallback(
    async (targetUser) => {
      if (!targetUser?.id || !viewerId) return;

      try {
        const conversation = await ensureDirectConversation({
          currentUserId: viewerId,
          memberIds: [viewerId, targetUser.id],
          title: `${currentUser?.displayName || "You"} ↔ ${
            targetUser.displayName || targetUser.email || "Chat"
          }`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || targetUser.displayName || "Conversation",
        });
      } catch (err) {
        log("openDirectChat ERR", err);
        Alert.alert("Unable to open chat", "Something went wrong.");
      }
    },
    [viewerId, currentUser?.displayName, navigation],
  );

  const openCareTeamChat = useCallback(async () => {
    if (!patientId) {
      Alert.alert("Error", "Missing patient info.");
      return;
    }
    if (!viewerId) {
      Alert.alert("Error", "Current user not loaded yet.");
      return;
    }
    if (!effectiveProviderId) {
      Alert.alert(
        "Missing provider context",
        "This patient can have multiple providers. Open this screen from a specific provider relationship so we can start the correct care team chat.",
      );
      return;
    }

    try {
      const activeForThisProvider = (providerScopedAssignments || []).filter(
        (a) => a.active,
      );

      const advocateIds = Array.from(
        new Set(activeForThisProvider.map((a) => a.advocateId).filter(Boolean)),
      );

      if (advocateIds.length > 0) {
        const conversation = await ensureCareTeamConversation({
          currentUserId: viewerId,
          patientId,
          providerId: effectiveProviderId,
          advocateIds,
          title: `Care Team: ${patientName || "Patient"}`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || "Care Team Chat",
        });
        return;
      }

      const direct = await ensureDirectConversation({
        currentUserId: viewerId,
        memberIds: [viewerId, patientId],
        title: `${currentUser?.displayName || "You"} ↔ ${
          patientName || "Patient"
        }`,
      });

      navigation.navigate("Chat", {
        conversationId: direct.id,
        conversation: direct,
        title: direct.title || "Conversation",
      });
    } catch (err) {
      log("openCareTeamChat ERR", err);
      Alert.alert("Error", "Unable to open conversation.");
    }
  }, [
    patientId,
    patientName,
    viewerId,
    effectiveProviderId,
    providerScopedAssignments,
    currentUser?.displayName,
    navigation,
  ]);

  const openAdvocatePicker = useCallback(async () => {
    if (!isProviderView) return;

    if (!viewerId) {
      Alert.alert("Error", "Provider not loaded yet.");
      return;
    }

    if (!effectiveProviderId) {
      Alert.alert(
        "Missing provider context",
        "Open this patient from a specific provider relationship to manage advocates.",
      );
      return;
    }

    setAdvocatePickerVisible(true);
    if (advocates.length > 0) return;

    setAdvocatesLoading(true);
    try {
      const res = await safeGql({
        query: LIST_ADVOCATE_USERS,
        variables: {},
        label: "ListAdvocateUsers",
      });
      const items = res?.data?.listUsers?.items || [];
      setAdvocates(items);
    } catch (e) {
      log("ListAdvocateUsers ERR", e);
      Alert.alert("Error", "Failed to load advocates.");
    } finally {
      setAdvocatesLoading(false);
    }
  }, [advocates.length, isProviderView, viewerId, effectiveProviderId]);

  const handleAssignAdvocate = useCallback(
    async (selectedAdvocate) => {
      if (!isProviderView) {
        Alert.alert("Error", "Only providers can assign advocates.");
        return;
      }
      if (!viewerId) {
        Alert.alert("Error", "Provider not loaded yet.");
        return;
      }
      if (!patientId) {
        Alert.alert("Error", "Missing patient info.");
        return;
      }
      if (!effectiveProviderId) {
        Alert.alert(
          "Missing provider context",
          "Open this patient from a specific provider relationship to manage advocates.",
        );
        return;
      }

      const matchingAssignments = advocateAssignments.filter(
        (a) =>
          a.patientId === patientId &&
          a.providerId === effectiveProviderId &&
          a.advocateId === selectedAdvocate.id,
      );

      const existingActive = matchingAssignments.find((a) => a.active);
      const existingInactive = matchingAssignments.find((a) => !a.active);

      if (existingActive) {
        Alert.alert("Already Assigned", "This advocate is already assigned.");
        return;
      }

      setAssigning(true);
      try {
        let updatedOrNew;

        if (existingInactive) {
          const res = await safeGql({
            query: UPDATE_ADVOCATE_ASSIGNMENT,
            variables: {
              input: {
                id: existingInactive.id,
                active: true,
              },
            },
            label: "UpdateAdvocateAssignment-reactivate",
          });

          updatedOrNew = res?.data?.updateAdvocateAssignment;
        } else {
          const res = await safeGql({
            query: CREATE_ADVOCATE_ASSIGNMENT,
            variables: {
              input: {
                patientId,
                providerId: effectiveProviderId,
                advocateId: selectedAdvocate.id,
                active: true,
              },
            },
            label: "CreateAdvocateAssignment",
          });

          updatedOrNew = res?.data?.createAdvocateAssignment;
        }

        if (!updatedOrNew) {
          console.log("[ASSIGN_ADVOCATE] No assignment returned");
          return;
        }

        setAdvocateAssignments((prev) => {
          const existsIndex = prev.findIndex((a) => a.id === updatedOrNew.id);
          let next;

          if (existsIndex >= 0) {
            next = [...prev];
            next[existsIndex] = { ...prev[existsIndex], ...updatedOrNew };
          } else {
            next = [updatedOrNew, ...prev];
          }

          return next.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
        });

        setAdvocateUsersById((prev) => ({
          ...prev,
          [selectedAdvocate.id]: selectedAdvocate,
        }));

        setAdvocatePickerVisible(false);
        setManageExpanded(true);
      } catch (e) {
        log("Assign advocate ERR", e);
        Alert.alert("Error", "Failed to assign advocate.");
      } finally {
        setAssigning(false);
      }
    },
    [
      patientId,
      viewerId,
      advocateAssignments,
      isProviderView,
      effectiveProviderId,
    ],
  );

  const handleRemoveAssignment = useCallback(
    (assignment) => {
      if (!isProviderView) return;

      const user = advocateUsersById[assignment.advocateId];
      const name = user?.displayName || user?.email || "this advocate";

      Alert.alert(
        "Remove advocate?",
        `Are you sure you want to remove ${name} from this patient?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              try {
                const res = await safeGql({
                  query: UPDATE_ADVOCATE_ASSIGNMENT,
                  variables: {
                    input: {
                      id: assignment.id,
                      active: false,
                    },
                  },
                  label: "UpdateAdvocateAssignment-remove",
                });

                const updated = res?.data?.updateAdvocateAssignment;
                if (!updated) return;

                setAdvocateAssignments((prev) =>
                  prev.map((a) =>
                    a.id === assignment.id ? { ...a, ...updated } : a,
                  ),
                );
              } catch (e) {
                log("Update advocate assignment (remove) ERR", e);
                Alert.alert("Error", "Failed to remove advocate.");
              }
            },
          },
        ],
      );
    },
    [advocateUsersById, isProviderView],
  );

  const providerDisplayName =
    providerUser?.displayName || providerUser?.email || "Provider";
  const patientDisplayName = patientName || "Patient";

  const canOpenGroupChat =
    !!effectiveProviderId && activeAdvocatesForSummary.length > 0;

  const handleToggleManage = () => {
    if (!isProviderView) return;
    setManageExpanded((prev) => !prev);
  };

  const renderManageAdvocatesPanel = () => {
    if (!isProviderView) return null;
    if (!manageExpanded) return null;

    if (!effectiveProviderId) {
      return (
        <View style={styles.managePanel}>
          <Text style={styles.manageTitle}>Advocates</Text>
          <Text style={styles.manageHint}>
            This patient can have multiple providers. Open this screen from a
            specific provider relationship to manage advocates for that
            provider.
          </Text>
        </View>
      );
    }

    if (loadingAssignments) {
      return (
        <View style={styles.managePanel}>
          <View style={styles.manageHeaderRow}>
            <Text style={styles.manageTitle}>Advocates</Text>
            <View style={styles.heroLoadingPill}>
              <ActivityIndicator size="small" />
              <Text style={styles.heroLoadingText}>Loading</Text>
            </View>
          </View>
        </View>
      );
    }

    const hasActive = activeAssignmentsForManagePanel.length > 0;

    return (
      <View style={styles.managePanel}>
        <View style={styles.manageHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.manageTitle}>Advocates</Text>
            <Text style={styles.manageHint} numberOfLines={2}>
              Active advocates for {providerDisplayName}. Message them directly
              or assign new support.
            </Text>
          </View>
        </View>

        {hasActive ? (
          <>
            {activeAssignmentsForManagePanel.map((assignment) => {
              const user = advocateUsersById[assignment.advocateId] || {};
              const name = user.displayName || user.email || "Advocate";

              return (
                <View key={assignment.id} style={styles.manageRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.manageRowTop}>
                      <Text style={styles.manageName} numberOfLines={1}>
                        {name}
                      </Text>
                    </View>
                    <Text style={styles.manageSub} numberOfLines={1}>
                      Active advocate
                    </Text>
                  </View>

                  <View style={styles.manageActions}>
                    <TouchableOpacity
                      style={styles.manageMsgBtn}
                      onPress={() => openDirectChat(user)}
                      disabled={!user?.id || !viewerId || loadingCurrentUser}
                    >
                      <Text style={styles.manageMsgBtnText}>Message</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.manageRemoveBtn}
                      onPress={() => handleRemoveAssignment(assignment)}
                    >
                      <Text style={styles.manageRemoveBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}

            <TouchableOpacity
              style={[
                styles.manageAssignBtnBelow,
                assigning && styles.heroBtnDisabled,
              ]}
              onPress={openAdvocatePicker}
              disabled={assigning}
            >
              <Text style={styles.manageAssignBtnBelowText}>
                {assigning ? "Saving..." : "Assign New Advocate"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.manageEmptyBox}>
            <Text style={styles.manageEmptyTitle}>No advocates assigned</Text>
            <Text style={styles.manageEmptyBody}>
              Assign an advocate to enable group care team chat and add support
              for this patient.
            </Text>
            <TouchableOpacity
              style={styles.managePrimaryCta}
              onPress={openAdvocatePicker}
              disabled={assigning}
            >
              <Text style={styles.managePrimaryCtaText}>
                {assigning ? "Saving..." : "Assign Advocate"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom || 0 },
      ]}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>

        <View style={styles.topBarTitleWrap}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {patientDisplayName}
          </Text>
        </View>

        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Text style={styles.heroTitle}>Care Team</Text>

            {loadingAssignments ? (
              <View style={styles.heroLoadingPill}>
                <ActivityIndicator size="small" />
                <Text style={styles.heroLoadingText}>Loading</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.heroActionsGrid}>
            <HeroActionButton
              variant="primary"
              title={
                canOpenGroupChat ? "Open Care Team Chat" : "Open Patient Chat"
              }
              subtitle={
                canOpenGroupChat
                  ? "Patient • Provider • Advocates"
                  : "Direct message"
              }
              onPress={openCareTeamChat}
              disabled={!viewerId || loadingCurrentUser}
            />

            <HeroActionButton
              variant="secondary"
              title={
                patientName && patientName.trim()
                  ? `Message ${patientName.trim()}`
                  : "Message Patient"
              }
              subtitle="Direct chat"
              onPress={() =>
                openDirectChat({
                  id: patientId,
                  displayName: patientDisplayName,
                  email: null,
                })
              }
              disabled={!viewerId || !patientId || loadingCurrentUser}
            />

            {isAdvocateView && effectiveProviderId ? (
              <HeroActionButton
                variant="secondary"
                title={
                  providerDisplayName && providerDisplayName !== "Provider"
                    ? `Message ${providerDisplayName}`
                    : "Message Provider"
                }
                subtitle="Direct chat"
                onPress={() =>
                  openDirectChat({
                    id: effectiveProviderId,
                    displayName: providerDisplayName,
                    email: providerUser?.email,
                  })
                }
                disabled={!viewerId || loadingCurrentUser}
              />
            ) : null}

            {isProviderView ? (
              <HeroActionButton
                variant="ghost"
                title={
                  manageExpanded ? "Hide Manage Advocates" : "Manage Advocates"
                }
                subtitle="View advocates + message + assign"
                onPress={handleToggleManage}
                disabled={!viewerId || loadingCurrentUser}
              />
            ) : null}
          </View>

          {renderManageAdvocatesPanel()}
        </View>
      </View>

      {isProviderView && (
        <AdvocatePickerModal
          visible={advocatePickerVisible}
          onClose={() => setAdvocatePickerVisible(false)}
          advocates={advocates}
          loading={advocatesLoading}
          onSelect={handleAssignAdvocate}
          existingAssignments={providerScopedAssignments}
        />
      )}
    </View>
  );
};

const AdvocatePickerModal = ({
  visible,
  onClose,
  advocates,
  loading,
  onSelect,
  existingAssignments = [],
}) => {
  const [selectedAdvocateId, setSelectedAdvocateId] = useState(null);

  useEffect(() => {
    if (!visible) setSelectedAdvocateId(null);
  }, [visible]);

  const assignedMap = {};
  existingAssignments.forEach((a) => {
    if (a.active) assignedMap[a.advocateId] = "Active";
  });

  const handleConfirm = () => {
    if (!selectedAdvocateId) {
      Alert.alert("Select an advocate", "Please choose an advocate first.");
      return;
    }

    if (assignedMap[selectedAdvocateId]) {
      Alert.alert("Already Assigned", "This advocate is already assigned.");
      return;
    }

    const advocate = advocates.find((a) => a.id === selectedAdvocateId);
    onSelect(advocate);
  };

  const renderItem = ({ item }) => {
    const isAssigned = assignedMap[item.id] != null;
    const status = assignedMap[item.id];
    const isSelected = item.id === selectedAdvocateId;

    return (
      <TouchableOpacity
        disabled={isAssigned}
        style={[
          styles.advocateRow,
          isSelected && !isAssigned && styles.advocateRowSelected,
          isAssigned && styles.advocateRowDisabled,
        ]}
        onPress={() => {
          if (!isAssigned) setSelectedAdvocateId(item.id);
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.advocateName} numberOfLines={1}>
            {item.displayName || item.email || "Unnamed Advocate"}
          </Text>
          {isAssigned && (
            <Text style={styles.advocateStatusText}>{status}</Text>
          )}
        </View>

        {!isAssigned && isSelected && (
          <Text style={styles.advocateSelectedMark}>✓</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Assign Advocate</Text>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 16 }} />
          ) : advocates.length === 0 ? (
            <Text style={styles.cardText}>No advocates available.</Text>
          ) : (
            <FlatList
              data={advocates}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={{ maxHeight: 320, width: "100%" }}
              keyboardShouldPersistTaps="handled"
            />
          )}

          <View style={styles.modalButtons}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleConfirm}
            >
              <Text style={styles.primaryButtonText}>Assign</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.xs,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 36,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },
  backText: { fontSize: 18, fontWeight: "800", color: theme.colors.text },

  topBarTitleWrap: { flex: 1 },
  topBarTitle: { ...theme.type.h2, fontSize: 18 },

  content: { flex: 1, paddingHorizontal: theme.space.sm, paddingTop: 6 },

  heroCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    marginBottom: theme.space.sm,
    ...theme.shadow.card,
  },
  heroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  heroTitle: { ...theme.type.h3, fontSize: 16, fontWeight: "800" },

  heroLoadingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.disabledBg,
  },
  heroLoadingText: {
    fontSize: 12,
    color: theme.colors.muted,
    fontWeight: "700",
  },

  heroActionsGrid: { marginTop: theme.space.sm, gap: 10 },

  heroBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroBtnPrimary: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  heroBtnSecondary: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
  },
  heroBtnGhost: {
    backgroundColor: theme.colors.bg,
    borderColor: theme.colors.border,
  },
  heroBtnDisabled: { opacity: 0.6 },

  heroBtnTitle: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  heroBtnSub: { marginTop: 3, fontSize: 12, color: theme.colors.subtext },
  heroBtnTitleOnPrimary: { color: theme.colors.primaryText },
  heroBtnSubOnPrimary: { color: theme.colors.infoBg },

  managePanel: {
    marginTop: theme.space.sm,
    paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  manageHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  manageTitle: { ...theme.type.h3, fontSize: 14, fontWeight: "800" },
  manageHint: { marginTop: 4, fontSize: 12, color: theme.colors.subtext },

  manageRow: {
    marginTop: 10,
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  manageRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  manageName: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.text,
    flex: 1,
    paddingRight: 6,
  },
  manageSub: { marginTop: 4, fontSize: 12, color: theme.colors.subtext },

  manageActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  manageMsgBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  manageMsgBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.infoText,
  },

  manageRemoveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.dangerBg,
    backgroundColor: theme.colors.dangerBg,
  },
  manageRemoveBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.dangerText,
  },

  manageEmptyBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  manageEmptyTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.colors.text,
  },
  manageEmptyBody: { marginTop: 4, fontSize: 12, color: theme.colors.subtext },
  managePrimaryCta: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  managePrimaryCtaText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.primaryText,
  },

  manageAssignBtnBelow: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
  },
  manageAssignBtnBelowText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.primaryText,
  },

  cardText: { ...theme.type.body, marginBottom: 4 },

  primaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  primaryButtonText: { color: theme.colors.primaryText, fontWeight: "700" },

  secondaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
  },
  secondaryButtonText: { fontWeight: "700", color: theme.colors.text },

  modalOverlay: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalContent: {
    width: "100%",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.floating,
  },
  modalTitle: { ...theme.type.h3, marginBottom: 8 },

  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    gap: 10,
  },

  advocateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  advocateRowSelected: {
    backgroundColor: theme.colors.providerBg,
    borderColor: theme.colors.border,
  },
  advocateRowDisabled: { opacity: 0.45 },
  advocateName: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: "700",
  },
  advocateStatusText: {
    fontSize: 12,
    color: theme.colors.subtext,
    marginTop: 2,
  },
  advocateSelectedMark: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.colors.primary,
  },
});

export default PatientDetailScreen;
