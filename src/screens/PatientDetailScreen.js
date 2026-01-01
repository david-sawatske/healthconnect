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
} from "../utils/conversations";

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

const PatientDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();

  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const {
    patientId,
    patientName,
    providerId: routeProviderId,
    advocateId: routeAdvocateId,
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
  }, [advocates.length, isProviderView, viewerId]);

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

      const matchingAssignments = advocateAssignments.filter(
        (a) =>
          a.patientId === patientId &&
          a.providerId === viewerId &&
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
                providerId: viewerId,
                advocateId: selectedAdvocate.id,
                active: true,
              },
            },
            label: "CreateAdvocateAssignment",
          });

          updatedOrNew = res?.data?.createAdvocateAssignment;
        }

        if (!updatedOrNew) throw new Error("No assignment returned");

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
      } catch (e) {
        log("Assign advocate ERR", e);
        Alert.alert("Error", "Failed to assign advocate.");
      } finally {
        setAssigning(false);
      }
    },
    [patientId, viewerId, advocateAssignments, isProviderView],
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
                    a.id === assignment.id ? { ...a, active: false } : a,
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

  const renderAdvocateRow = (assignment) => {
    const user = advocateUsersById[assignment.advocateId] || {};
    const statusLabel = assignment.active ? "Active" : "Inactive";

    return (
      <View key={assignment.id} style={styles.advocateListRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.advocateListName}>
            {user.displayName || user.email || "Assigned advocate"}
          </Text>
          <Text style={styles.advocateStatusText}>{statusLabel}</Text>
        </View>

        {isProviderView ? (
          <View style={styles.inlineActions}>
            <TouchableOpacity
              style={styles.smallButton}
              onPress={() => openDirectChat(user)}
              disabled={!user?.id}
            >
              <Text style={styles.smallButtonText}>Message</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.removeChip}
              onPress={() => handleRemoveAssignment(assignment)}
            >
              <Text style={styles.removeChipText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const renderAdvocateSection = () => {
    if (!isProviderView) return null;

    if (loadingAssignments) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Advocate support</Text>
          <ActivityIndicator />
        </View>
      );
    }

    const activeAssignments = providerScopedAssignments.filter((a) => a.active);
    const hasAnyAssignments = activeAssignments.length > 0;

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Advocate support</Text>

        {hasAnyAssignments ? (
          <>
            <Text style={styles.sectionLabel}>Active advocates</Text>
            {activeAssignments.map(renderAdvocateRow)}

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={openAdvocatePicker}
              disabled={assigning}
            >
              <Text style={styles.secondaryButtonText}>
                {assigning ? "Saving..." : "Add / Update Advocates"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.cardText}>No advocates assigned.</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={openAdvocatePicker}
              disabled={assigning}
            >
              <Text style={styles.primaryButtonText}>
                {assigning ? "Assigning..." : "Assign Advocate"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };


  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {patientName || "Patient Detail"}
        </Text>
      </View>

      <View style={styles.content}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Care Team</Text>
          {loadingAssignments ? (
            <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
          ) : null}
        </View>

        <View style={styles.careCard}>
          <View style={styles.careCardHeader}>
            <Text style={styles.careName}>{patientDisplayName}</Text>
            <Text style={[styles.careRoleBadge, styles.patientBadge]}>
              Patient
            </Text>
          </View>
          <Text style={styles.careSubtitle}>
            This is the patient this care team supports.
          </Text>

          <TouchableOpacity
            style={styles.careButton}
            onPress={() =>
              openDirectChat({
                id: patientId,
                displayName: patientDisplayName,
                email: null,
              })
            }
            disabled={!viewerId || !patientId || loadingCurrentUser}
          >
            <Text style={styles.careButtonText}>Message Patient</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.careCard}>
          <View style={styles.careCardHeader}>
            <Text style={styles.careName}>
              {effectiveProviderId ? providerDisplayName : "Provider"}
            </Text>
            <Text style={[styles.careRoleBadge, styles.providerBadge]}>
              Provider
            </Text>
          </View>

          {!effectiveProviderId ? (
            <Text style={styles.careSubtitle}>
              This patient can have multiple providers. Open this screen from a
              specific provider relationship to see the correct care team.
            </Text>
          ) : (
            <Text style={styles.careSubtitle}>
              The provider relationship this view is scoped to.
            </Text>
          )}

          {isAdvocateView && effectiveProviderId ? (
            <TouchableOpacity
              style={styles.careButton}
              onPress={() =>
                openDirectChat({
                  id: effectiveProviderId,
                  displayName: providerDisplayName,
                  email: providerUser?.email,
                })
              }
              disabled={!viewerId || loadingCurrentUser}
            >
              <Text style={styles.careButtonText}>Message Provider</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.teamButtonsRow}>
            <TouchableOpacity
              style={styles.primaryActionButton}
              onPress={openCareTeamChat}
              disabled={!viewerId || loadingCurrentUser}
            >
              <Text style={styles.primaryActionButtonText}>
                {canOpenGroupChat ? "Open Care Team Chat" : "Open Patient Chat"}
              </Text>
            </TouchableOpacity>

            {canOpenGroupChat ? (
              <Text style={styles.teamHintText}>
                Includes patient + provider + active advocates
              </Text>
            ) : (
              <Text style={styles.teamHintText}>
                Add an advocate to enable a care team group chat.
              </Text>
            )}
          </View>
        </View>

        <View style={styles.careSubsection}>
          <Text style={styles.careSubsectionTitle}>
            Advocates{" "}
            {effectiveProviderId ? `(for ${providerDisplayName})` : ""}
          </Text>

          {effectiveProviderId ? (
            activeAdvocatesForSummary.length > 0 ? (
              activeAdvocatesForSummary.map((adv) => (
                <View key={adv.id} style={styles.careCard}>
                  <View style={styles.careCardHeader}>
                    <Text style={styles.careName}>
                      {adv.displayName || adv.email || "Advocate"}
                    </Text>
                    <Text style={[styles.careRoleBadge, styles.advocateBadge]}>
                      Advocate
                    </Text>
                  </View>

                  <Text style={styles.careSubtitle}>
                    Supports communication and coordination.
                  </Text>

                  {isProviderView ? (
                    <TouchableOpacity
                      style={styles.careButton}
                      onPress={() => openDirectChat(adv)}
                    >
                      <Text style={styles.careButtonText}>
                        Message Advocate
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            ) : (
              <View style={styles.emptyCareTeam}>
                <Text style={styles.emptyCareTitle}>No advocates assigned</Text>
                <Text style={styles.emptyCareBody}>
                  Providers can assign advocates to enable group care team chat.
                </Text>
              </View>
            )
          ) : (
            <View style={styles.emptyCareTeam}>
              <Text style={styles.emptyCareTitle}>No provider selected</Text>
              <Text style={styles.emptyCareBody}>
                Open this patient from a specific provider relationship to view
                advocates for that provider.
              </Text>
            </View>
          )}
        </View>

        {renderAdvocateSection()}
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
          <Text style={styles.advocateName}>
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
              style={{ maxHeight: 260, width: "100%" }}
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
  container: {
    flex: 1,
    backgroundColor: "#F4F5F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backText: {
    fontSize: 16,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
    color: "#111827",
  },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    marginBottom: 4,
  },

  careCard: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
  },
  careCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  careName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
    paddingRight: 10,
  },
  careRoleBadge: {
    fontSize: 11,
    fontWeight: "600",
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
  advocateBadge: {
    backgroundColor: "#ECFDF5",
    color: "#15803D",
  },
  careSubtitle: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 8,
  },
  careButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  careButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  careSubsection: {
    marginTop: 6,
    marginBottom: 6,
  },
  careSubsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
  },

  emptyCareTeam: {
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
  },
  emptyCareTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1D4ED8",
    marginBottom: 2,
  },
  emptyCareBody: {
    fontSize: 13,
    color: "#4B5563",
  },

  teamButtonsRow: {
    gap: 10,
    marginTop: 8,
  },
  primaryActionButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#1D4ED8",
    alignItems: "center",
  },
  primaryActionButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  teamHintText: {
    marginTop: 6,
    fontSize: 12,
    color: "#475569",
  },

  primaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  secondaryButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  secondaryButtonText: {
    fontWeight: "500",
  },

  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 2,
    color: "#475569",
  },

  advocateListRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    gap: 10,
  },
  advocateListName: {
    fontSize: 14,
  },
  advocateStatusText: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },

  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  removeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#F97373",
    backgroundColor: "#FEF2F2",
  },
  removeChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#B91C1C",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalContent: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
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
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  advocateRowSelected: {
    backgroundColor: "#DBEAFE",
  },
  advocateRowDisabled: {
    opacity: 0.4,
  },
  advocateName: {
    flex: 1,
    fontSize: 14,
  },
  advocateSelectedMark: {
    fontSize: 16,
    fontWeight: "700",
  },
});

export default PatientDetailScreen;
