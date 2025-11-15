import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

const log = (...args) => console.log("[PROVIDER_HOME]", ...args);

async function safeGql({ query, variables = {}, label }) {
  try {
    const res = await client.graphql({
      query,
      variables,
      authMode: "userPool",
    });
    log(label || "GQL", "OK", JSON.stringify(res?.data)?.slice(0, 300));
    return res;
  } catch (err) {
    log(label || "GQL", "ERR", err);
    throw err;
  }
}

const LIST_PATIENT_USERS = /* GraphQL */ `
  query ListPatientUsers {
    listUsers(filter: { role: { eq: PATIENT } }) {
      items {
        id
        displayName
        email
        role
      }
    }
  }
`;

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

const CREATE_CONVERSATION = /* GraphQL */ `
  mutation CreateConversation($input: CreateConversationInput!) {
    createConversation(input: $input) {
      id
      title
      memberIds
      createdAt
    }
  }
`;

async function getOrCreateProviderPatientConversation({
  providerSub,
  patientId,
}) {
  const listRes = await client.graphql({
    query: LIST_MY_CONVERSATIONS,
    variables: { sub: providerSub, limit: 50 },
    authMode: "userPool",
  });

  const items = listRes?.data?.listConversations?.items || [];

  const existing = items.find(
    (conv) =>
      Array.isArray(conv.memberIds) && conv.memberIds.includes(patientId),
  );

  if (existing) {
    return existing;
  }

  const createRes = await client.graphql({
    query: CREATE_CONVERSATION,
    variables: {
      input: {
        title: "Patient ↔ Provider Chat",
        memberIds: [providerSub, patientId],
      },
    },
    authMode: "userPool",
  });

  return createRes?.data?.createConversation;
}

const ProviderHomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [providerSub, setProviderSub] = useState(null);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!mounted) return;

        const sub = user?.userId || user?.username;
        setProviderSub(sub);
      } catch (err) {
        log("getCurrentUser ERR", err);
        Alert.alert("Error", "Unable to load current provider user.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const loadPatients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await safeGql({
        query: LIST_PATIENT_USERS,
        variables: {},
        label: "ListPatientUsers",
      });
      const items = res?.data?.listUsers?.items || [];
      setPatients(items);
    } catch (err) {
      Alert.alert("Error", "Failed to load patients.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPatients();
    } finally {
      setRefreshing(false);
    }
  }, [loadPatients]);

  const handlePressPatient = async (patient) => {
    if (!providerSub) {
      Alert.alert("Error", "Provider info not loaded yet.");
      return;
    }

    try {
      const conversation = await getOrCreateProviderPatientConversation({
        providerSub,
        patientId: patient.id,
      });

      if (!conversation) {
        Alert.alert("Error", "Unable to open conversation.");
        return;
      }

      navigation.navigate("Chat", { conversation });
    } catch (err) {
      log("handlePressPatient ERR", err);
      Alert.alert("Error", "Unable to open conversation.");
    }
  };

  const renderPatientItem = ({ item }) => (
    <TouchableOpacity
      style={styles.patientRow}
      onPress={() => handlePressPatient(item)}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.patientName}>
          {item.displayName || "Unnamed Patient"}
        </Text>
        {item.email ? (
          <Text style={styles.patientSub}>{item.email}</Text>
        ) : null}
      </View>
      <Text style={styles.patientChevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Patients</Text>
        {providerSub ? (
          <Text style={styles.headerSub}>Provider dashboard</Text>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading patients…</Text>
        </View>
      ) : patients.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No patients found</Text>
          <Text style={styles.emptyText}>
            Add some seeded patients or adjust the query if you’re scoping by
            provider–patient relationships.
          </Text>
        </View>
      ) : (
        <FlatList
          data={patients}
          keyExtractor={(item) => item.id}
          renderItem={renderPatientItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F5F7",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  headerSub: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  patientRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "600",
  },
  patientSub: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
  },
  patientChevron: {
    fontSize: 24,
    color: "#9CA3AF",
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: "#6B7280",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
  },
});

export default ProviderHomeScreen;
