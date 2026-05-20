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
  ScrollView,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import {
  ensureDirectConversation,
  ensureCareTeamConversation,
} from "../features/chat/conversationService";
import { CreateAdvocateInviteGuarded } from "../graphql/advocateInvites";
import {
  getUserById,
  getUserDisplayName,
  getUsersByIds,
} from "../services/userService";
import { theme } from "../ui/theme";

const client = generateClient();

const devLog = (...args) => {
  if (__DEV__) console.log("[PATIENT_DETAIL]", ...args);
};

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

const LIST_ADVOCATE_INVITES_FOR_PATIENT = /* GraphQL */ `
  query ListAdvocateInvitesForPatient($patientId: String!) {
    listAdvocateInvites(filter: { patientId: { eq: $patientId } }) {
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

async function safeGql({ query, variables = {}, label }) {
  try {
    const res = await client.graphql({
      query,
      variables,
      authMode: "userPool",
    });

    devLog(label || "GQL", "OK", JSON.stringify(res?.data)?.slice(0, 240));
    return res;
  } catch (err) {
    devLog(label || "GQL", "ERR", err);
    throw err;
  }
}

function getGraphQlErrorMessage(error) {
  const first =
    error?.errors?.[0]?.message ||
    error?.data?.errors?.[0]?.message ||
    error?.message ||
    "Unknown error";

  return String(first);
}

function getInviteErrorAlert(message) {
  if (
    message.includes("Advocate is already in the care team conversation.") ||
    message.includes("ADVOCATE_ALREADY_IN_CONVERSATION")
  ) {
    return {
      title: "Already Added",
      body: "This advocate is already part of the care team conversation.",
    };
  }

  if (
    message.includes("Active advocate assignment already exists.") ||
    message.includes("ACTIVE_ASSIGNMENT_EXISTS")
  ) {
    return {
      title: "Already Assigned",
      body: "This advocate is already assigned to this patient.",
    };
  }

  if (
    message.includes("A pending invite already exists.") ||
    message.includes("PENDING_INVITE_EXISTS")
  ) {
    return {
      title: "Invite Already Sent",
      body: "This advocate already has a pending invite.",
    };
  }

  if (
    message.includes("CARE_TEAM_CONVERSATION_NOT_FOUND") ||
    (message.includes("Conversation") && message.includes("not found"))
  ) {
    return {
      title: "Care team unavailable",
      body: "The care team conversation could not be found. Please try again.",
    };
  }

  return {
    title: "Unable to send invite",
    body: "The advocate invite could not be sent. Please try again.",
  };
}

function uniq(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

const HeroActionButton = ({ variant, title, subtitle, onPress, disabled }) => {
  const buttonStyles = [styles.heroBtn];

  if (variant === "primary") buttonStyles.push(styles.heroBtnPrimary);
  if (variant === "secondary") buttonStyles.push(styles.heroBtnSecondary);
  if (variant === "ghost") buttonStyles.push(styles.heroBtnGhost);
  if (disabled) buttonStyles.push(styles.heroBtnDisabled);

  const titleStyle = [styles.heroBtnTitle];
  const subStyle = [styles.heroBtnSub];

  if (variant === "primary") {
    titleStyle.push(styles.heroBtnTitleOnPrimary);
    subStyle.push(styles.heroBtnSubOnPrimary);
  }

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={titleStyle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={subStyle} numberOfLines={1}>
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
};

const SectionCard = ({ children, style }) => {
  return <View style={[styles.sectionCard, style]}>{children}</View>;
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
    providerName: routeProviderName,
    providers: routeProviders = [],
    fromRole,
  } = route.params || {};

  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [advocateAssignments, setAdvocateAssignments] = useState([]);
  const [advocateInvites, setAdvocateInvites] = useState([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [advocateUsersById, setAdvocateUsersById] = useState({});
  const [providerUsersById, setProviderUsersById] = useState({});

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

  const patientDisplayName = patientName || "Patient";

  const normalizedRouteProviders = useMemo(() => {
    const fromProviders = Array.isArray(routeProviders) ? routeProviders : [];

    const base = fromProviders
      .map((provider) => ({
        providerId: provider.providerId,
        providerName:
          provider.providerName ||
          provider.displayName ||
          provider.email ||
          "Provider",
        email: provider.email || null,
        assignmentId: provider.assignmentId || null,
        createdAt: provider.createdAt || null,
      }))
      .filter((provider) => provider.providerId);

    if (base.length > 0) {
      return base;
    }

    if (routeProviderId) {
      return [
        {
          providerId: routeProviderId,
          providerName: routeProviderName || "Provider",
          email: null,
          assignmentId: null,
          createdAt: null,
        },
      ];
    }

    return [];
  }, [routeProviders, routeProviderId, routeProviderName]);

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
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );

        setAdvocateAssignments(sorted);

        const uniqueAdvocateIds = uniq(sorted.map((a) => a.advocateId));
        const uniqueProviderIds = uniq(sorted.map((a) => a.providerId));

        if (uniqueAdvocateIds.length > 0) {
          const userMap = await getUsersByIds(uniqueAdvocateIds);
          if (!mounted) return;

          setAdvocateUsersById((prev) => ({
            ...prev,
            ...userMap,
          }));
        }

        if (uniqueProviderIds.length > 0) {
          const userMap = await getUsersByIds(uniqueProviderIds);
          if (!mounted) return;

          setProviderUsersById((prev) => ({
            ...prev,
            ...userMap,
          }));
        }
      } catch (error) {
        if (!mounted) return;
        devLog("Load advocate assignments ERR", error);
      } finally {
        if (mounted) setLoadingAssignments(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [patientId]);

  useEffect(() => {
    if (!patientId) return;

    let mounted = true;

    (async () => {
      setLoadingInvites(true);

      try {
        const res = await safeGql({
          query: LIST_ADVOCATE_INVITES_FOR_PATIENT,
          variables: { patientId },
          label: "ListAdvocateInvitesForPatient",
        });

        const items = res?.data?.listAdvocateInvites?.items || [];
        if (!mounted) return;

        const sorted = [...items].sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );

        setAdvocateInvites(sorted);

        const uniqueAdvocateIds = uniq(sorted.map((i) => i.advocateId));
        const missingIds = uniqueAdvocateIds.filter(
          (id) => !advocateUsersById[id],
        );

        if (missingIds.length > 0) {
          const userMap = await getUsersByIds(missingIds);
          if (!mounted) return;

          setAdvocateUsersById((prev) => ({
            ...prev,
            ...userMap,
          }));
        }
      } catch (error) {
        if (!mounted) return;
        devLog("Load advocate invites ERR", error);
      } finally {
        if (mounted) setLoadingInvites(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [patientId, advocateUsersById]);

  useEffect(() => {
    let mounted = true;

    const loadProviderUser = async () => {
      if (!effectiveProviderId) {
        setProviderUser(null);
        return;
      }

      try {
        const user = await getUserById(effectiveProviderId);

        if (!mounted) return;
        setProviderUser(user || null);
      } catch (error) {
        devLog("GetProviderUserForPatient ERR", error);
      }
    };

    loadProviderUser();

    return () => {
      mounted = false;
    };
  }, [effectiveProviderId]);

  const advocateProviders = useMemo(() => {
    if (!isAdvocateView) return [];

    const fromAssignments = (advocateAssignments || [])
      .filter((a) => a.active !== false)
      .filter((a) => !viewerId || a.advocateId === viewerId)
      .map((assignment) => {
        const providerUser = providerUsersById[assignment.providerId];
        const routeProvider = normalizedRouteProviders.find(
          (p) => p.providerId === assignment.providerId,
        );

        return {
          providerId: assignment.providerId,
          providerName:
            getUserDisplayName(providerUser, null) ||
            routeProvider?.providerName ||
            "Provider",
          email: providerUser?.email || routeProvider?.email || null,
          assignmentId: assignment.id,
          createdAt: assignment.createdAt,
        };
      })
      .filter((provider) => provider.providerId);

    const merged = [...normalizedRouteProviders, ...fromAssignments];
    const byId = {};

    merged.forEach((provider) => {
      if (!provider.providerId) return;

      const existing = byId[provider.providerId];

      byId[provider.providerId] = {
        ...existing,
        ...provider,
        providerName:
          provider.providerName ||
          existing?.providerName ||
          provider.email ||
          "Provider",
      };
    });

    return Object.values(byId).sort((a, b) =>
      (a.providerName || "").localeCompare(b.providerName || ""),
    );
  }, [
    isAdvocateView,
    advocateAssignments,
    viewerId,
    providerUsersById,
    normalizedRouteProviders,
  ]);

  const providerScopedAssignments = useMemo(() => {
    if (!effectiveProviderId) return [];
    return (advocateAssignments || []).filter(
      (a) => a.providerId === effectiveProviderId,
    );
  }, [advocateAssignments, effectiveProviderId]);

  const providerScopedPendingInvites = useMemo(() => {
    if (!effectiveProviderId) return [];

    return (advocateInvites || []).filter(
      (invite) =>
        invite.status === "PENDING" &&
        (invite.providerId === effectiveProviderId ||
          invite.createdBy === effectiveProviderId),
    );
  }, [advocateInvites, effectiveProviderId]);

  const activeAssignmentsForManagePanel = useMemo(() => {
    return (providerScopedAssignments || []).filter((a) => a.active);
  }, [providerScopedAssignments]);

  const pendingInvitesForManagePanel = useMemo(() => {
    return providerScopedPendingInvites;
  }, [providerScopedPendingInvites]);

  const activeAdvocatesForSummary = useMemo(() => {
    return (providerScopedAssignments || [])
      .filter((a) => a.active)
      .map((a) => advocateUsersById[a.advocateId])
      .filter(Boolean);
  }, [providerScopedAssignments, advocateUsersById]);

  const providerDisplayName =
    getUserDisplayName(providerUser, null) || routeProviderName || "Provider";

  const openDirectChat = useCallback(
    async (targetUser) => {
      if (!targetUser?.id || !viewerId) return;

      const targetDisplayName = getUserDisplayName(targetUser, "Chat");

      try {
        const conversation = await ensureDirectConversation({
          currentUserId: viewerId,
          memberIds: [viewerId, targetUser.id],
          title: `${getUserDisplayName(currentUser, "You")} ↔ ${targetDisplayName}`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || targetDisplayName || "Conversation",
        });
      } catch (error) {
        devLog("openDirectChat ERR", error);
        Alert.alert(
          "Unable to open chat",
          "The conversation could not be opened. Please try again.",
        );
      }
    },
    [viewerId, currentUser, navigation],
  );

  const openCareTeamChatForProvider = useCallback(
    async (provider) => {
      const providerId = provider?.providerId;

      if (!patientId) {
        Alert.alert("Missing patient", "Patient information is not available.");
        return;
      }

      if (!viewerId) {
        Alert.alert("User not ready", "Your account is still loading.");
        return;
      }

      if (!providerId) {
        Alert.alert(
          "Missing provider context",
          "Choose a provider so the correct care team chat can be used.",
        );
        return;
      }

      try {
        const activeForThisProvider = (advocateAssignments || []).filter(
          (a) =>
            a.active !== false &&
            a.patientId === patientId &&
            a.providerId === providerId,
        );

        const advocateIds = uniq(
          activeForThisProvider.map((a) => a.advocateId),
        );

        const providerName = provider?.providerName || "Provider";

        const conversation = await ensureCareTeamConversation({
          currentUserId: viewerId,
          patientId,
          providerId,
          advocateIds,
          title: `Care Team: ${providerName}`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || `Care Team: ${providerName}`,
        });
      } catch (error) {
        devLog("openCareTeamChatForProvider ERR", error);
        Alert.alert(
          "Unable to open care team chat",
          "The care team conversation could not be opened. Please try again.",
        );
      }
    },
    [patientId, viewerId, advocateAssignments, navigation],
  );

  const openCareTeamChat = useCallback(async () => {
    if (!patientId) {
      Alert.alert("Missing patient", "Patient information is not available.");
      return;
    }

    if (!viewerId) {
      Alert.alert("User not ready", "Your account is still loading.");
      return;
    }

    if (!effectiveProviderId) {
      Alert.alert(
        "Missing provider context",
        "Open this patient from a specific provider relationship so the correct care team chat can be used.",
      );
      return;
    }

    try {
      const activeForThisProvider = (providerScopedAssignments || []).filter(
        (a) => a.active,
      );

      const advocateIds = uniq(activeForThisProvider.map((a) => a.advocateId));

      if (advocateIds.length > 0) {
        const conversation = await ensureCareTeamConversation({
          currentUserId: viewerId,
          patientId,
          providerId: effectiveProviderId,
          advocateIds,
          title: `Care Team: ${providerDisplayName}`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || `Care Team: ${providerDisplayName}`,
        });
        return;
      }

      const direct = await ensureDirectConversation({
        currentUserId: viewerId,
        memberIds: [viewerId, patientId],
        title: `${getUserDisplayName(currentUser, "You")} ↔ ${
          patientName || "Patient"
        }`,
      });

      navigation.navigate("Chat", {
        conversationId: direct.id,
        conversation: direct,
        title: direct.title || "Conversation",
      });
    } catch (error) {
      devLog("openCareTeamChat ERR", error);
      Alert.alert(
        "Unable to open conversation",
        "The conversation could not be opened. Please try again.",
      );
    }
  }, [
    patientId,
    patientName,
    viewerId,
    effectiveProviderId,
    providerScopedAssignments,
    providerDisplayName,
    currentUser,
    navigation,
  ]);

  const openAdvocatePicker = useCallback(async () => {
    if (!isProviderView) return;

    if (!viewerId) {
      Alert.alert("User not ready", "Your provider account is still loading.");
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
    } catch (error) {
      devLog("ListAdvocateUsers ERR", error);
      Alert.alert(
        "Unable to load advocates",
        "The advocate list could not be loaded. Please try again.",
      );
    } finally {
      setAdvocatesLoading(false);
    }
  }, [advocates.length, isProviderView, viewerId, effectiveProviderId]);

  const handleAssignAdvocate = useCallback(
    async (selectedAdvocate) => {
      if (!isProviderView) {
        Alert.alert(
          "Action unavailable",
          "Only providers can invite advocates.",
        );
        return;
      }

      if (!viewerId) {
        Alert.alert(
          "User not ready",
          "Your provider account is still loading.",
        );
        return;
      }

      if (!patientId) {
        Alert.alert("Missing patient", "Patient information is not available.");
        return;
      }

      if (!effectiveProviderId) {
        Alert.alert(
          "Missing provider context",
          "Open this patient from a specific provider relationship to manage advocates.",
        );
        return;
      }

      if (!selectedAdvocate?.id) {
        Alert.alert(
          "Missing advocate",
          "The selected advocate could not be identified.",
        );
        return;
      }

      const existingActive = advocateAssignments.find(
        (a) =>
          a.patientId === patientId &&
          a.providerId === effectiveProviderId &&
          a.advocateId === selectedAdvocate.id &&
          a.active,
      );

      if (existingActive) {
        Alert.alert("Already Assigned", "This advocate is already assigned.");
        return;
      }

      const existingPending = advocateInvites.find(
        (invite) =>
          invite.patientId === patientId &&
          (invite.providerId === effectiveProviderId ||
            invite.createdBy === effectiveProviderId) &&
          invite.advocateId === selectedAdvocate.id &&
          invite.status === "PENDING",
      );

      if (existingPending) {
        Alert.alert(
          "Invite Already Sent",
          "This advocate already has a pending invite.",
        );
        return;
      }

      setAssigning(true);

      try {
        const activeAdvocateIds = uniq(
          (providerScopedAssignments || [])
            .filter((a) => a.active)
            .map((a) => a.advocateId),
        );

        await ensureCareTeamConversation({
          currentUserId: viewerId,
          patientId,
          providerId: effectiveProviderId,
          advocateIds: activeAdvocateIds,
          title: `Care Team: ${providerDisplayName}`,
        });

        const res = await safeGql({
          query: CreateAdvocateInviteGuarded,
          variables: {
            patientId,
            providerId: effectiveProviderId,
            advocateId: selectedAdvocate.id,
          },
          label: "CreateAdvocateInviteGuarded",
        });

        const newInvite = res?.data?.createAdvocateInviteGuarded;
        if (!newInvite) {
          throw new Error("No invite returned");
        }

        setAdvocateInvites((prev) =>
          [newInvite, ...prev].sort(
            (a, b) =>
              new Date(b.createdAt || 0).getTime() -
              new Date(a.createdAt || 0).getTime(),
          ),
        );

        setAdvocateUsersById((prev) => ({
          ...prev,
          [selectedAdvocate.id]: selectedAdvocate,
        }));

        setAdvocatePickerVisible(false);
        setManageExpanded(true);

        Alert.alert(
          "Invite sent",
          `${getUserDisplayName(
            selectedAdvocate,
            "Advocate",
          )} can approve this from their invites screen.`,
        );
      } catch (error) {
        const message = getGraphQlErrorMessage(error);
        const alertCopy = getInviteErrorAlert(message);
        devLog("Create advocate invite ERR", message, error);
        Alert.alert(alertCopy.title, alertCopy.body);
      } finally {
        setAssigning(false);
      }
    },
    [
      isProviderView,
      viewerId,
      patientId,
      effectiveProviderId,
      advocateAssignments,
      advocateInvites,
      providerScopedAssignments,
      providerDisplayName,
    ],
  );

  const handleRemoveAssignment = useCallback(
    (assignment) => {
      if (!isProviderView) return;

      const user = advocateUsersById[assignment.advocateId];
      const name = getUserDisplayName(user, "this advocate");

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
              } catch (error) {
                devLog("Update advocate assignment (remove) ERR", error);
                Alert.alert(
                  "Unable to remove advocate",
                  "The advocate could not be removed. Please try again.",
                );
              }
            },
          },
        ],
      );
    },
    [advocateUsersById, isProviderView],
  );

  const canOpenGroupChat =
    !!effectiveProviderId && activeAdvocatesForSummary.length > 0;

  const handleToggleManage = () => {
    if (!isProviderView) return;
    setManageExpanded((prev) => !prev);
  };

  const renderAdvocateProviderCard = (provider) => {
    const providerName = provider.providerName || "Provider";

    return (
      <SectionCard key={provider.providerId} style={styles.providerCard}>
        <View style={styles.providerHeaderRow}>
          <View style={styles.flexOne}>
            <Text style={styles.providerName} numberOfLines={1}>
              {providerName}
            </Text>
            <Text style={styles.providerSubtext} numberOfLines={1}>
              Provider-specific care team
            </Text>
          </View>
        </View>

        <View style={styles.providerActionsGrid}>
          <HeroActionButton
            variant="secondary"
            title={`Message ${providerName}`}
            subtitle="Direct provider chat"
            onPress={() =>
              openDirectChat({
                id: provider.providerId,
                displayName: providerName,
                email: provider.email,
              })
            }
            disabled={!viewerId || loadingCurrentUser}
          />

          <HeroActionButton
            variant="primary"
            title="Care Team Chat"
            subtitle={`${patientDisplayName} • ${providerName}`}
            onPress={() => openCareTeamChatForProvider(provider)}
            disabled={!viewerId || loadingCurrentUser}
          />
        </View>
      </SectionCard>
    );
  };

  const renderAdvocateView = () => {
    return (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, theme.space.sm) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <SectionCard style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <View style={styles.flexOne}>
              <Text style={styles.heroTitle}>Patient</Text>
              <Text style={styles.heroSubtitle} numberOfLines={1}>
                Shared advocate relationship
              </Text>
            </View>

            {loadingAssignments || loadingInvites ? (
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
                patientName && patientName.trim()
                  ? `Message ${patientName.trim()}`
                  : "Message Patient"
              }
              subtitle="One shared direct chat"
              onPress={() =>
                openDirectChat({
                  id: patientId,
                  displayName: patientDisplayName,
                  email: null,
                })
              }
              disabled={!viewerId || !patientId || loadingCurrentUser}
            />
          </View>
        </SectionCard>

        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Providers</Text>
          <Text style={styles.sectionCount}>{advocateProviders.length}</Text>
        </View>

        {advocateProviders.length === 0 && !loadingAssignments ? (
          <SectionCard>
            <Text style={styles.emptyTitle}>No providers found</Text>
            <Text style={styles.emptyBody}>
              Provider-specific care team chats will appear here after an
              advocate assignment is active.
            </Text>
          </SectionCard>
        ) : null}

        {advocateProviders.map(renderAdvocateProviderCard)}
      </ScrollView>
    );
  };

  const renderManageAdvocatesPanel = () => {
    if (!isProviderView) return null;
    if (!manageExpanded) return null;

    if (!effectiveProviderId) {
      return (
        <SectionCard style={styles.managePanel}>
          <Text style={styles.manageTitle}>Advocates</Text>
          <Text style={styles.manageHint}>
            This patient can have multiple providers. Open this screen from a
            specific provider relationship to manage advocates for that
            provider.
          </Text>
        </SectionCard>
      );
    }

    if (loadingAssignments || loadingInvites) {
      return (
        <SectionCard style={styles.managePanel}>
          <View style={styles.manageHeaderRow}>
            <Text style={styles.manageTitle}>Advocates</Text>
            <View style={styles.heroLoadingPill}>
              <ActivityIndicator size="small" />
              <Text style={styles.heroLoadingText}>Loading</Text>
            </View>
          </View>
        </SectionCard>
      );
    }

    const hasActive = activeAssignmentsForManagePanel.length > 0;
    const hasPending = pendingInvitesForManagePanel.length > 0;

    return (
      <SectionCard style={styles.managePanel}>
        <View style={styles.manageHeaderRow}>
          <View style={styles.flexOne}>
            <Text style={styles.manageTitle}>Advocates</Text>
            <Text style={styles.manageHint} numberOfLines={2}>
              Active advocates for {providerDisplayName}. Pending invites stay
              here until the advocate approves them.
            </Text>
          </View>
        </View>

        {hasActive
          ? activeAssignmentsForManagePanel.map((assignment) => {
              const user = advocateUsersById[assignment.advocateId] || {};
              const name = getUserDisplayName(user, "Advocate");

              return (
                <View key={assignment.id} style={styles.manageRow}>
                  <View style={styles.flexOne}>
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
                      activeOpacity={0.85}
                    >
                      <Text style={styles.manageMsgBtnText}>Message</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.manageRemoveBtn}
                      onPress={() => handleRemoveAssignment(assignment)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.manageRemoveBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          : null}

        {hasPending ? (
          <View style={styles.pendingSection}>
            <Text style={styles.pendingSectionTitle}>Pending Invites</Text>
            {pendingInvitesForManagePanel.map((invite) => {
              const user = advocateUsersById[invite.advocateId] || {};
              const name = getUserDisplayName(user, "Advocate");

              return (
                <View key={invite.id} style={styles.pendingRow}>
                  <View style={styles.flexOne}>
                    <Text style={styles.manageName} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={styles.pendingSub} numberOfLines={1}>
                      Waiting for advocate approval
                    </Text>
                  </View>

                  <View style={styles.pendingPill}>
                    <Text style={styles.pendingPillText}>Pending</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {!hasActive && !hasPending ? (
          <View style={styles.manageEmptyBox}>
            <Text style={styles.manageEmptyTitle}>No advocates yet</Text>
            <Text style={styles.manageEmptyBody}>
              Send an invite to add an advocate to this patient’s care team
              after they approve it.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[
            styles.manageAssignBtnBelow,
            assigning && styles.heroBtnDisabled,
          ]}
          onPress={openAdvocatePicker}
          disabled={assigning}
          activeOpacity={0.85}
        >
          <Text style={styles.manageAssignBtnBelowText}>
            {assigning ? "Sending…" : "Invite Advocate"}
          </Text>
        </TouchableOpacity>
      </SectionCard>
    );
  };

  const renderProviderView = () => {
    return (
      <View style={styles.content}>
        <SectionCard style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Text style={styles.heroTitle}>Care Team</Text>

            {loadingAssignments || loadingInvites ? (
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

            <HeroActionButton
              variant="ghost"
              title={
                manageExpanded ? "Hide Manage Advocates" : "Manage Advocates"
              }
              subtitle="View advocates, invites, and messages"
              onPress={handleToggleManage}
              disabled={!viewerId || loadingCurrentUser}
            />
          </View>

          {renderManageAdvocatesPanel()}
        </SectionCard>
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
          activeOpacity={0.85}
        >
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>

        <View style={styles.topBarTitleWrap}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {patientDisplayName}
          </Text>
        </View>

        <View style={styles.topBarSpacer} />
      </View>

      {isAdvocateView ? renderAdvocateView() : renderProviderView()}

      {isProviderView ? (
        <AdvocatePickerModal
          visible={advocatePickerVisible}
          onClose={() => setAdvocatePickerVisible(false)}
          advocates={advocates}
          loading={advocatesLoading}
          onSelect={handleAssignAdvocate}
          existingAssignments={providerScopedAssignments}
          pendingInvites={providerScopedPendingInvites}
        />
      ) : null}
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
  pendingInvites = [],
}) => {
  const [selectedAdvocateId, setSelectedAdvocateId] = useState(null);

  useEffect(() => {
    if (!visible) setSelectedAdvocateId(null);
  }, [visible]);

  const statusMap = {};

  existingAssignments.forEach((a) => {
    if (a.active) statusMap[a.advocateId] = "Active";
  });

  pendingInvites.forEach((invite) => {
    if (invite.status === "PENDING" && !statusMap[invite.advocateId]) {
      statusMap[invite.advocateId] = "Pending Invite";
    }
  });

  const handleConfirm = () => {
    if (!selectedAdvocateId) {
      Alert.alert("Select an advocate", "Please choose an advocate first.");
      return;
    }

    if (statusMap[selectedAdvocateId] === "Active") {
      Alert.alert("Already Assigned", "This advocate is already assigned.");
      return;
    }

    if (statusMap[selectedAdvocateId] === "Pending Invite") {
      Alert.alert(
        "Invite Already Sent",
        "This advocate already has a pending invite.",
      );
      return;
    }

    const advocate = advocates.find((a) => a.id === selectedAdvocateId);
    onSelect(advocate);
  };

  const renderItem = ({ item }) => {
    const status = statusMap[item.id] || null;
    const isDisabled = !!status;
    const isSelected = item.id === selectedAdvocateId;

    return (
      <TouchableOpacity
        disabled={isDisabled}
        style={[
          styles.advocateRow,
          isSelected && !isDisabled && styles.advocateRowSelected,
          isDisabled && styles.advocateRowDisabled,
        ]}
        onPress={() => {
          if (!isDisabled) setSelectedAdvocateId(item.id);
        }}
        activeOpacity={0.85}
      >
        <View style={styles.flexOne}>
          <Text style={styles.advocateName} numberOfLines={1}>
            {getUserDisplayName(item, "Unnamed Advocate")}
          </Text>
          {status ? (
            <Text style={styles.advocateStatusText}>{status}</Text>
          ) : null}
        </View>

        {!isDisabled && isSelected ? (
          <Text style={styles.advocateSelectedMark}>✓</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Invite Advocate</Text>

          {loading ? (
            <ActivityIndicator style={styles.modalLoading} />
          ) : advocates.length === 0 ? (
            <Text style={styles.cardText}>No advocates available.</Text>
          ) : (
            <FlatList
              data={advocates}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={styles.modalList}
              keyboardShouldPersistTaps="handled"
            />
          )}

          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleConfirm}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryButtonText}>Send Invite</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
  },

  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.xs,
    gap: theme.space.xs,
  },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  backText: {
    ...theme.type.body,
    fontWeight: "700",
    color: theme.colors.text,
  },

  topBarTitleWrap: {
    flex: 1,
  },

  topBarTitle: {
    ...theme.type.h2,
    textAlign: "center",
  },

  topBarSpacer: {
    width: 40,
    height: 40,
  },

  content: {
    flex: 1,
    paddingHorizontal: theme.space.sm,
    paddingTop: theme.space.xs,
  },

  sectionCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  heroCard: {
    marginBottom: theme.space.sm,
  },

  heroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.xs,
  },

  heroTitle: {
    ...theme.type.h3,
    color: theme.colors.text,
  },

  heroSubtitle: {
    ...theme.type.small,
    color: theme.colors.subtext,
    marginTop: 2,
  },

  heroLoadingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.xs + 2,
    paddingVertical: theme.space.xs / 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.disabledBg,
  },

  heroLoadingText: {
    ...theme.type.small,
    color: theme.colors.muted,
    fontWeight: "600",
  },

  heroActionsGrid: {
    marginTop: theme.space.sm,
    gap: theme.space.xs,
  },

  heroBtn: {
    paddingVertical: theme.space.xs + 4,
    paddingHorizontal: theme.space.xs + 4,
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

  heroBtnDisabled: {
    opacity: 0.6,
  },

  heroBtnTitle: {
    ...theme.type.subtext,
    fontWeight: "700",
    color: theme.colors.text,
  },

  heroBtnSub: {
    ...theme.type.small,
    marginTop: 4,
    color: theme.colors.subtext,
  },

  heroBtnTitleOnPrimary: {
    color: theme.colors.primaryText,
  },

  heroBtnSubOnPrimary: {
    color: theme.colors.infoBg,
  },

  sectionTitleRow: {
    marginTop: theme.space.xs,
    marginBottom: theme.space.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionTitle: {
    ...theme.type.h3,
    color: theme.colors.text,
  },

  sectionCount: {
    ...theme.type.small,
    fontWeight: "800",
    color: theme.colors.subtext,
  },

  providerCard: {
    marginBottom: theme.space.sm,
  },

  providerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.xs,
  },

  providerName: {
    ...theme.type.subtext,
    fontWeight: "800",
    color: theme.colors.text,
  },

  providerSubtext: {
    ...theme.type.small,
    color: theme.colors.subtext,
    marginTop: 3,
  },

  providerActionsGrid: {
    marginTop: theme.space.sm,
    gap: theme.space.xs,
  },

  emptyTitle: {
    ...theme.type.subtext,
    fontWeight: "800",
    color: theme.colors.text,
  },

  emptyBody: {
    ...theme.type.small,
    color: theme.colors.subtext,
    marginTop: 4,
    lineHeight: 18,
  },

  managePanel: {
    marginTop: theme.space.sm,
  },

  manageHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.space.xs,
  },

  manageTitle: {
    ...theme.type.h3,
    color: theme.colors.text,
  },

  manageHint: {
    ...theme.type.small,
    marginTop: 4,
    color: theme.colors.subtext,
    lineHeight: 18,
  },

  manageRow: {
    marginTop: theme.space.xs,
    padding: theme.space.xs + 4,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
  },

  manageRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.xs,
  },

  manageName: {
    ...theme.type.body,
    fontWeight: "600",
    color: theme.colors.text,
    flex: 1,
    paddingRight: theme.space.xs,
  },

  manageSub: {
    ...theme.type.small,
    marginTop: 4,
    color: theme.colors.subtext,
  },

  manageActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
  },

  manageMsgBtn: {
    paddingHorizontal: theme.space.xs + 4,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  manageMsgBtnText: {
    ...theme.type.small,
    fontWeight: "700",
    color: theme.colors.infoText,
  },

  manageRemoveBtn: {
    paddingHorizontal: theme.space.xs + 4,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.dangerBg,
    backgroundColor: theme.colors.dangerBg,
  },

  manageRemoveBtnText: {
    ...theme.type.small,
    fontWeight: "700",
    color: theme.colors.dangerText,
  },

  pendingSection: {
    marginTop: theme.space.sm,
    paddingTop: theme.space.xs,
  },

  pendingSectionTitle: {
    ...theme.type.small,
    fontWeight: "700",
    color: theme.colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  pendingRow: {
    marginTop: theme.space.xs,
    paddingVertical: theme.space.sm - 2,
    paddingHorizontal: theme.space.xs + 4,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.xs,
    minHeight: 72,
  },

  pendingSub: {
    ...theme.type.small,
    marginTop: 4,
    color: theme.colors.subtext,
  },

  pendingPill: {
    paddingHorizontal: theme.space.xs + 2,
    paddingVertical: theme.space.xs / 2 + 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  pendingPillText: {
    ...theme.type.small,
    fontWeight: "700",
    color: theme.colors.infoText,
  },

  manageEmptyBox: {
    marginTop: theme.space.xs,
    padding: theme.space.xs + 4,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  manageEmptyTitle: {
    ...theme.type.subtext,
    fontWeight: "700",
    color: theme.colors.text,
  },

  manageEmptyBody: {
    ...theme.type.small,
    marginTop: 4,
    color: theme.colors.subtext,
    lineHeight: 18,
  },

  manageAssignBtnBelow: {
    marginTop: theme.space.xs,
    paddingHorizontal: theme.space.xs + 4,
    paddingVertical: theme.space.xs + 2,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
  },

  manageAssignBtnBelowText: {
    ...theme.type.small,
    fontWeight: "700",
    color: theme.colors.primaryText,
  },

  cardText: {
    ...theme.type.body,
    color: theme.colors.text,
  },

  primaryButton: {
    paddingVertical: theme.space.xs + 2,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    minWidth: 120,
  },

  primaryButtonText: {
    ...theme.type.subtext,
    fontWeight: "700",
    color: theme.colors.primaryText,
  },

  secondaryButton: {
    paddingVertical: theme.space.xs + 2,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.card,
    minWidth: 100,
  },

  secondaryButtonText: {
    ...theme.type.subtext,
    fontWeight: "700",
    color: theme.colors.text,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: theme.colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.space.sm,
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

  modalTitle: {
    ...theme.type.h3,
    marginBottom: theme.space.xs,
    color: theme.colors.text,
  },

  modalLoading: {
    marginVertical: theme.space.sm,
  },

  modalList: {
    maxHeight: 320,
    width: "100%",
  },

  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: theme.space.sm,
    gap: theme.space.xs,
  },

  advocateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.space.xs + 2,
    paddingHorizontal: theme.space.xs + 2,
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },

  advocateRowSelected: {
    backgroundColor: theme.colors.providerBg,
    borderColor: theme.colors.border,
  },

  advocateRowDisabled: {
    opacity: 0.45,
  },

  advocateName: {
    ...theme.type.subtext,
    fontWeight: "700",
    color: theme.colors.text,
  },

  advocateStatusText: {
    ...theme.type.small,
    color: theme.colors.subtext,
    marginTop: 2,
  },

  advocateSelectedMark: {
    ...theme.type.body,
    fontWeight: "700",
    color: theme.colors.primary,
  },
});

export default PatientDetailScreen;
