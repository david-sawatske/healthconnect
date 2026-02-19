import React, { useEffect, useState, useCallback, useRef } from "react";
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

const PatientHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [activeTab, setActiveTab] = useState("conversations");

  const [conversations, setConversations] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  const [careTeamLoading, setCareTeamLoading] = useState(false);
  const [careTeamError, setCareTeamError] = useState(null);
  const [careTeams, setCareTeams] = useState([]);

  const [loadingConvos, setLoadingConvos] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [lastMessageByConvo, setLastMessageByConvo] = useState({});
  const [loadingLastByConvo, setLoadingLastByConvo] = useState({});

  const [lastReadAtByConvoId, setLastReadAtByConvoId] = useState({});
  const [loadingReads, setLoadingReads] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState(() => new Set());

  const lastMessageRef = useRef({});
  const loadingLastRef = useRef({});
  const lastReadAtRef = useRef({});

  useEffect(() => {
    lastMessageRef.current = lastMessageByConvo;
  }, [lastMessageByConvo]);

  useEffect(() => {
    loadingLastRef.current = loadingLastByConvo;
  }, [loadingLastByConvo]);

  useEffect(() => {
    lastReadAtRef.current = lastReadAtByConvoId;
  }, [lastReadAtByConvoId]);

  const username = currentUser?.displayName || "Patient";

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

      const { data } = await client.graphql({
        query: ADVOCATE_ASSIGNMENTS_FOR_PATIENT,
        variables: { patientId: currentUser.id },
        authMode: "userPool",
      });

      const assignments = data?.advocateAssignmentsByPatient?.items || [];

      if (!assignments.length) {
        setCareTeams([]);
        return;
      }

      const providerToAdvocates = new Map();

      assignments.forEach((a) => {
        if (!a?.providerId) return;
        if (!providerToAdvocates.has(a.providerId)) {
          providerToAdvocates.set(a.providerId, new Set());
        }
        if (a.advocateId) {
          providerToAdvocates.get(a.providerId).add(a.advocateId);
        }
      });

      const providerIds = Array.from(providerToAdvocates.keys()).filter(
        Boolean,
      );
      const advocateIds = Array.from(
        new Set(assignments.map((a) => a.advocateId).filter(Boolean)),
      );

      const fetchUser = async (id) => {
        try {
          const { data } = await client.graphql({
            query: GET_USER,
            variables: { id },
            authMode: "userPool",
          });
          return data?.getUser || null;
        } catch (err) {
          console.log("[PATIENT_HOME] Error fetching user:", err);
          return null;
        }
      };

      const allIds = Array.from(new Set([...providerIds, ...advocateIds]));
      const results = await Promise.all(allIds.map(fetchUser));

      const usersById = {};
      results.forEach((u) => {
        if (u?.id) usersById[u.id] = u;
      });

      const teams = providerIds
        .map((providerId) => {
          const providerUser = usersById[providerId] || null;
          const advocatesForProvider = Array.from(
            providerToAdvocates.get(providerId) || [],
          )
            .map((advId) => usersById[advId])
            .filter(Boolean);

          return {
            providerId,
            providerUser,
            advocates: advocatesForProvider,
          };
        })
        .sort((a, b) => {
          const an = (a.providerUser?.displayName || "").toLowerCase();
          const bn = (b.providerUser?.displayName || "").toLowerCase();
          return an.localeCompare(bn);
        });

      setCareTeams(teams);
    } catch (err) {
      console.log("[PATIENT_HOME] Error fetching care team:", err);
      setCareTeamError("Unable to load your care team.");
      setCareTeams([]);
    } finally {
      setCareTeamLoading(false);
    }
  }, [currentUser?.id]);

  const toggleProviderExpanded = useCallback((providerId) => {
    if (!providerId) return;
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  }, []);

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
  }, [conversations, fetchLastMessage]);

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
      title: conversation.title || "Conversation",
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
            conversation.title ||
            targetUser.displayName ||
            "Care Team Conversation",
        });
      } catch (err) {
        console.log("[PATIENT_HOME] handleOpenCareTeamChat error:", err);
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
          title: `Care Team: ${currentUser.displayName || "Patient"} • ${
            providerName || "Provider"
          }`,
        });

        setConversations((prev) => {
          if (prev.some((c) => c.id === conversation.id)) return prev;
          return sortByLastActivity([conversation, ...prev]);
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || "Care Team Chat",
        });
      } catch (err) {
        console.log("[PATIENT_HOME] handleOpenCareTeamGroupChat error:", err);
        Alert.alert(
          "Unable to open care team chat",
          "Something went wrong while opening the care team conversation.",
        );
      }
    },
    [currentUser?.id, currentUser?.displayName, navigation, sortByLastActivity],
  );

  const hasConversations = conversations.length > 0;
  const showGlobalLoader = loadingCurrentUser && !hasConversations;

  const hasAnyCareTeams = careTeams.length > 0;

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

  const renderCareTeam = () => {
    const renderTeamItem = ({ item: team }) => {
      const providerName =
        team.providerUser?.displayName ||
        team.providerUser?.email ||
        "Provider";

      const advocateIds = (team.advocates || [])
        .map((a) => a.id)
        .filter(Boolean);
      const canMessageTeam = !!team.providerId && advocateIds.length > 0;

      const isExpanded = expandedProviders.has(team.providerId);
      const advocateCount = team.advocates?.length || 0;

      return (
        <View style={styles.providerCard}>
          <View style={styles.providerTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.providerName} numberOfLines={1}>
                {providerName}
              </Text>
            </View>

            <Text style={[styles.badge, styles.providerBadge]}>Provider</Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() =>
                handleOpenCareTeamChat(
                  team.providerUser || {
                    id: team.providerId,
                    displayName: providerName,
                  },
                )
              }
            >
              <Text style={styles.primaryBtnText}>Message</Text>
            </TouchableOpacity>

            {canMessageTeam ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() =>
                  handleOpenCareTeamGroupChat({
                    providerId: team.providerId,
                    providerName,
                    advocateIds,
                  })
                }
              >
                <Text style={styles.secondaryBtnText}>Care Team Chat</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.disabledPill}>
                <Text style={styles.disabledPillText}>
                  Add advocate to enable group
                </Text>
              </View>
            )}
          </View>

          {advocateCount > 0 ? (
            <TouchableOpacity
              style={styles.advocatesHeaderRow}
              onPress={() => toggleProviderExpanded(team.providerId)}
              activeOpacity={0.7}
            >
              <Text style={styles.advocatesHeaderRowText}>
                Advocates ({advocateCount})
              </Text>

              <Text style={styles.chevronText}>{isExpanded ? "▴" : "▾"}</Text>
            </TouchableOpacity>
          ) : null}

          {isExpanded && advocateCount > 0 ? (
            <View style={styles.advocatesWrap}>
              {team.advocates.map((adv) => (
                <TouchableOpacity
                  key={adv.id}
                  style={styles.advocateRow}
                  onPress={() => handleOpenCareTeamChat(adv)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.advocateName} numberOfLines={1}>
                      {adv.displayName || adv.email || "Advocate"}
                    </Text>
                    <Text style={styles.advocateHint} numberOfLines={1}>
                      Tap to message
                    </Text>
                  </View>

                  <Text style={[styles.badge, styles.advocateBadge]}>
                    Advocate
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      );
    };

    return (
      <View style={{ paddingBottom: 0 }}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>My Care Team</Text>
          {careTeamLoading ? (
            <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
          ) : null}
        </View>

        {careTeamError ? (
          <Text style={styles.sectionErrorText}>{careTeamError}</Text>
        ) : null}

        {hasAnyCareTeams ? (
          <FlatList
            data={careTeams}
            keyExtractor={(t) => t.providerId}
            renderItem={renderTeamItem}
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        ) : !careTeamLoading ? (
          <View style={styles.emptyInfo}>
            <Text style={styles.emptyInfoTitle}>No care team yet</Text>
            <Text style={styles.emptyInfoBody}>
              Once a provider assigns themselves or an advocate, they’ll appear
              here.
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  if (showGlobalLoader) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
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
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {Header}
        {renderCareTeam()}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
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

          return (
            <ConversationListItem
              title={item.title || "Conversation"}
              preview={preview}
              timestamp={ts}
              unread={isUnread}
              onPress={() => handleOpenConversation(item)}
              testID={`conversation-${item.id}`}
            />
          );
        }}
        contentContainerStyle={[styles.listContent, { paddingBottom: 16 }]}
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
      />
      {loadingReads ? (
        <View style={styles.readsSpinner}>
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
    marginTop: 12,
  },

  username: {
    fontSize: theme.type.h1,
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
    color: theme.colors.dangerText,
    fontSize: theme.type.small,
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
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.text,
  },
  segmentTextActive: {
    color: theme.colors.primaryText,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: theme.type.h2,
    fontWeight: "800",
    color: theme.colors.text,
  },
  sectionErrorText: {
    fontSize: theme.type.small,
    color: theme.colors.dangerText,
    marginBottom: 6,
  },

  listContent: {
    paddingBottom: 16,
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 20,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: theme.colors.subtext,
  },

  emptyInfo: {
    marginTop: 12,
    padding: 16,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.infoBg,
  },
  emptyInfoTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.infoText,
    marginBottom: 4,
  },
  emptyInfoBody: {
    fontSize: 13,
    color: "#4B5563",
  },

  readsSpinner: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: theme.colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
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

  providerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    marginBottom: theme.space.sm,
  },

  providerName: {
    fontSize: 16,
    fontWeight: "800",
    color: theme.colors.text,
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
    gap: 10,
    flexWrap: "wrap",
    marginTop: 6,
  },
  primaryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.colors.primaryText,
  },
  secondaryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: "#1D4ED8",
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.colors.primaryText,
  },

  disabledPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.border,
  },
  disabledPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.muted,
  },

  advocatesWrap: {
    marginTop: theme.space.md,
    paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },

  advocateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: theme.radius.md,
    backgroundColor: "#F8FAFC",
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },

  advocateName: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.text,
  },

  advocateHint: {
    marginTop: 2,
    fontSize: 12,
    color: theme.colors.subtext,
  },

  advocatesHeaderRow: {
    marginTop: theme.space.sm,
    paddingTop: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  advocatesHeaderRowText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.colors.text,
  },

  chevronText: {
    fontSize: 16,
    fontWeight: "900",
    color: theme.colors.subtext,
  },
});
