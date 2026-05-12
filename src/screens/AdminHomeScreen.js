import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  connectPatientProvider,
  fetchAdminPatients,
  fetchAdminProviders,
  formatConnectPatientProviderSummary,
  formatSeedResultSummary,
  seedBasicAdminData,
  testAdminUsersApi,
} from "../features/admin/adminService";

const devLog = (...args) => {
  if (__DEV__) console.log("[ADMIN_HOME]", ...args);
};

const TEST_CREATE_USER_PAYLOAD = {
  action: "CREATE_USER",
  user: {
    role: "PATIENT",
    name: "Test Patient",
    email: "test.patient@example.com",
  },
};

const getUserLabel = (user) => {
  return user?.displayName || user?.email || user?.id || "Unknown user";
};

const getUserSubLabel = (user) => {
  const parts = [user?.email, user?.id].filter(Boolean);
  return parts.join(" • ");
};

function UserSelectCard({ user, selected, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.userCard,
        selected ? styles.userCardSelected : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <View style={styles.userCardHeader}>
        <Text style={styles.userName}>{getUserLabel(user)}</Text>

        {selected ? (
          <View style={styles.selectedPill}>
            <Text style={styles.selectedPillText}>Selected</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.userMeta}>{getUserSubLabel(user)}</Text>
    </Pressable>
  );
}

export default function AdminHomeScreen() {
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [testingUsersApi, setTestingUsersApi] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [patients, setPatients] = useState([]);
  const [providers, setProviders] = useState([]);

  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [selectedProviderId, setSelectedProviderId] = useState(null);

  const selectedPatient = useMemo(() => {
    return patients.find((patient) => patient.id === selectedPatientId) || null;
  }, [patients, selectedPatientId]);

  const selectedProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.id === selectedProviderId) || null
    );
  }, [providers, selectedProviderId]);

  const busy = loadingSeed || testingUsersApi || loadingUsers || connecting;
  const canConnect = selectedPatientId && selectedProviderId && !busy;

  const loadUsers = async () => {
    setLoadingUsers(true);

    try {
      const [patientResults, providerResults] = await Promise.all([
        fetchAdminPatients(),
        fetchAdminProviders(),
      ]);

      setPatients(patientResults);
      setProviders(providerResults);

      setSelectedPatientId((currentId) => {
        if (currentId && patientResults.some((user) => user.id === currentId)) {
          return currentId;
        }

        return patientResults[0]?.id || null;
      });

      setSelectedProviderId((currentId) => {
        if (
          currentId &&
          providerResults.some((user) => user.id === currentId)
        ) {
          return currentId;
        }

        return providerResults[0]?.id || null;
      });
    } catch (e) {
      devLog("load users failed =", e);
      Alert.alert("Unable to load users", e?.message ?? String(e));
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const seedBasic = async () => {
    setLoadingSeed(true);

    try {
      const result = await seedBasicAdminData();

      devLog("seed result =", result);

      Alert.alert("Seed complete", formatSeedResultSummary(result.data));

      await loadUsers();
    } catch (e) {
      devLog("seed failed =", e);
      Alert.alert("Seed failed", e?.message ?? String(e));
    } finally {
      setLoadingSeed(false);
    }
  };

  const testCreateUser = async () => {
    setTestingUsersApi(true);

    try {
      const result = await testAdminUsersApi(TEST_CREATE_USER_PAYLOAD);

      devLog("admin users api result =", result);

      const body = result?.body || result?.data || {};

      Alert.alert(
        "CREATE_USER test",
        [
          body?.message || "adminManageUsers Lambda responded successfully.",
          body?.user?.displayName ? `Name: ${body.user.displayName}` : null,
          body?.user?.email ? `Email: ${body.user.email}` : null,
          body?.user?.role ? `Role: ${body.user.role}` : null,
          `TABLE_USER configured: ${body?.tableUserConfigured ? "yes" : "no"}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );

      await loadUsers();
    } catch (e) {
      devLog("admin users api failed =", e);

      Alert.alert(
        "CREATE_USER test failed",
        e?.message ?? "Unable to call /admin/users.",
      );
    } finally {
      setTestingUsersApi(false);
    }
  };

  const handleConnectPatientProvider = async () => {
    if (!selectedPatientId || !selectedProviderId) {
      Alert.alert(
        "Select users",
        "Choose one patient and one provider before connecting.",
      );
      return;
    }

    setConnecting(true);

    try {
      const result = await connectPatientProvider({
        patientId: selectedPatientId,
        providerId: selectedProviderId,
      });

      devLog("connect patient/provider result =", result);

      Alert.alert(
        "Patient connected",
        formatConnectPatientProviderSummary(result),
      );
    } catch (e) {
      devLog("connect patient/provider failed =", e);

      Alert.alert(
        "Connection failed",
        e?.message ?? "Unable to connect patient/provider.",
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Admin Tools</Text>
        <Text style={styles.subtitle}>
          Manage demo data and connect patients to providers.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Developer Actions</Text>

        <View style={styles.buttonStack}>
          <Button
            title={loadingSeed ? "Seeding..." : "Seed (basic)"}
            onPress={seedBasic}
            disabled={busy}
          />

          <Button
            title={testingUsersApi ? "Testing..." : "Test CREATE_USER"}
            onPress={testCreateUser}
            disabled={busy}
          />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>Connect Patient to Provider</Text>
            <Text style={styles.sectionDescription}>
              Creates the provider/patient relationship and ensures the
              care-team chat exists.
            </Text>
          </View>

          <Pressable onPress={loadUsers} disabled={busy} style={styles.refresh}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        {loadingUsers ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>
              Loading patients/providers...
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.pickerSection}>
              <Text style={styles.pickerTitle}>1. Select patient</Text>

              {patients.length ? (
                patients.map((patient) => (
                  <UserSelectCard
                    key={patient.id}
                    user={patient}
                    selected={patient.id === selectedPatientId}
                    disabled={busy}
                    onPress={() => setSelectedPatientId(patient.id)}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>
                  No patients found. Run Seed (basic) first or create a patient.
                </Text>
              )}
            </View>

            <View style={styles.pickerSection}>
              <Text style={styles.pickerTitle}>2. Select provider</Text>

              {providers.length ? (
                providers.map((provider) => (
                  <UserSelectCard
                    key={provider.id}
                    user={provider}
                    selected={provider.id === selectedProviderId}
                    disabled={busy}
                    onPress={() => setSelectedProviderId(provider.id)}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>
                  No providers found. Run Seed (basic) first.
                </Text>
              )}
            </View>

            <Button
              title={
                connecting ? "Connecting..." : "Connect Patient to Provider"
              }
              onPress={handleConnectPatientProvider}
              disabled={!canConnect}
            />
          </>
        )}
      </View>

      {busy && !loadingUsers ? (
        <ActivityIndicator style={styles.bottomLoader} />
      ) : null}
    </ScrollView>
  );
}

const styles = {
  screen: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6B7280",
  },
  section: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionHeaderText: {
    flex: 1,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  sectionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6B7280",
  },
  buttonStack: {
    gap: 10,
  },
  refresh: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#DBEAFE",
  },
  refreshText: {
    color: "#1D4ED8",
    fontSize: 13,
    fontWeight: "700",
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#6B7280",
  },
  pickerSection: {
    gap: 8,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  userCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    gap: 6,
  },
  userCardSelected: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  userCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  userName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  userMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: "#6B7280",
  },
  selectedPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#2563EB",
  },
  selectedPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.6,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6B7280",
    backgroundColor: "#F9FAFB",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  bottomLoader: {
    marginTop: 4,
  },
};
