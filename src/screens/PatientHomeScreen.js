import React, { useEffect, useState, useCallback, useMemo } from "react";
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
import { useCurrentUser } from "../context/CurrentUserContext";
import {
  ensureDirectConversation,
  ensureCareTeamConversation,
} from "../utils/conversations";

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
        isGroup
        createdBy
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
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [conversations, setConversations] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  const [careTeamLoading, setCareTeamLoading] = useState(false);
  const [careTeamError, setCareTeamError] = useState(null);
  const [careTeams, setCareTeams] = useState([]);

  const [loadingConvos, setLoadingConvos] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const roleLabelMap = useMemo(
    () => ({
      PATIENT: "Patient",
      PROVIDER: "Provider",
      ADVOCATE: "Advocate",
      ADMIN: "Admin",
    }),
    [],
  );

  const username = currentUser?.displayName || "Patient";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Patient";

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

        setConversations((prev) => (reset ? newItems : [...prev, ...newItems]));
        setNextToken(result?.nextToken || null);
      } catch (err) {
        console.log("[PATIENT_HOME] Error fetching conversations:", err);
        setError("Unable to load conversations.");
      } finally {
        setLoadingConvos(false);
        setRefreshing(false);
      }
    },
    [currentUser?.id, nextToken],
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

  useEffect(() => {
    if (!currentUser?.id) return;

    fetchConversations({ reset: true });
    fetchCareTeam();
  }, [currentUser?.id, fetchConversations, fetchCareTeam]);

  const onRefresh = useCallback(() => {
    if (!currentUser?.id) return;

    setRefreshing(true);
    fetchConversations({ reset: true });
    fetchCareTeam();
  }, [currentUser?.id, fetchConversations, fetchCareTeam]);

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

  const handleOpenDirectChat = useCallback(
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
          return [conversation, ...prev];
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
        console.log("[PATIENT_HOME] handleOpenDirectChat error:", err);
        Alert.alert(
          "Unable to open chat",
          "Something went wrong while opening the conversation.",
        );
      }
    },
    [currentUser?.id, currentUser?.displayName, navigation],
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
          return [conversation, ...prev];
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
    [currentUser?.id, currentUser?.displayName, navigation],
  );

  const hasConversations = conversations.length > 0;
  const showGlobalLoader = loadingCurrentUser && !hasConversations;

  const hasAnyCareTeams = careTeams.length > 0;

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
          <Text style={styles.username}>{username}</Text>
        </View>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>{roleLabel}</Text>
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

      {hasAnyCareTeams ? (
        <View style={styles.careTeamContainer}>
          {careTeams.map((team) => {
            const providerName =
              team.providerUser?.displayName ||
              team.providerUser?.email ||
              "Provider";

            const advocateIds = (team.advocates || [])
              .map((a) => a?.id)
              .filter(Boolean);

            const canMessageTeam = !!team.providerId && advocateIds.length > 0;

            return (
              <View key={team.providerId} style={styles.teamGroup}>
                <View style={styles.careCard}>
                  <View style={styles.careCardHeader}>
                    <Text style={styles.careName}>{providerName}</Text>
                    <Text style={[styles.careRoleBadge, styles.providerBadge]}>
                      Provider
                    </Text>
                  </View>

                  <Text style={styles.careSubtitle}>
                    Your care team for this provider.
                  </Text>

                  <View style={styles.teamButtonsRow}>
                    <TouchableOpacity
                      style={styles.careButton}
                      onPress={() =>
                        handleOpenDirectChat(
                          team.providerUser || {
                            id: team.providerId,
                            displayName: providerName,
                          },
                        )
                      }
                    >
                      <Text style={styles.careButtonText}>
                        Message Provider
                      </Text>
                    </TouchableOpacity>

                    {canMessageTeam && (
                      <TouchableOpacity
                        style={styles.careTeamButton}
                        onPress={() =>
                          handleOpenCareTeamGroupChat({
                            providerId: team.providerId,
                            providerName,
                            advocateIds,
                          })
                        }
                      >
                        <Text style={styles.careTeamButtonText}>
                          Care Team Chat
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {!canMessageTeam && (
                    <Text style={styles.teamHintText}>
                      Add an advocate to enable a care team chat for this
                      provider.
                    </Text>
                  )}
                </View>

                {(team.advocates || []).length > 0 ? (
                  <View style={styles.careSubsection}>
                    <Text style={styles.careSubsectionTitle}>
                      Advocates (for {providerName})
                    </Text>

                    {(team.advocates || []).map((adv) => (
                      <View key={adv.id} style={styles.careCard}>
                        <View style={styles.careCardHeader}>
                          <Text style={styles.careName}>
                            {adv.displayName || adv.email || "Advocate"}
                          </Text>
                          <Text
                            style={[styles.careRoleBadge, styles.advocateBadge]}
                          >
                            Advocate
                          </Text>
                        </View>

                        <Text style={styles.careSubtitle}>
                          Supports you in communicating with your providers.
                        </Text>

                        <TouchableOpacity
                          style={styles.careButton}
                          onPress={() => handleOpenDirectChat(adv)}
                        >
                          <Text style={styles.careButtonText}>
                            Message Advocate
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : !careTeamLoading ? (
        <View style={styles.emptyCareTeam}>
          <Text style={styles.emptyCareTitle}>No care team yet</Text>
          <Text style={styles.emptyCareBody}>
            Once a provider assigns themselves or an advocate, they’ll appear
            here.
          </Text>
        </View>
      ) : null}

      <View style={styles.sectionDivider} />

      {showGlobalLoader ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading your home…</Text>
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
                When someone starts a conversation with you, it will appear
                here.
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
  teamGroup: {
    marginBottom: 6,
  },
  teamButtonsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 8,
  },
  teamHintText: {
    marginTop: 8,
    fontSize: 12,
    color: "#475569",
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
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  careButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  careTeamButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1D4ED8",
  },
  careTeamButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  careSubsection: {
    marginTop: 0,
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
