import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
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

const PAGE_SIZE = 20;

const PatientHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [userSub, setUserSub] = useState(null);
  const [username, setUsername] = useState(null);

  const [conversations, setConversations] = useState([]);
  const [nextToken, setNextToken] = useState(null);

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

  useEffect(() => {
    if (userSub) {
      fetchConversations({ reset: true });
    }
  }, [userSub, fetchConversations]);

  const onRefresh = useCallback(() => {
    if (!userSub) return;
    setRefreshing(true);
    fetchConversations({ reset: true });
  }, [userSub, fetchConversations]);

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


  const renderConversationItem = ({ item }) => {
    return (
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
              renderItem={renderConversationItem}
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    color: "#111827",
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
    marginTop: 24,
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
