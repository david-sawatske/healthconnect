import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  RefreshControl,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { generateClient } from "aws-amplify/api";
import { getCurrentUser } from "aws-amplify/auth";

const client = generateClient();

const log = (...args) => console.log("[ADVOCATE_HOME]", ...args);

const LIST_MY_ADVOCATE_ASSIGNMENTS = /* GraphQL */ `
  query ListMyAdvocateAssignments(
    $advocateId: ID!
    $limit: Int
    $nextToken: String
  ) {
    listAdvocateAssignments(
      filter: {
        advocateId: { eq: $advocateId }
        active: { eq: true }
      }
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        active
        createdAt
      }
      nextToken
    }
  }
`;

const GET_USER = /* GraphQL */ `
  query GetUser($id: ID!) {
    getUser(id: $id) {
      id
      displayName
      role
    }
  }
`;

const batchFetchUsers = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  const results = {};

  for (const id of unique) {
    try {
      const { data } = await client.graphql({
        query: GET_USER,
        variables: { id },
      });
      if (data?.getUser) {
        results[id] = data.getUser;
      }
    } catch (err) {
      console.error("[ADVOCATE_HOME] Failed to fetch user:", id, err);
    }
  }

  return results;
};

const AdvocateHomeScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userSub, setUserSub] = useState(null);

  const [assignments, setAssignments] = useState([]);
  const [nextToken, setNextToken] = useState(null);

  const [error, setError] = useState(null);
  const [patients, setPatients] = useState([]);

  const fetchAssignments = useCallback(
    async ({ reset = false, advocateId } = {}) => {
      try {
        const id = advocateId ?? userSub;
        if (!id) return;

        const variables = {
          advocateId: id,
          limit: 50,
          nextToken: reset ? null : nextToken,
        };

        log("Fetching assignments:", variables);

        const { data } = await client.graphql({
          query: LIST_MY_ADVOCATE_ASSIGNMENTS,
          variables,
        });

        const result = data?.listAdvocateAssignments;
        const newItems = result?.items ?? [];

        const merged = reset ? newItems : [...assignments, ...newItems];
        setAssignments(merged);
        setNextToken(result?.nextToken ?? null);
        setError(null);

        await processAssignments(merged);
      } catch (err) {
        console.error("[ADVOCATE_HOME] Error fetching assignments:", err);
        setError("Unable to load your patients.");
      }
    },
    [userSub, nextToken, assignments],
  );

  const processAssignments = async (assignmentsList) => {
    try {
      const activeAssignments = assignmentsList.filter((a) => a.active !== false);
      const patientIds = activeAssignments.map((a) => a.patientId);
      const providerIds = activeAssignments.map((a) => a.providerId);
      const allIds = [...patientIds, ...providerIds];

      const userMap = await batchFetchUsers(allIds);

      const map = {}
      assignmentsList.forEach((a) => {
        const pId = a.patientId;
        if (!pId) return;

        if (!map[pId]) {
          map[pId] = {
            patientId: pId,
            patientName: userMap[pId]?.displayName ?? "Unknown Patient",
            providerId: a.providerId,
            providerName: userMap[a.providerId]?.displayName ?? "No Provider",
            createdAt: a.createdAt,
          };
        }
      });

      setPatients(Object.values(map));
    } catch (err) {
      console.error("[ADVOCATE_HOME] Error processing assignments:", err);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const user = await getCurrentUser();
        log("Advocate sub:", user?.userId);

        setUserSub(user?.userId);
        await fetchAssignments({ reset: true, advocateId: user?.userId });
      } catch (err) {
        console.error("[ADVOCATE_HOME] Error loading user:", err);
        setError("Unable to load advocate info.");
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAssignments({ reset: true })
      .catch(() => {})
      .finally(() => setRefreshing(false));
  };

  const loadMore = () => {
    if (nextToken && !loading) {
      fetchAssignments({ reset: false }).catch(() => {});
    }
  };

  const handleOpenPatient = (patient) => {
    navigation.navigate("PatientDetail", {
      patientId: patient.patientId,
      patientName: patient.patientName,
      providerId: patient.providerId,
      advocateId: userSub,
      fromRole: "ADVOCATE",
    });
  };

  const renderPatientItem = ({ item }) => (
    <TouchableOpacity
      onPress={() => handleOpenPatient(item)}
      style={styles.patientCard}
    >
      <Text style={styles.patientName}>{item.patientName}</Text>
      <Text style={styles.patientMeta}>Provider: {item.providerName}</Text>
      <Text style={styles.patientMeta}>
        Added: {new Date(item.createdAt).toLocaleString()}
      </Text>
    </TouchableOpacity>
  );

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading your patients…</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Advocate Home</Text>
        <Text style={styles.headerSubtitle}>
          Your assigned patients and their providers
        </Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>My Patients</Text>

        {patients.length === 0 ? (
          <Text style={styles.emptyText}>
            You don’t have any patients assigned yet.
          </Text>
        ) : (
          <FlatList
            data={patients}
            keyExtractor={(item) => item.patientId}
            renderItem={renderPatientItem}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
          />
        )}
      </View>
    </View>
  );
};

export default AdvocateHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
    paddingHorizontal: 16,
  },
  header: {
    marginBottom: 16,
    marginTop: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#6B7280",
  },
  errorBox: {
    backgroundColor: "#FEE2E2",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    color: "#B91C1C",
  },
  section: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
  },
  patientCard: {
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  patientName: {
    fontSize: 16,
    fontWeight: "600",
  },
  patientMeta: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 4,
  },
  loadingText: {
    marginTop: 8,
    color: "#6B7280",
  },
});
