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
import { useCurrentUser } from "../context/CurrentUserContext";

const client = generateClient();

const log = (...args) => console.log("[PROVIDER_HOME]", ...args);

const LIST_PROVIDER_PATIENTS = /* GraphQL */ `
  query ListProviderPatients($providerId: ID!) {
    providerPatientsByProvider(providerId: $providerId) {
      items {
        id
        patient {
          id
          displayName
          email
          role
        }
      }
    }
  }
`;

const ProviderHomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const roleLabelMap = {
    PATIENT: "Patient",
    PROVIDER: "Provider",
    ADVOCATE: "Advocate",
    ADMIN: "Admin",
  };

  const displayName = currentUser?.displayName || "Provider";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Provider";

  const loadPatients = useCallback(async () => {
    if (!currentUser?.id) return;

    setLoading(true);
    try {
      const res = await client.graphql({
        query: LIST_PROVIDER_PATIENTS,
        variables: { providerId: currentUser.id },
        authMode: "userPool",
      });

      const links = res?.data?.providerPatientsByProvider?.items || [];
      const items = links.map((link) => link.patient).filter(Boolean);

      setPatients(items);
    } catch (err) {
      log("loadPatients error:", err);
      Alert.alert("Error", "Failed to load patients.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) {
      loadPatients();
    }
  }, [currentUser?.id, loadPatients]);

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

  const showGlobalLoader = (loading || loadingCurrentUser) && !patients.length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>Hi,</Text>
          <Text style={styles.headerTitle}>
            {loadingCurrentUser ? "Loading..." : displayName}
          </Text>
          <Text style={styles.headerSub}>My Patients</Text>
        </View>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>{roleLabel}</Text>
        </View>
      </View>

      {showGlobalLoader ? (
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerGreeting: {
    fontSize: 14,
    color: "#6B7280",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  headerSub: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 2,
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
