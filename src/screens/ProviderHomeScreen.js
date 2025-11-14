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

const ProviderHomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [provider, setProvider] = useState(null);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!mounted) return;

        setProvider({ id: user?.userId || user?.username });
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

  const handlePressPatient = (patient) => {
    navigation.navigate("PatientDetail", {
      patientId: patient.id,
      patientName: patient.displayName || "Patient",
    });
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
        {provider ? (
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
