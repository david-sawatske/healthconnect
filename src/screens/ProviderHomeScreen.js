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
import {
  ensureDirectConversation,
  ensureCareTeamConversation,
} from "../utils/conversations";

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

const LIST_ADVOCATE_ASSIGNMENTS_FOR_PROVIDER_PATIENT = /* GraphQL */ `
  query ListAdvocateAssignmentsForProviderPatient(
    $patientId: ID!
    $providerId: ID!
  ) {
    listAdvocateAssignments(
      filter: {
        patientId: { eq: $patientId }
        providerId: { eq: $providerId }
        active: { eq: true }
      }
      limit: 50
    ) {
      items {
        id
        patientId
        providerId
        advocateId
        active
        createdAt
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

  const [advocateIdsByPatient, setAdvocateIdsByPatient] = useState({});

  const roleLabelMap = {
    PATIENT: "Patient",
    PROVIDER: "Provider",
    ADVOCATE: "Advocate",
    ADMIN: "Admin",
  };

  const displayName = currentUser?.displayName || "Provider";
  const roleLabel =
    roleLabelMap[currentUser?.role] ?? currentUser?.role ?? "Provider";

  const loadAdvocateIdsForPatient = useCallback(
    async (patientId) => {
      if (!currentUser?.id || !patientId) return [];

      if (advocateIdsByPatient[patientId])
        return advocateIdsByPatient[patientId];

      try {
        const res = await client.graphql({
          query: LIST_ADVOCATE_ASSIGNMENTS_FOR_PROVIDER_PATIENT,
          variables: { patientId, providerId: currentUser.id },
          authMode: "userPool",
        });

        const items = res?.data?.listAdvocateAssignments?.items || [];
        const advocateIds = Array.from(
          new Set(items.map((a) => a.advocateId).filter(Boolean)),
        );

        setAdvocateIdsByPatient((prev) => ({
          ...prev,
          [patientId]: advocateIds,
        }));

        return advocateIds;
      } catch (err) {
        log("loadAdvocateIdsForPatient error:", patientId, err);
        return [];
      }
    },
    [currentUser?.id, advocateIdsByPatient],
  );

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

      (async () => {
        const first = items.slice(0, 10);
        for (const p of first) {
          if (!p?.id) continue;
          if (advocateIdsByPatient[p.id]) continue;
          await loadAdvocateIdsForPatient(p.id);
        }
      })().catch(() => {});
    } catch (err) {
      log("loadPatients error:", err);
      Alert.alert("Error", "Failed to load patients.");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, loadAdvocateIdsForPatient, advocateIdsByPatient]);

  useEffect(() => {
    if (currentUser?.id) {
      loadPatients();
    }
  }, [currentUser?.id, loadPatients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setAdvocateIdsByPatient({});
      await loadPatients();
    } finally {
      setRefreshing(false);
    }
  }, [loadPatients]);

  const handlePressPatient = (patient) => {
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
  };

  const handleMessagePatient = useCallback(
    async (patient) => {
      if (!patient?.id || !currentUser?.id) {
        Alert.alert("Error", "Missing user information to start a chat.");
        return;
      }

      try {
        const conversation = await ensureDirectConversation({
          currentUserId: currentUser.id,
          memberIds: [currentUser.id, patient.id],
          title: `${currentUser.displayName || "Provider"} ↔ ${
            patient.displayName || "Patient"
          }`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title:
            conversation.title ||
            patient.displayName ||
            "Provider–Patient Conversation",
        });
      } catch (err) {
        log("handleMessagePatient error:", err);
        Alert.alert(
          "Unable to open chat",
          "Something went wrong while opening the conversation.",
        );
      }
    },
    [currentUser?.id, currentUser?.displayName, navigation],
  );

  const handleCareTeamChat = useCallback(
    async (patient) => {
      if (!patient?.id || !currentUser?.id) {
        Alert.alert("Error", "Missing user information to start a chat.");
        return;
      }

      try {
        const advocateIds = await loadAdvocateIdsForPatient(patient.id);

        if (!advocateIds.length) {
          Alert.alert(
            "No advocates assigned",
            "Assign an advocate to enable a care team chat for this patient.",
          );
          return;
        }

        const conversation = await ensureCareTeamConversation({
          currentUserId: currentUser.id,
          patientId: patient.id,
          providerId: currentUser.id,
          advocateIds,
          title: `Care Team: ${patient.displayName || "Patient"}`,
        });

        navigation.navigate("Chat", {
          conversationId: conversation.id,
          conversation,
          title: conversation.title || "Care Team Chat",
        });
      } catch (err) {
        log("handleCareTeamChat error:", err);
        Alert.alert(
          "Unable to open care team chat",
          "Something went wrong while opening the care team conversation.",
        );
      }
    },
    [currentUser?.id, loadAdvocateIdsForPatient, navigation],
  );

  const renderPatientItem = ({ item }) => {
    const cachedAdvIds = advocateIdsByPatient[item.id];
    const hasCache = Array.isArray(cachedAdvIds);
    const count = hasCache ? cachedAdvIds.length : null;

    return (
      <View style={styles.patientRow}>
        <TouchableOpacity
          style={styles.patientInfo}
          onPress={() => handlePressPatient(item)}
        >
          <Text style={styles.patientName}>
            {item.displayName || "Unnamed Patient"}
          </Text>

          {item.email ? (
            <Text style={styles.patientSub}>{item.email}</Text>
          ) : null}

          {hasCache ? (
            count > 0 ? (
              <Text style={styles.patientMetaLine}>
                Advocates assigned: {count}
              </Text>
            ) : (
              <Text style={styles.patientHint}>
                No advocates assigned (care team chat disabled)
              </Text>
            )
          ) : (
            <Text style={styles.patientMetaLine}>
              Advocates: — (tap Care Team to load)
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.rowRight}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => handleCareTeamChat(item)}
          >
            <Text style={styles.secondaryButtonText}>Care Team</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => handleMessagePatient(item)}
          >
            <Text style={styles.messageButtonText}>Message</Text>
          </TouchableOpacity>

          <Text style={styles.patientChevron}>›</Text>
        </View>
      </View>
    );
  };

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
  patientInfo: {
    flex: 1,
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
  patientMetaLine: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 6,
  },
  patientHint: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 6,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  secondaryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1D4ED8",
    marginRight: 8,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  messageButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#2563EB",
    marginRight: 8,
  },
  messageButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  patientChevron: {
    fontSize: 24,
    color: "#9CA3AF",
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
