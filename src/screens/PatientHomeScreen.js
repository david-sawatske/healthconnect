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
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import ConversationListItem from "../components/ConversationListItem";
import RolePill from "../components/RolePill";
import {
  ensureDirectConversation,
  ensureCareTeamConversation,
} from "../features/chat/conversationService";

import { theme } from "../ui/theme";

const client = generateClient();

const devLog = (...args) => {
  if (__DEV__) console.log("[PATIENT_HOME]", ...args);
};

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
        createdAt
        updatedAt
        isGroup
        createdBy
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

const PROVIDER_PATIENTS_BY_PATIENT = /* GraphQL */ `
  query ProviderPatientsByPatient($patientId: ID!) {
    providerPatientsByPatient(patientId: $patientId) {
      items {
        id
        patientId
        providerId
        provider {
          id
          displayName
          role
          email
        }
      }
    }
  }
`;

const ADVOCATE_ASSIGNMENTS_FOR_PATIENT = /* GraphQL */ `
  query AdvocateAssignmentsForPatient($patientId: ID!) {
    advocateAssignmentsByPatient(patientId: $patientId) {
      items {
        id
        patientId
        providerId
        advocateId
        createdAt
      }
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

const LAST_MESSAGE_BY_CONVERSATION = /* GraphQL */ `
  query LastMessageByConversation($conversationId: ID!, $limit: Int) {
    messagesByConversation(
      conversationId: $conversationId
      sortDirection: DESC
      limit: $limit
    ) {
      items {
        id
        type
        body
        senderId
        createdAt
      }
    }
  }
`;

const PAGE_SIZE = 20;
const PREVIEW_COUNT = 20;

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function getUserDisplay(user) {
  return user?.displayName || user?.email || null;
}

function getConversationTitle({ conversation, currentUserId, usersById }) {
  if (conversation?.title) return conversation.title;

  const memberIds = Array.isArray(conversation?.memberIds)
    ? conversation.memberIds
    : [];

  const otherIds = memberIds.filter((id) => id && id !== currentUserId);

  if (!conversation?.isGroup) {
    if (otherIds.length === 1) {
      return getUserDisplay(usersById[otherIds[0]]) || "Conversation";
    }
    return "Conversation";
  }

  const names = otherIds
    .map((id) => getUserDisplay(usersById[id]))
    .filter(Boolean);

  if (names.length) return names.join(", ");

  return "Conversation";
}

const PatientHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [activeTab, setActiveTab] = useState("conversations");

  const [conversations, setConversations] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  const [careTeamLoading, setCareTeamLoading] = useState(false);
  const [careTeamError, setCareTeamError] = useState(null);
  const [careTeam, setCareTeam] = useState({
    providers: [],
    advocates: [],
  });

  const [loadingConvos, setLoadingConvos] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [lastMessageByConvo, setLastMessageByConvo] = useState({});
  const [loadingLastByConvo, setLoadingLastByConvo] = useState({});

  const [lastReadAtByConvoId, setLastReadAtByConvoId] = useState({});
  const [loadingReads, setLoadingReads] = useState(false);

  const [usersById, setUsersById] = useState({});

  const lastMessageRef = useRef({});
  const loadingLastRef = useRef({});
  const lastReadAtRef = useRef({});
  const usersByIdRef = useRef({});

  useEffect(() => {
    lastMessageRef.current = lastMessageByConvo;
  }, [lastMessageByConvo]);

  useEffect(() => {
    loadingLastRef.current = loadingLastByConvo;
  }, [loadingLastByConvo]);

  useEffect(() => {
    lastReadAtRef.current = lastReadAtByConvoId;
  }, [lastReadAtByConvoId]);

  useEffect(() => {
    usersByIdRef.current = usersById;
  }, [usersById]);

  const username = currentUser?.displayName || "Patient";

  const careTeamBottomPadding = insets.bottom + theme.space.lg;
  const conversationsBottomPadding = insets.bottom + theme.space.lg;

  const getLastActivityTs = useCallback((c) => {
    return c?.lastMessageAt || c?.updatedAt || c?.createdAt || 0;
  }, []);

  const sortByLastActivity = useCallback(
    (arr) => {
      return [...arr].sort((a, b) => {
        const at = new Date(getLastActivityTs(a)).getTime();
        const bt = new Date(getLastActivityTs(b)).getTime();
        return bt - at;
      });
    },
    [getLastActivityTs],
  );

  const fetchUserMapForIds = useCallback(async (ids) => {
    const uniqueIds = uniq(ids).filter((id) => !usersByIdRef.current[id]);
    if (!uniqueIds.length) return {};

    try {
      const results = await Promise.all(
        uniqueIds.map(async (id) => {
          try {
            const { data } = await client.graphql({
              query: GET_USER,
              variables: { id },
              authMode: "userPool",
            });
            return data?.getUser || null;
          } catch (err) {
            console.log("[PATIENT_HOME] Error fetching user:", id, err);
            return null;
          }
        }),
      );

      const map = {};
      results.forEach((u) => {
        if (u?.id) map[u.id] = u;
      });

      if (Object.keys(map).length) {
        usersByIdRef.current = {
          ...usersByIdRef.current,
          ...map,
        };

        setUsersById((prev) => ({ ...prev, ...map }));
      }

      return map;
    } catch (err) {
      console.log("[PATIENT_HOME] fetchUserMapForIds error:", err);
      return {};
    }
  }, []);

  const fetchLastMessage = useCallback(async (conversationId) => {
    if (!conversationId) return;

    if (
      Object.prototype.hasOwnProperty.call(
        lastMessageRef.current,
        conversationId,
      )
    ) {
      return;
    }
    if (loadingLastRef.current?.[conversationId]) return;

    loadingLastRef.current = {
      ...loadingLastRef.current,
      [conversationId]: true,
    };
    setLoadingLastByConvo((prev) => ({ ...prev, [conversationId]: true }));

    try {
      const { data } = await client.graphql({
        query: LAST_MESSAGE_BY_CONVERSATION,
        variables: { conversationId, limit: 1 },
        authMode: "userPool",
      });

      const items = data?.messagesByConversation?.items || [];
      const last = items[0] || null;

      lastMessageRef.current = {
        ...lastMessageRef.current,
        [conversationId]: last,
      };
      setLastMessageByConvo((prev) => ({ ...prev, [conversationId]: last }));
    } catch (err) {
      console.log(
        "[PATIENT_HOME] fetchLastMessage error:",
        conversationId,
        err,
      );
      lastMessageRef.current = {
        ...lastMessageRef.current,
        [conversationId]: null,
      };
      setLastMessageByConvo((prev) => ({ ...prev, [conversationId]: null }));
    } finally {
      loadingLastRef.current = {
        ...loadingLastRef.current,
        [conversationId]: false,
      };
      setLoadingLastByConvo((prev) => ({ ...prev, [conversationId]: false }));
    }
  }, []);

  const fetchMyReadState = useCallback(async () => {
    if (!currentUser?.id) return;

    setLoadingReads(true);
    try {
      let next = null;
      const map = {};

      do {
        const { data } = await client.graphql({
          query: CONVERSATION_PARTICIPANTS_BY_USER,
          variables: {
            userId: currentUser.id,
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
      console.log("[PATIENT_HOME] fetchMyReadState error:", err);
      lastReadAtRef.current = {};
      setLastReadAtByConvoId({});
    } finally {
      setLoadingReads(false);
    }
  }, [currentUser?.id]);

  const fetchConversations = useCallback(
    async ({ reset = false } = {}) => {
      if (!currentUser?.id) return;

      try {
        if (reset) {
          setLoadingConvos(true);
          setError(null);
        }

        const { data } = await client.graphql({
          query: LIST_MY_CONVERSATIONS,
          variables: {
            sub: currentUser.id,
            limit: PAGE_SIZE,
            nextToken: reset ? null : nextToken,
          },
          authMode: "userPool",
        });

        const result = data?.listConversations;
        const newItems = result?.items || [];

        setConversations((prev) => {
          const merged = reset ? newItems : [...prev, ...newItems];
          return sortByLastActivity(merged);
        });

        setNextToken(result?.nextToken || null);
      } catch (err) {
        console.log("[PATIENT_HOME] Error fetching conversations:", err);
        setError("Unable to load conversations.");
      } finally {
        setLoadingConvos(false);
        setRefreshing(false);
      }
    },
    [currentUser?.id, nextToken, sortByLastActivity],
  );

  const fetchCareTeam = useCallback(async () => {
    if (!currentUser?.id) return;

    try {
      setCareTeamLoading(true);
      setCareTeamError(null);

      const [providerResult, advocateResult] = await Promise.all([
        client.graphql({
          query: PROVIDER_PATIENTS_BY_PATIENT,
          variables: { patientId: currentUser.id },
          authMode: "userPool",
        }),
        client.graphql({
          query: ADVOCATE_ASSIGNMENTS_FOR_PATIENT,
          variables: { patientId: currentUser.id },
          authMode: "userPool",
        }),
      ]);

      const providerPatients =
        providerResult?.data?.providerPatientsByPatient?.items || [];

      const assignments =
        advocateResult?.data?.advocateAssignmentsByPatient?.items || [];

      const providerToAdvocates = new Map();
      const advocateToProviders = new Map();
      const providerUsersById = {};

      providerPatients.forEach((pp) => {
        if (!pp?.providerId) return;

        if (!providerToAdvocates.has(pp.providerId)) {
          providerToAdvocates.set(pp.providerId, new Set());
        }

        if (pp.provider?.id) {
          providerUsersById[pp.provider.id] = pp.provider;
        }
      });

      assignments.forEach((assignment) => {
        if (!assignment?.providerId) return;

        if (!providerToAdvocates.has(assignment.providerId)) {
          providerToAdvocates.set(assignment.providerId, new Set());
        }

        if (assignment.advocateId) {
          providerToAdvocates
            .get(assignment.providerId)
            .add(assignment.advocateId);

          if (!advocateToProviders.has(assignment.advocateId)) {
            advocateToProviders.set(assignment.advocateId, new Set());
          }

          advocateToProviders
            .get(assignment.advocateId)
            .add(assignment.providerId);
        }
      });

      const providerIds = Array.from(providerToAdvocates.keys()).filter(
        Boolean,
      );

      const advocateIds = Array.from(advocateToProviders.keys()).filter(
        Boolean,
      );

      const providerIdsMissingUsers = providerIds.filter(
        (id) => !providerUsersById[id],
      );

      const loadedUsers = await fetchUserMapForIds([
        ...providerIdsMissingUsers,
        ...advocateIds,
      ]);

      const mergedUsers = {
        ...usersByIdRef.current,
        ...providerUsersById,
        ...loadedUsers,
      };

      if (Object.keys(providerUsersById).length) {
        usersByIdRef.current = {
          ...usersByIdRef.current,
          ...providerUsersById,
        };

        setUsersById((prev) => ({
          ...prev,
          ...providerUsersById,
        }));
      }

      const providers = providerIds
        .map((providerId) => {
          const providerUser = mergedUsers[providerId] || null;
          const advocateIdsForProvider = Array.from(
            providerToAdvocates.get(providerId) || [],
          ).filter(Boolean);

          return {
            providerId,
            providerUser,
            advocateIds: advocateIdsForProvider,
          };
        })
        .sort((a, b) => {
          const an = (
            a.providerUser?.displayName ||
            a.providerUser?.email ||
            ""
          ).toLowerCase();

          const bn = (
            b.providerUser?.displayName ||
            b.providerUser?.email ||
            ""
          ).toLowerCase();

          return an.localeCompare(bn);
        });

      const advocates = advocateIds
        .map((advocateId) => {
          const advocateUser = mergedUsers[advocateId] || null;
          const providerIdsForAdvocate = Array.from(
            advocateToProviders.get(advocateId) || [],
          ).filter(Boolean);

          const providerNames = providerIdsForAdvocate
            .map((providerId) => {
              const providerUser = mergedUsers[providerId];
              return (
                providerUser?.displayName || providerUser?.email || "Provider"
              );
            })
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

          return {
            advocateId,
            advocateUser,
            providerIds: providerIdsForAdvocate,
            providerNames,
          };
        })
        .sort((a, b) => {
          const an = (
            a.advocateUser?.displayName ||
            a.advocateUser?.email ||
            ""
          ).toLowerCase();

          const bn = (
            b.advocateUser?.displayName ||
            b.advocateUser?.email ||
            ""
          ).toLowerCase();

          return an.localeCompare(bn);
        });

      setCareTeam({
        providers,
        advocates,
      });
    } catch (err) {
      console.log("[PATIENT_HOME] Error fetching care team:", err);
      setCareTeamError("Unable to load your care team.");
      setCareTeam({
        providers: [],
        advocates: [],
      });
    } finally {
      setCareTeamLoading(false);
    }
  }, [currentUser?.id, fetchUserMapForIds]);

  useEffect(() => {
    if (!currentUser?.id) return;
    fetchConversations({ reset: true });
    fetchMyReadState();
    fetchCareTeam();
  }, [currentUser?.id, fetchConversations, fetchMyReadState, fetchCareTeam]);

  useEffect(() => {
    if (!conversations.length) return;

    conversations
      .slice(0, PREVIEW_COUNT)
      .forEach((c) => fetchLastMessage(c.id));

    const idsToLoad = uniq(conversations.flatMap((c) => c.memberIds || []));
    fetchUserMapForIds(idsToLoad);
  }, [conversations, fetchLastMessage, fetchUserMapForIds]);

  const onRefresh = useCallback(() => {
    if (!currentUser?.id) return;

    setRefreshing(true);

    lastMessageRef.current = {};
    loadingLastRef.current = {};
    setLastMessageByConvo({});
    setLoadingLastByConvo({});

    fetchConversations({ reset: true });
    fetchMyReadState();
    fetchCareTeam();
  }, [currentUser?.id, fetchConversations, fetchMyReadState, fetchCareTeam]);

  useFocusEffect(
    useCallback(() => {
      if (!currentUser?.id) return;

      fetchConversations({ reset: true });
      fetchMyReadState();
      fetchCareTeam();

      return () => {};
    }, [currentUser?.id, fetchConversations, fetchMyReadState, fetchCareTeam]),
  );

  const loadMore = () => {
    if (!nextToken || loadingConvos) return;
    fetchConversations({ reset: false });
  };

  const handleOpenConversation = (conversation) => {
    navigation.navigate("Chat", {
      conversationId: conversation.id,
      conversation,
      title: getConversationTitle({
        conversation,
        currentUserId: currentUser?.id,
        usersById: usersByIdRef.current,
      }),
    });
  };

  const handleOpenCareTeamChat = useCallback(
    async (targetUser) => {
      if (!targetUser?.id || !currentUser?.id) return;

      try {
        const conversation = await ensureDirectConversation({
          currentUserId: currentUser.id,
          memberIds: [currentUser.id, targetUser.id],
          title: `${currentUser.displayName || "You"} ↔ ${
            targetUser.displayName || "Care Team"
          }`,
        });

        setConversations((prev) => {
          if (prev.some((c) => c.id === conversation.id)) return prev;
          return sortByLastActivity([conversation, ...prev]);
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title:
            getConversationTitle({
              conversation,
              currentUserId: currentUser.id,
              usersById: {
                ...usersByIdRef.current,
                [targetUser.id]: targetUser,
              },
            }) ||
            targetUser.displayName ||
            "Care Team Conversation",
        });
      } catch (err) {
        devLog("handleOpenCareTeamChat error:", err);
        Alert.alert(
          "Unable to open chat",
          "Something went wrong while opening the conversation.",
        );
      }
    },
    [currentUser?.id, currentUser?.displayName, navigation, sortByLastActivity],
  );

  const handleOpenCareTeamGroupChat = useCallback(
    async ({ providerId, providerName, advocateIds }) => {
      if (!currentUser?.id) return;
      if (!providerId) return;

      try {
        const conversation = await ensureCareTeamConversation({
          currentUserId: currentUser.id,
          patientId: currentUser.id,
          providerId,
          advocateIds,
          title: `Care Team: ${providerName || "Provider"}`,
        });

        setConversations((prev) => {
          if (prev.some((c) => c.id === conversation.id)) return prev;
          return sortByLastActivity([conversation, ...prev]);
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: getConversationTitle({
            conversation,
            currentUserId: currentUser.id,
            usersById: usersByIdRef.current,
          }),
        });
      } catch (err) {
        devLog("handleOpenCareTeamGroupChat error:", err);
        Alert.alert(
          "Unable to open care team chat",
          "Something went wrong while opening the care team conversation.",
        );
      }
    },
    [currentUser?.id, navigation, sortByLastActivity],
  );

  const careTeamRows = useMemo(() => {
    const rows = [];

    if (careTeam.providers.length) {
      rows.push({
        type: "section",
        id: "providers-section",
        title: "Providers",
        subtitle: "Message providers directly or open a care-team chat.",
      });

      careTeam.providers.forEach((provider) => {
        rows.push({
          type: "provider",
          id: `provider-${provider.providerId}`,
          ...provider,
        });
      });
    }

    rows.push({
      type: "section",
      id: "advocates-section",
      title: "Advocates",
      subtitle: "Advocates are listed once with the providers they support.",
    });

    if (careTeam.advocates.length) {
      careTeam.advocates.forEach((advocate) => {
        rows.push({
          type: "advocate",
          id: `advocate-${advocate.advocateId}`,
          ...advocate,
        });
      });
    } else {
      rows.push({
        type: "emptyAdvocates",
        id: "empty-advocates",
      });
    }

    return rows;
  }, [careTeam]);

  const hasCareTeam =
    careTeam.providers.length > 0 || careTeam.advocates.length > 0;

  const hasConversations = conversations.length > 0;
  const showGlobalLoader = loadingCurrentUser && !hasConversations;

  const Header = (
    <>
      <View style={styles.header}>
        <View>
          <Text style={styles.username}>{username}</Text>
        </View>

        <RolePill role={currentUser?.role} />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.segmentWrap}>
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeTab === "conversations" && styles.segmentBtnActive,
          ]}
          onPress={() => setActiveTab("conversations")}
        >
          <Text
            style={[
              styles.segmentText,
              activeTab === "conversations" && styles.segmentTextActive,
            ]}
          >
            Conversations
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeTab === "careTeam" && styles.segmentBtnActive,
          ]}
          onPress={() => setActiveTab("careTeam")}
        >
          <Text
            style={[
              styles.segmentText,
              activeTab === "careTeam" && styles.segmentTextActive,
            ]}
          >
            Care Team
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );

  const CareTeamListHeader = (
    <>
      {Header}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>My Care Team</Text>
        {careTeamLoading ? (
          <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
        ) : null}
      </View>

      {careTeamError ? (
        <Text style={styles.sectionErrorText}>{careTeamError}</Text>
      ) : null}
    </>
  );

  const renderProviderCard = (provider) => {
    const providerName =
      provider.providerUser?.displayName ||
      provider.providerUser?.email ||
      "Provider";

    const advocateIds = provider.advocateIds || [];
    const hasAdvocates = advocateIds.length > 0;

    return (
      <View style={styles.providerCard}>
        <View style={styles.cardTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName} numberOfLines={1}>
              {providerName}
            </Text>

            <Text style={styles.cardHint} numberOfLines={1}>
              {hasAdvocates
                ? `${advocateIds.length} advocate${
                    advocateIds.length === 1 ? "" : "s"
                  } assigned`
                : "No advocates assigned"}
            </Text>
          </View>

          <Text style={[styles.badge, styles.providerBadge]}>Provider</Text>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              handleOpenCareTeamChat(
                provider.providerUser || {
                  id: provider.providerId,
                  displayName: providerName,
                },
              )
            }
          >
            <Text style={styles.primaryBtnText}>Message</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              !hasAdvocates && styles.secondaryBtnDisabled,
            ]}
            onPress={() => {
              if (!hasAdvocates) {
                Alert.alert(
                  "Advocate access required",
                  `Contact ${providerName} or an admin to request advocate access for this provider before using the care team chat.`,
                );
                return;
              }

              handleOpenCareTeamGroupChat({
                providerId: provider.providerId,
                providerName,
                advocateIds,
              });
            }}
          >
            <Text
              style={[
                styles.secondaryBtnText,
                !hasAdvocates && styles.secondaryBtnTextDisabled,
              ]}
            >
              Care Team Chat
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderAdvocateCard = (advocate) => {
    const advocateName =
      advocate.advocateUser?.displayName ||
      advocate.advocateUser?.email ||
      "Advocate";

    const providerNames = advocate.providerNames || [];
    const supportsText = providerNames.length
      ? `Supports: ${providerNames.join(", ")}`
      : "Supports: Provider relationship pending";

    return (
      <View style={styles.advocateCard}>
        <View style={styles.cardTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName} numberOfLines={1}>
              {advocateName}
            </Text>

            <Text style={styles.supportsText} numberOfLines={2}>
              {supportsText}
            </Text>
          </View>

          <Text style={[styles.badge, styles.advocateBadge]}>Advocate</Text>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() =>
              handleOpenCareTeamChat(
                advocate.advocateUser || {
                  id: advocate.advocateId,
                  displayName: advocateName,
                },
              )
            }
          >
            <Text style={styles.primaryBtnText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCareTeamRow = ({ item }) => {
    if (item.type === "section") {
      return (
        <View style={styles.careTeamSection}>
          <Text style={styles.careTeamSectionTitle}>{item.title}</Text>
          <Text style={styles.careTeamSectionSubtitle}>{item.subtitle}</Text>
        </View>
      );
    }

    if (item.type === "provider") {
      return renderProviderCard(item);
    }

    if (item.type === "advocate") {
      return renderAdvocateCard(item);
    }

    if (item.type === "emptyAdvocates") {
      return (
        <View style={styles.emptyInfo}>
          <Text style={styles.emptyInfoTitle}>No advocates assigned</Text>
          <Text style={styles.emptyInfoBody}>
            Contact your provider or an admin to request advocate access.
          </Text>
        </View>
      );
    }

    return null;
  };

  if (showGlobalLoader) {
    return (
      <View style={styles.container}>
        {Header}
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading your home…</Text>
        </View>
      </View>
    );
  }

  if (activeTab === "careTeam") {
    return (
      <View style={styles.container}>
        <FlatList
          data={hasCareTeam ? careTeamRows : []}
          keyExtractor={(item) => item.id}
          renderItem={renderCareTeamRow}
          ListHeaderComponent={CareTeamListHeader}
          contentContainerStyle={[
            styles.careTeamListContent,
            { paddingBottom: careTeamBottomPadding },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            !careTeamLoading ? (
              <View style={styles.emptyInfo}>
                <Text style={styles.emptyInfoTitle}>No care team yet</Text>
                <Text style={styles.emptyInfoBody}>
                  Once a provider is connected to you, they’ll appear here.
                </Text>
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={Header}
        renderItem={({ item }) => {
          const last = lastMessageByConvo[item.id];
          const lastLoading = loadingLastByConvo[item.id];

          const preview = lastLoading
            ? "Loading preview…"
            : last?.type === "SYSTEM"
              ? last?.body || "System update"
              : last?.body || "No messages yet";

          const ts = getLastActivityTs(item);

          const lastReadAt = lastReadAtRef.current?.[item.id] || null;
          const lastMsgAt = item?.lastMessageAt || null;

          const isUnread =
            !!lastMsgAt &&
            (!lastReadAt ||
              new Date(lastReadAt).getTime() < new Date(lastMsgAt).getTime());

          const title = getConversationTitle({
            conversation: item,
            currentUserId: currentUser?.id,
            usersById,
          });

          return (
            <ConversationListItem
              title={title}
              preview={preview}
              timestamp={ts}
              unread={isUnread}
              onPress={() => handleOpenConversation(item)}
              testID={`conversation-${item.id}`}
            />
          );
        }}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: conversationsBottomPadding },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <View style={styles.emptyInfo}>
            <Text style={styles.emptyInfoTitle}>No conversations yet</Text>
            <Text style={styles.emptyInfoBody}>
              When someone starts a conversation with you, it will appear here.
            </Text>
          </View>
        }
        ListFooterComponent={
          loadingConvos && !refreshing ? (
            <ActivityIndicator style={{ marginVertical: 12 }} />
          ) : null
        }
        showsVerticalScrollIndicator={false}
      />

      {loadingReads ? (
        <View
          style={[
            styles.readsSpinner,
            {
              bottom: Math.max(insets.bottom + theme.space.sm, theme.space.sm),
            },
          ]}
        >
          <ActivityIndicator size="small" />
        </View>
      ) : null}
    </View>
  );
};

export default PatientHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: theme.space.lg,
    backgroundColor: theme.colors.bg,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.space.md,
    marginTop: theme.space.sm,
  },

  username: {
    fontWeight: "700",
    color: theme.colors.text,
  },

  errorBanner: {
    backgroundColor: theme.colors.dangerBg,
    padding: theme.space.sm,
    borderRadius: theme.radius.sm,
    marginBottom: theme.space.sm,
  },
  errorText: {
    ...theme.type.subtext,
    color: theme.colors.dangerText,
  },

  segmentWrap: {
    flexDirection: "row",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: "hidden",
    marginBottom: theme.space.md,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: theme.space.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  segmentText: {
    fontWeight: "700",
    color: theme.colors.text,
  },
  segmentTextActive: {
    color: theme.colors.primaryText,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.space.xs,
  },
  sectionTitle: {
    ...theme.type.h2,
  },
  sectionErrorText: {
    ...theme.type.subtext,
    color: theme.colors.dangerText,
    marginBottom: theme.space.xs,
  },

  listContent: {
    paddingBottom: theme.space.sm,
  },
  careTeamListContent: {
    paddingBottom: theme.space.sm,
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: theme.space.md,
  },
  loadingText: {
    ...theme.type.subtext,
    marginTop: theme.space.xs,
  },

  emptyInfo: {
    marginTop: theme.space.sm,
    padding: 16,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.infoBg,
  },
  emptyInfoTitle: {
    ...theme.type.h3,
    color: theme.colors.infoText,
    marginBottom: theme.space.xs,
  },
  emptyInfoBody: {
    color: "#4B5563",
  },

  readsSpinner: {
    position: "absolute",
    right: theme.space.sm,
    backgroundColor: theme.colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: theme.space.xs,
  },

  careTeamSection: {
    marginTop: theme.space.md,
    marginBottom: theme.space.xs,
  },
  careTeamSectionTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: theme.colors.text,
  },
  careTeamSectionSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.subtext,
  },

  providerCard: {
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    marginBottom: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  advocateCard: {
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    marginBottom: theme.space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    ...theme.shadow.card,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    marginBottom: theme.space.sm,
  },

  cardName: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.colors.text,
  },

  cardHint: {
    marginTop: 2,
    fontSize: 12,
    color: theme.colors.subtext,
  },

  supportsText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.subtext,
  },

  badge: {
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.pill,
  },
  providerBadge: {
    backgroundColor: theme.colors.providerBg,
    color: theme.colors.providerText,
  },
  advocateBadge: {
    backgroundColor: theme.colors.advocateBg,
    color: theme.colors.advocateText,
  },

  actionsRow: {
    flexDirection: "row",
    gap: theme.space.xs,
    flexWrap: "wrap",
    marginTop: theme.space.xs,
  },
  primaryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  primaryBtnText: {
    fontWeight: "800",
    color: theme.colors.primaryText,
  },
  secondaryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.infoText,
  },
  secondaryBtnDisabled: {
    backgroundColor: theme.colors.border,
  },
  secondaryBtnText: {
    fontWeight: "800",
    color: theme.colors.primaryText,
  },
  secondaryBtnTextDisabled: {
    color: theme.colors.muted,
  },
});
