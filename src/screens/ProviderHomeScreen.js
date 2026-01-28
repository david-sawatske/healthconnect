import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { generateClient } from "aws-amplify/api";
import { useCurrentUser } from "../context/CurrentUserContext";
import PatientListItem from "../components/PatientListItem";

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
  const navigation = useNavigation();
  const { currentUser, loadingCurrentUser } = useCurrentUser();

  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const roleLabelMap = useMemo(
    () => ({
      PATIENT: "Patient",
      PROVIDER: "Provider",
      ADVOCATE: "Advocate",
      ADMIN: "Admin",
    }),
    [],
  );

  const displayName = currentUser?.displayName || "Provider";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Provider";

  const loadPatients = useCallback(async () => {
    if (!currentUser?.id) return;

    setLoadingPatients(true);
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
      setPatients([]);
    } finally {
      setLoadingPatients(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser?.id) loadPatients();
  }, [currentUser?.id, loadPatients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPatients();
    } finally {
      setRefreshing(false);
    }
  }, [loadPatients]);

  const handlePressPatient = useCallback(
    (patient) => {
      if (!currentUser?.id) {
        Alert.alert("Error", "Provider not loaded yet.");
        return;
      }

      navigation.navigate("PatientDetail", {
        patientId: patient.id,
        patientName: patient.displayName || "Patient",
        providerId: currentUser.id,
        fromRole: "PROVIDER",
      });
    },
    [currentUser?.id, navigation],
  );

  const renderPatientItem = useCallback(
    ({ item }) => {
      const subtitle = item.email || "View patient details";

      return (
        <PatientListItem
          name={item.displayName || "Unnamed Patient"}
          subtitle={subtitle}
          onPress={() => handlePressPatient(item)}
          testID={`patient-${item.id}`}
        />
      );
    },
    [handlePressPatient],
  );

  const showGlobalLoader =
    (loadingPatients || loadingCurrentUser) && patients.length === 0;

  return (
    <View style={[styles.container]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {loadingCurrentUser ? "Loading..." : displayName}
          </Text>
          <Text style={styles.sectionTitle}>
            Patients{patients?.length ? ` • ${patients.length}` : ""}
          </Text>
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
          <Text style={styles.emptyTitle}>No patients yet</Text>
          <Text style={styles.emptyText}>
            When patients are assigned to you, they’ll show up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={patients}
          keyExtractor={(item) => item.id}
          renderItem={renderPatientItem}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
};

export default ProviderHomeScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F5F7",
  },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },

  sectionTitle: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 18,
    fontWeight: "600",
    color: "#6B7280",
    letterSpacing: 0.25,
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
    paddingBottom: 16,
  },

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
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
    marginBottom: 6,
    color: "#111827",
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
  },
});

