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
  fetchProviderPatientsForPatient,
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

const FLOW_STEP = {
  PATIENT: "PATIENT",
  PROVIDER: "PROVIDER",
  REVIEW: "REVIEW",
};

const getUserLabel = (user) => {
  return user?.displayName || user?.email || user?.id || "Unknown user";
};

const getUserSubLabel = (user) => {
  const parts = [user?.email, user?.id].filter(Boolean);
  return parts.join(" • ");
};

function StepHeader({ number, title, complete, active, onEdit }) {
  return (
    <View style={styles.stepHeader}>
      <View style={styles.stepTitleRow}>
        <View
          style={[
            styles.stepBadge,
            complete ? styles.stepBadgeComplete : null,
            active ? styles.stepBadgeActive : null,
          ]}
        >
          <Text
            style={[
              styles.stepBadgeText,
              complete || active ? styles.stepBadgeTextActive : null,
            ]}
          >
            {complete ? "✓" : number}
          </Text>
        </View>

        <Text style={styles.stepTitle}>{title}</Text>
      </View>

      {complete && onEdit ? (
        <Pressable onPress={onEdit} style={styles.editButton}>
          <Text style={styles.editButtonText}>Change</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function UserSelectCard({
  user,
  selected,
  disabled,
  disabledReason,
  badgeText,
  onPress,
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.userCard,
        selected ? styles.userCardSelected : null,
        disabled ? styles.userCardDisabled : null,
      ]}
    >
      <View style={styles.userCardHeader}>
        <Text style={styles.userName}>{getUserLabel(user)}</Text>

        {badgeText ? (
          <View
            style={[
              styles.cardBadge,
              selected ? styles.cardBadgeSelected : null,
              disabled ? styles.cardBadgeDisabled : null,
            ]}
          >
            <Text
              style={[
                styles.cardBadgeText,
                selected ? styles.cardBadgeTextSelected : null,
                disabled ? styles.cardBadgeTextDisabled : null,
              ]}
            >
              {badgeText}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.userMeta}>{getUserSubLabel(user)}</Text>

      {disabledReason ? (
        <Text style={styles.disabledReason}>{disabledReason}</Text>
      ) : null}
    </Pressable>
  );
}

function CollapsedSelection({ label, user }) {
  return (
    <View style={styles.collapsedBox}>
      <Text style={styles.collapsedLabel}>{label}</Text>
      <Text style={styles.collapsedValue}>{getUserLabel(user)}</Text>
      <Text style={styles.collapsedMeta}>{getUserSubLabel(user)}</Text>
    </View>
  );
}

export default function AdminHomeScreen() {
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [testingUsersApi, setTestingUsersApi] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [patients, setPatients] = useState([]);
  const [providers, setProviders] = useState([]);
  const [providerPatients, setProviderPatients] = useState([]);

  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [flowStep, setFlowStep] = useState(FLOW_STEP.PATIENT);

  const busy =
    loadingSeed ||
    testingUsersApi ||
    loadingUsers ||
    loadingConnections ||
    connecting;

  const selectedPatient = useMemo(() => {
    return patients.find((patient) => patient.id === selectedPatientId) || null;
  }, [patients, selectedPatientId]);

  const selectedProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.id === selectedProviderId) || null
    );
  }, [providers, selectedProviderId]);

  const connectedProviderIds = useMemo(() => {
    return new Set(
      providerPatients
        .map((relationship) => relationship?.providerId)
        .filter(Boolean),
    );
  }, [providerPatients]);

  const patientStepComplete = Boolean(selectedPatient);
  const providerStepComplete = Boolean(selectedProvider);
  const canSubmit =
    selectedPatientId &&
    selectedProviderId &&
    !connectedProviderIds.has(selectedProviderId) &&
    !busy;

  const loadUsers = async () => {
    setLoadingUsers(true);

    try {
      const [patientResults, providerResults] = await Promise.all([
        fetchAdminPatients(),
        fetchAdminProviders(),
      ]);

      setPatients(patientResults);
      setProviders(providerResults);
    } catch (e) {
      devLog("load users failed =", e);
      Alert.alert("Unable to load users", e?.message ?? String(e));
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadConnectionsForPatient = async (patientId) => {
    if (!patientId) {
      setProviderPatients([]);
      return;
    }

    setLoadingConnections(true);

    try {
      const relationships = await fetchProviderPatientsForPatient(patientId);
      setProviderPatients(relationships);
    } catch (e) {
      devLog("load provider connections failed =", e);
      setProviderPatients([]);
      Alert.alert(
        "Unable to load connections",
        e?.message ?? "Unable to load existing provider connections.",
      );
    } finally {
      setLoadingConnections(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const resetConnectionFlow = () => {
    setSelectedPatientId(null);
    setSelectedProviderId(null);
    setProviderPatients([]);
    setFlowStep(FLOW_STEP.PATIENT);
  };

  const handleSelectPatient = async (patientId) => {
    setSelectedPatientId(patientId);
    setSelectedProviderId(null);
    setProviderPatients([]);
    setFlowStep(FLOW_STEP.PROVIDER);

    await loadConnectionsForPatient(patientId);
  };

  const handleChangePatient = () => {
    setSelectedProviderId(null);
    setProviderPatients([]);
    setFlowStep(FLOW_STEP.PATIENT);
  };

  const handleSelectProvider = (providerId) => {
    if (connectedProviderIds.has(providerId)) return;

    setSelectedProviderId(providerId);
    setFlowStep(FLOW_STEP.REVIEW);
  };

  const handleChangeProvider = () => {
    setSelectedProviderId(null);
    setFlowStep(FLOW_STEP.PROVIDER);
  };

  const seedBasic = async () => {
    setLoadingSeed(true);

    try {
      const result = await seedBasicAdminData();

      devLog("seed result =", result);

      Alert.alert("Seed complete", formatSeedResultSummary(result.data));

      resetConnectionFlow();
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

    if (connectedProviderIds.has(selectedProviderId)) {
      Alert.alert(
        "Already connected",
        "This patient is already connected to the selected provider.",
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

      setSelectedProviderId(null);
      setFlowStep(FLOW_STEP.PROVIDER);

      await loadConnectionsForPatient(selectedPatientId);
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

  const renderPatientStep = () => {
    const isActive = flowStep === FLOW_STEP.PATIENT;

    return (
      <View style={styles.stepCard}>
        <StepHeader
          number="1"
          title="Select patient"
          complete={patientStepComplete}
          active={isActive}
          onEdit={patientStepComplete ? handleChangePatient : null}
        />

        {!isActive && selectedPatient ? (
          <CollapsedSelection label="Patient" user={selectedPatient} />
        ) : null}

        {isActive ? (
          <View style={styles.listStack}>
            {patients.length ? (
              patients.map((patient) => (
                <UserSelectCard
                  key={patient.id}
                  user={patient}
                  selected={patient.id === selectedPatientId}
                  disabled={busy}
                  badgeText={
                    patient.id === selectedPatientId ? "Selected" : null
                  }
                  onPress={() => handleSelectPatient(patient.id)}
                />
              ))
            ) : (
              <Text style={styles.emptyText}>
                No patients found. Run Seed (basic) first or create a patient.
              </Text>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const renderProviderStep = () => {
    const isActive = flowStep === FLOW_STEP.PROVIDER;
    const isLocked = !selectedPatient;

    return (
      <View style={[styles.stepCard, isLocked ? styles.stepCardLocked : null]}>
        <StepHeader
          number="2"
          title="Select provider"
          complete={providerStepComplete}
          active={isActive}
          onEdit={
            providerStepComplete && selectedPatient
              ? handleChangeProvider
              : null
          }
        />

        {isLocked ? (
          <Text style={styles.lockedText}>Select a patient first.</Text>
        ) : null}

        {!isActive && selectedProvider ? (
          <CollapsedSelection label="Provider" user={selectedProvider} />
        ) : null}

        {isActive && selectedPatient ? (
          <View style={styles.listStack}>
            {loadingConnections ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>
                  Loading existing provider connections...
                </Text>
              </View>
            ) : null}

            {!loadingConnections && providers.length
              ? providers.map((provider) => {
                  const alreadyConnected = connectedProviderIds.has(
                    provider.id,
                  );
                  const isSelected = provider.id === selectedProviderId;

                  return (
                    <UserSelectCard
                      key={provider.id}
                      user={provider}
                      selected={isSelected}
                      disabled={busy || alreadyConnected}
                      disabledReason={
                        alreadyConnected
                          ? "Already connected to this patient"
                          : null
                      }
                      badgeText={
                        alreadyConnected
                          ? "Connected"
                          : isSelected
                            ? "Selected"
                            : "Available"
                      }
                      onPress={() => handleSelectProvider(provider.id)}
                    />
                  );
                })
              : null}

            {!loadingConnections && !providers.length ? (
              <Text style={styles.emptyText}>
                No providers found. Run Seed (basic) first.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderReviewStep = () => {
    const isActive = flowStep === FLOW_STEP.REVIEW;
    const isLocked = !selectedPatient || !selectedProvider;

    return (
      <View style={[styles.stepCard, isLocked ? styles.stepCardLocked : null]}>
        <StepHeader
          number="3"
          title="Review and connect"
          complete={false}
          active={isActive}
        />

        {isLocked ? (
          <Text style={styles.lockedText}>
            Select a patient and available provider first.
          </Text>
        ) : null}

        {isActive && selectedPatient && selectedProvider ? (
          <View style={styles.reviewStack}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>Connection summary</Text>

              <Text style={styles.summaryLine}>
                Patient:{" "}
                <Text style={styles.summaryStrong}>
                  {getUserLabel(selectedPatient)}
                </Text>
              </Text>

              <Text style={styles.summaryLine}>
                Provider:{" "}
                <Text style={styles.summaryStrong}>
                  {getUserLabel(selectedProvider)}
                </Text>
              </Text>

              <Text style={styles.summaryNote}>
                This will create or ensure the provider/patient relationship,
                canonical care-team chat, and both chat participants.
              </Text>
            </View>

            <Button
              title={
                connecting ? "Connecting..." : "Connect Patient to Provider"
              }
              onPress={handleConnectPatientProvider}
              disabled={!canSubmit}
            />
          </View>
        ) : null}
      </View>
    );
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
              Select a patient, choose an available provider, then create the
              care-team connection.
            </Text>
          </View>

          <Pressable
            onPress={loadUsers}
            disabled={busy}
            style={[styles.refresh, busy ? styles.disabled : null]}
          >
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
          <View style={styles.flowStack}>
            {renderPatientStep()}
            {renderProviderStep()}
            {renderReviewStep()}
          </View>
        )}
      </View>

      {busy && !loadingUsers && !loadingConnections ? (
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
  flowStack: {
    gap: 12,
  },
  stepCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    padding: 12,
    gap: 12,
    backgroundColor: "#FFFFFF",
  },
  stepCardLocked: {
    backgroundColor: "#F9FAFB",
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  stepTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  stepBadgeActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  stepBadgeComplete: {
    backgroundColor: "#DBEAFE",
    borderColor: "#93C5FD",
  },
  stepBadgeText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#6B7280",
  },
  stepBadgeTextActive: {
    color: "#FFFFFF",
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  editButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
  },
  editButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
  },
  listStack: {
    gap: 8,
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
  userCardDisabled: {
    opacity: 0.58,
    backgroundColor: "#F9FAFB",
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
  cardBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#ECFDF5",
  },
  cardBadgeSelected: {
    backgroundColor: "#2563EB",
  },
  cardBadgeDisabled: {
    backgroundColor: "#E5E7EB",
  },
  cardBadgeText: {
    color: "#15803D",
    fontSize: 11,
    fontWeight: "800",
  },
  cardBadgeTextSelected: {
    color: "#FFFFFF",
  },
  cardBadgeTextDisabled: {
    color: "#6B7280",
  },
  disabledReason: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
  },
  collapsedBox: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 2,
  },
  collapsedLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  collapsedValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  collapsedMeta: {
    fontSize: 12,
    color: "#6B7280",
  },
  lockedText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6B7280",
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
  reviewStack: {
    gap: 12,
  },
  summaryBox: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 4,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 2,
  },
  summaryLine: {
    fontSize: 14,
    color: "#6B7280",
  },
  summaryStrong: {
    color: "#111827",
    fontWeight: "700",
  },
  summaryNote: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: "#6B7280",
  },
  bottomLoader: {
    marginTop: 4,
  },
  disabled: {
    opacity: 0.6,
  },
};
