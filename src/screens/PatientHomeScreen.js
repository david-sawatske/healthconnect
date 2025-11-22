import React, { useEffect, useState, useCallback } from "react";
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
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

const log = (...args) => console.log("[PATIENT_HOME]", ...args);

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

const PAGE_SIZE = 20;

const PatientHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [userSub, setUserSub] = useState(null);
  const [username, setUsername] = useState(null);

  const [conversations, setConversations] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  const [careTeamLoading, setCareTeamLoading] = useState(false);
  const [careTeamError, setCareTeamError] = useState(null);
  const [providerUser, setProviderUser] = useState(null);
  const [advocates, setAdvocates] = useState([]);

  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadUser = async () => {
      try {
        setLoadingUser(true);
        const currUser = await getCurrentUser();
        log("Current user:", currUser);
        setUserSub(currUser.userId);
        setUsername(
          currUser?.username || currUser?.signInDetails?.loginId || "Patient",
        );
      } catch (err) {
        log("Error loading current user", err);
        setError("Unable to load current user.");
      } finally {
        setLoadingUser(false);
      }
    };

    loadUser();
  }, []);

  const fetchConversations = useCallback(
    async ({ reset = false } = {}) => {
      if (!userSub) return;
      try {
        if (reset) {
          setLoadingConvos(true);
          setError(null);
        }
        const variables = {
          sub: userSub,
          limit: PAGE_SIZE,
          nextToken: reset ? null : nextToken,
        };

        log("Fetching conversations with variables:", variables);

        const { data } = await client.graphql({
          query: LIST_MY_CONVERSATIONS,
          variables,
        });

        const result = data?.listConversations;
        const newItems = result?.items || [];

        setConversations((prev) => (reset ? newItems : [...prev, ...newItems]));
        setNextToken(result?.nextToken || null);
      } catch (err) {
        log("Error fetching conversations", err);
        setError("Unable to load conversations.");
      } finally {
        setLoadingConvos(false);
        setRefreshing(false);
      }
    },
    [userSub, nextToken],
  );

  const fetchCareTeam = useCallback(
    async ({ status = "ACTIVE" } = {}) => {
      if (!userSub) return;

      try {
        setCareTeamLoading(true);
        setCareTeamError(null);

        const { data } = await client.graphql({
          query: ADVOCATE_ASSIGNMENTS_FOR_PATIENT,
          variables: {
            patientId: userSub,
            status,
          },
        });

        const assignments = data?.advocateAssignmentsByPatient?.items || [];

        log("Care team assignments:", assignments);

        if (!assignments.length) {
          setProviderUser(null);
          setAdvocates([]);
          return;
        }

        const providerIds = new Set(
          assignments.map((a) => a.providerId).filter(Boolean),
        );
        const advocateIds = Array.from(
          new Set(assignments.map((a) => a.advocateId).filter(Boolean)),
        );

        const fetchUserById = async (id) => {
          if (!id) return null;
          try {
            const { data: userData } = await client.graphql({
              query: GET_USER,
              variables: { id },
            });
            return userData?.getUser || null;
          } catch (err) {
            log("Error fetching user", id, err);
            return null;
          }
        };

        let primaryProvider = null;
        if (providerIds.size > 0) {
          const firstProviderId = Array.from(providerIds)[0];
          primaryProvider = await fetchUserById(firstProviderId);
        }

        const advocateUsers = (
          await Promise.all(advocateIds.map(fetchUserById))
        ).filter(Boolean);

        setProviderUser(primaryProvider);
        setAdvocates(advocateUsers);
      } catch (err) {
        log("Error fetching care team", err);
        setCareTeamError("Unable to load your care team.");
      } finally {
        setCareTeamLoading(false);
      }
    },
    [userSub],
  );

  useEffect(() => {
    if (userSub) {
      fetchConversations({ reset: true });
      fetchCareTeam({ status: "ACTIVE" });
    }
  }, [userSub, fetchConversations, fetchCareTeam]);

  const onRefresh = useCallback(() => {
    if (!userSub) return;
    setRefreshing(true);
    fetchConversations({ reset: true });
    fetchCareTeam({ status: "ACTIVE" });
  }, [userSub, fetchConversations, fetchCareTeam]);

  const loadMore = () => {
    if (!nextToken || loadingConvos) return;
    fetchConversations({ reset: false });
  };

  const openConversation = (conversation, fallbackTitle) => {
    if (!conversation) {
      Alert.alert(
        "No conversation yet",
        "We couldn't find a chat for this care team member yet. Ask them to start a conversation from their side.",
      );
      return;
    }

    navigation.navigate("Chat", {
      conversationId: conversation.id,
      conversation,
      title: conversation.title || fallbackTitle || "Conversation",
    });
  };

  const handleOpenConversation = (conversation) => {
    openConversation(conversation, conversation.title || "Conversation");
  };

  const handleOpenCareTeamChat = (targetUser) => {
    if (!targetUser || !userSub) return;

    const targetId = targetUser.id;
    const existingConversation =
      conversations.find((c) => {
        const members = c.memberIds || [];
        return (
          Array.isArray(members) &&
          members.includes(userSub) &&
          members.includes(targetId)
        );
      }) || null;

    openConversation(
      existingConversation,
      targetUser.displayName || "Care Team Chat",
    );
  };

  const hasConversations = conversations && conversations.length > 0;
  const showGlobalLoader = loadingUser && !hasConversations;
  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 8 },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.username}>{username || "Patient"}</Text>
        </View>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>Patient</Text>
        </View>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>My Care Team</Text>
        {careTeamLoading && (
          <ActivityIndicator size="small" style={{ marginLeft: 8 }} />
        )}
      </View>

      {careTeamError && (
        <Text style={styles.sectionErrorText}>{careTeamError}</Text>
      )}

      {providerUser || advocates.length > 0 ? (
        <View style={styles.careTeamContainer}>
          {providerUser && (
            <View style={styles.careCard}>
              <View style={styles.careCardHeader}>
                <Text style={styles.careName}>
                  {providerUser.displayName || "Provider"}
                </Text>
                <Text style={[styles.careRoleBadge, styles.providerBadge]}>
                  Provider
                </Text>
              </View>
              <Text style={styles.careSubtitle}>
                Primary provider for your care.
              </Text>
              <TouchableOpacity
                style={styles.careButton}
                onPress={() => handleOpenCareTeamChat(providerUser)}
              >
                <Text style={styles.careButtonText}>Open Chat</Text>
              </TouchableOpacity>
            </View>
          )}

          {advocates.length > 0 && (
            <View style={styles.careSubsection}>
              <Text style={styles.careSubsectionTitle}>Advocates</Text>
              {advocates.map((adv) => (
                <View key={adv.id} style={styles.careCard}>
                  <View style={styles.careCardHeader}>
                    <Text style={styles.careName}>
                      {adv.displayName || "Advocate"}
                    </Text>
                    <Text style={[styles.careRoleBadge, styles.advocateBadge]}>
                      Advocate
                    </Text>
                  </View>
                  <Text style={styles.careSubtitle}>
                    Supports you in communicating with your providers.
                  </Text>
                  <TouchableOpacity
                    style={styles.careButton}
                    onPress={() => handleOpenCareTeamChat(adv)}
                  >
                    <Text style={styles.careButtonText}>Open Chat</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : !careTeamLoading ? (
        <View style={styles.emptyCareTeam}>
          <Text style={styles.emptyCareTitle}>No care team yet</Text>
          <Text style={styles.emptyCareBody}>
            Once a provider assigns themselves or an advocate to your care,
            they&apos;ll show up here.
          </Text>
        </View>
      ) : null}

      <View style={styles.sectionDivider} />

      {showGlobalLoader ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading your home...</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>
            My Conversations
            {hasConversations ? ` (${conversations.length})` : ""}
          </Text>

          {hasConversations ? (
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.conversationCard}
                  onPress={() => handleOpenConversation(item)}
                >
                  <Text style={styles.conversationTitle}>
                    {item.title || "Conversation"}
                  </Text>
                  <Text style={styles.conversationMeta}>
                    {item.createdAt
                      ? new Date(item.createdAt).toLocaleString()
                      : "No timestamp"}
                  </Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              onEndReached={loadMore}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                loadingConvos && !refreshing ? (
                  <ActivityIndicator style={{ marginVertical: 12 }} />
                ) : null
              }
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyBody}>
                Once a provider or advocate starts a chat with you, it will show
                up here. Pull down to refresh if you’re expecting a new
                conversation.
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
};

export default PatientHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: "#F7F8FA",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  greeting: {
    fontSize: 16,
    color: "#666",
  },
  username: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
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
  sectionDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 12,
  },
  sectionErrorText: {
    fontSize: 12,
    color: "#B91C1C",
    marginBottom: 4,
  },

  careTeamContainer: {
    marginBottom: 8,
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
  },
  careRoleBadge: {
    fontSize: 11,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
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
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  careButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  careSubsection: {
    marginTop: 4,
  },
  careSubsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 4,
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

  listContent: {
    paddingBottom: 16,
  },
  conversationCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
  },
  conversationTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  conversationMeta: {
    fontSize: 12,
    color: "#6B7280",
  },

  errorBanner: {
    backgroundColor: "#FEE2E2",
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 12,
  },

  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: "#6B7280",
  },

  emptyState: {
    marginTop: 12,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1D4ED8",
    marginBottom: 4,
  },
  emptyBody: {
    fontSize: 13,
    color: "#4B5563",
  },
});
