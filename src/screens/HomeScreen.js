import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  Button,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  TouchableOpacity,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { signOut, getCurrentUser, fetchUserAttributes } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/api";

const client = generateClient();

const GetUser = `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      email
      displayName
      role
    }
  }
`;

const ListMyConversations = `
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

const inferRole = (login = "") => {
  const v = String(login).toLowerCase();
  if (v.includes("patient")) return "PATIENT";
  if (v.includes("provider")) return "PROVIDER";
  if (v.includes("advocate")) return "ADVOCATE";
  return "USER";
};

export default function HomeScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [sub, setSub] = useState("");
  const [convos, setConvos] = useState([]);
  const [nextToken, setNextToken] = useState(null);
  const [loadingConvos, setLoadingConvos] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const user = await getCurrentUser();
        const mySub = user.userId;
        setSub(mySub);

        const res = await client.graphql({
          query: GetUser,
          variables: { id: mySub },
        });
        const profile = res?.data?.getUser;

        if (profile) {
          setDisplayName(profile.displayName || profile.email || user.username);
          setRole(profile.role || "USER");
          return;
        }

        let email = "";
        try {
          const attrs = await fetchUserAttributes();
          email = attrs?.email || "";
        } catch {}
        const loginId =
          user?.signInDetails?.loginId || email || user?.username || "";
        setDisplayName(loginId);
        setRole(inferRole(loginId));
      } catch (err) {
        console.log("Home init error:", err);
        navigation.replace("Auth");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      if (sub) loadConversations();
    }, [sub, loadConversations]),
  );

  const loadConversations = useCallback(
    async (cursor = null) => {
      if (!sub) return;
      setLoadingConvos(true);
      try {
        const res = await client.graphql({
          query: ListMyConversations,
          variables: { sub, limit: 25, nextToken: cursor ?? undefined },
          authMode: "userPool",
        });
        const page = res?.data?.listConversations;
        setConvos((prev) =>
          cursor ? [...prev, ...(page?.items ?? [])] : (page?.items ?? []),
        );
        setNextToken(page?.nextToken ?? null);
      } catch (e) {
        console.log("List conversations failed:", e);
        Alert.alert("Error", "Could not fetch conversations.");
      } finally {
        setLoadingConvos(false);
      }
    },
    [sub],
  );

  useEffect(() => {
    if (sub) loadConversations();
  }, [sub]);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigation.replace("Auth");
    } catch (err) {
      console.error("Sign out error:", err);
      Alert.alert("Error", "Could not sign out. Try again.");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading your profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>
        Welcome{displayName ? `, ${displayName}` : ""}! You are signed in
        {role ? ` as ${role}` : ""}.
      </Text>

      {role === "ADVOCATE" && (
        <View style={{ marginTop: 12, alignSelf: "stretch" }}>
          <Button
            title="View Invites"
            onPress={() => navigation.navigate("InviteApproval")}
          />
        </View>
      )}

      <View style={{ marginTop: 16, alignSelf: "stretch" }}>
        <Text style={styles.sectionTitle}>Your Conversations</Text>
        {loadingConvos && convos.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={convos}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.convoRow}
                onPress={() =>
                  navigation.navigate("Chat", { conversation: item })
                }
              >
                <Text style={styles.convoTitle}>
                  {item.title || "Untitled conversation"}
                </Text>
                <Text style={styles.convoMeta}>
                  Members:{" "}
                  {Array.isArray(item.memberIds) ? item.memberIds.length : 0}
                </Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={{ opacity: 0.7 }}>No conversations yet.</Text>
            }
            onEndReached={() => nextToken && loadConversations(nextToken)}
            onEndReachedThreshold={0.6}
          />
        )}
      </View>

      <View style={{ marginTop: 24 }}>
        <Button title="Sign Out" onPress={handleSignOut} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  welcome: { fontSize: 18, textAlign: "center" },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  convoRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#ddd",
  },
  convoTitle: { fontSize: 16 },
  convoMeta: { fontSize: 12, opacity: 0.7, marginTop: 4 },
});
