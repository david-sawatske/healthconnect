import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  connectPatientProvider,
  createAdminUser,
  fetchAdminAdvocates,
  fetchAdminPatients,
  fetchAdminProviders,
  fetchProviderPatientsForPatient,
  formatConnectPatientProviderSummary,
  formatCreateUserSummary,
  formatInviteAdvocateSummary,
  formatSeedResultSummary,
  inviteAdvocateToCareTeam,
  seedBasicAdminData,
} from "../features/admin/adminService";

const devLog = (...args) => {
  if (__DEV__) console.log("[ADMIN_HOME]", ...args);
};

const CREATE_USER_ROLES = [
  { label: "Patient", value: "PATIENT" },
  { label: "Provider", value: "PROVIDER" },
  { label: "Advocate", value: "ADVOCATE" },
];

const FLOW_STEP = {
  PATIENT: "PATIENT",
  PROVIDER: "PROVIDER",
  REVIEW: "REVIEW",
};

const INVITE_STEP = {
  PATIENT: "PATIENT",
  PROVIDER: "PROVIDER",
  ADVOCATE: "ADVOCATE",
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
  const [creatingUser, setCreatingUser] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [loadingInviteConnections, setLoadingInviteConnections] =
    useState(false);
  const [invitingAdvocate, setInvitingAdvocate] = useState(false);

  const [createUserRole, setCreateUserRole] = useState("PATIENT");
  const [createUserName, setCreateUserName] = useState("");
  const [createUserEmail, setCreateUserEmail] = useState("");

  const [patients, setPatients] = useState([]);
  const [providers, setProviders] = useState([]);
  const [advocates, setAdvocates] = useState([]);

  const [providerPatients, setProviderPatients] = useState([]);
  const [inviteProviderPatients, setInviteProviderPatients] = useState([]);

  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [selectedProviderId, setSelectedProviderId] = useState(null);
  const [flowStep, setFlowStep] = useState(FLOW_STEP.PATIENT);

  const [selectedInvitePatientId, setSelectedInvitePatientId] = useState(null);
  const [selectedInviteProviderId, setSelectedInviteProviderId] =
    useState(null);
  const [selectedInviteAdvocateId, setSelectedInviteAdvocateId] =
    useState(null);
  const [inviteStep, setInviteStep] = useState(INVITE_STEP.PATIENT);

  const busy =
    loadingSeed ||
    creatingUser ||
    loadingUsers ||
    loadingConnections ||
    connecting ||
    loadingInviteConnections ||
    invitingAdvocate;

  const selectedPatient = useMemo(() => {
    return patients.find((patient) => patient.id === selectedPatientId) || null;
  }, [patients, selectedPatientId]);

  const selectedProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.id === selectedProviderId) || null
    );
  }, [providers, selectedProviderId]);

  const selectedInvitePatient = useMemo(() => {
    return (
      patients.find((patient) => patient.id === selectedInvitePatientId) || null
    );
  }, [patients, selectedInvitePatientId]);

  const selectedInviteProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.id === selectedInviteProviderId) ||
      null
    );
  }, [providers, selectedInviteProviderId]);

  const selectedInviteAdvocate = useMemo(() => {
    return (
      advocates.find((advocate) => advocate.id === selectedInviteAdvocateId) ||
      null
    );
  }, [advocates, selectedInviteAdvocateId]);

  const connectedProviderIds = useMemo(() => {
    return new Set(
      providerPatients
        .map((relationship) => relationship?.providerId)
        .filter(Boolean),
    );
  }, [providerPatients]);

  const inviteConnectedProviderIds = useMemo(() => {
    return new Set(
      inviteProviderPatients
        .map((relationship) => relationship?.providerId)
        .filter(Boolean),
    );
  }, [inviteProviderPatients]);

  const patientStepComplete = Boolean(selectedPatient);
  const providerStepComplete = Boolean(selectedProvider);

  const invitePatientStepComplete = Boolean(selectedInvitePatient);
  const inviteProviderStepComplete = Boolean(selectedInviteProvider);
  const inviteAdvocateStepComplete = Boolean(selectedInviteAdvocate);

  const canSubmitConnection =
    selectedPatientId &&
    selectedProviderId &&
    !connectedProviderIds.has(selectedProviderId) &&
    !busy;

  const canSubmitInvite =
    selectedInvitePatientId &&
    selectedInviteProviderId &&
    selectedInviteAdvocateId &&
    inviteConnectedProviderIds.has(selectedInviteProviderId) &&
    !busy;

  const loadUsers = async () => {
    setLoadingUsers(true);

    try {
      const [patientResults, providerResults, advocateResults] =
        await Promise.all([
          fetchAdminPatients(),
          fetchAdminProviders(),
          fetchAdminAdvocates(),
        ]);

      setPatients(patientResults);
      setProviders(providerResults);
      setAdvocates(advocateResults);
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

  const loadInviteConnectionsForPatient = async (patientId) => {
    if (!patientId) {
      setInviteProviderPatients([]);
      return;
    }

    setLoadingInviteConnections(true);

    try {
      const relationships = await fetchProviderPatientsForPatient(patientId);
      setInviteProviderPatients(relationships);
    } catch (e) {
      devLog("load invite provider connections failed =", e);
      setInviteProviderPatients([]);
      Alert.alert(
        "Unable to load care teams",
        e?.message ?? "Unable to load existing care-team connections.",
      );
    } finally {
      setLoadingInviteConnections(false);
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

  const resetInviteFlow = () => {
    setSelectedInvitePatientId(null);
    setSelectedInviteProviderId(null);
    setSelectedInviteAdvocateId(null);
    setInviteProviderPatients([]);
    setInviteStep(INVITE_STEP.PATIENT);
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

  const handleSelectInvitePatient = async (patientId) => {
    setSelectedInvitePatientId(patientId);
    setSelectedInviteProviderId(null);
    setSelectedInviteAdvocateId(null);
    setInviteProviderPatients([]);
    setInviteStep(INVITE_STEP.PROVIDER);

    await loadInviteConnectionsForPatient(patientId);
  };

  const handleChangeInvitePatient = () => {
    setSelectedInviteProviderId(null);
    setSelectedInviteAdvocateId(null);
    setInviteProviderPatients([]);
    setInviteStep(INVITE_STEP.PATIENT);
  };

  const handleSelectInviteProvider = (providerId) => {
    if (!inviteConnectedProviderIds.has(providerId)) return;

    setSelectedInviteProviderId(providerId);
    setSelectedInviteAdvocateId(null);
    setInviteStep(INVITE_STEP.ADVOCATE);
  };

  const handleChangeInviteProvider = () => {
    setSelectedInviteProviderId(null);
    setSelectedInviteAdvocateId(null);
    setInviteStep(INVITE_STEP.PROVIDER);
  };

  const handleSelectInviteAdvocate = (advocateId) => {
    setSelectedInviteAdvocateId(advocateId);
    setInviteStep(INVITE_STEP.REVIEW);
  };

  const handleChangeInviteAdvocate = () => {
    setSelectedInviteAdvocateId(null);
    setInviteStep(INVITE_STEP.ADVOCATE);
  };

  const seedBasic = async () => {
    setLoadingSeed(true);

    try {
      const result = await seedBasicAdminData();

      devLog("seed result =", result);

      Alert.alert("Seed complete", formatSeedResultSummary(result.data));

      resetConnectionFlow();
      resetInviteFlow();
      await loadUsers();
    } catch (e) {
      devLog("seed failed =", e);
      Alert.alert("Seed failed", e?.message ?? String(e));
    } finally {
      setLoadingSeed(false);
    }
  };

  const handleCreateUser = async () => {
    const name = createUserName.trim();
    const email = createUserEmail.trim().toLowerCase();

    if (!name || !email) {
      Alert.alert(
        "Missing details",
        "Enter a name and email before creating a user.",
      );
      return;
    }

    setCreatingUser(true);

    try {
      const result = await createAdminUser({
        role: createUserRole,
        name,
        email,
      });

      devLog("create user result =", result);

      Alert.alert("User created", formatCreateUserSummary(result));

      setCreateUserName("");
      setCreateUserEmail("");

      await loadUsers();
    } catch (e) {
      devLog("create user failed =", e);

      Alert.alert("Create user failed", e?.message ?? "Unable to create user.");
    } finally {
      setCreatingUser(false);
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

      if (selectedInvitePatientId === selectedPatientId) {
        await loadInviteConnectionsForPatient(selectedPatientId);
      }
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

  const handleInviteAdvocate = async () => {
    if (
      !selectedInvitePatientId ||
      !selectedInviteProviderId ||
      !selectedInviteAdvocateId
    ) {
      Alert.alert(
        "Select users",
        "Choose a patient, provider, and advocate before creating the invite.",
      );
      return;
    }

    if (!inviteConnectedProviderIds.has(selectedInviteProviderId)) {
      Alert.alert(
        "Care team required",
        "Choose a provider that is already connected to this patient.",
      );
      return;
    }

    setInvitingAdvocate(true);

    try {
      const result = await inviteAdvocateToCareTeam({
        patientId: selectedInvitePatientId,
        providerId: selectedInviteProviderId,
        advocateId: selectedInviteAdvocateId,
      });

      devLog("invite advocate result =", result);

      Alert.alert("Advocate invited", formatInviteAdvocateSummary(result));

      setSelectedInviteAdvocateId(null);
      setInviteStep(INVITE_STEP.ADVOCATE);
    } catch (e) {
      devLog("invite advocate failed =", e);

      Alert.alert(
        "Invite failed",
        e?.message ?? "Unable to invite advocate to care team.",
      );
    } finally {
      setInvitingAdvocate(false);
    }
  };

  const renderCreateUserForm = () => {
    const canCreateUser =
      createUserName.trim() && createUserEmail.trim() && !busy;

    return (
      <View style={styles.createUserStack}>
        <View style={styles.roleRow}>
          {CREATE_USER_ROLES.map((role) => {
            const selected = createUserRole === role.value;

            return (
              <Pressable
                key={role.value}
                onPress={() => setCreateUserRole(role.value)}
                disabled={busy}
                style={[
                  styles.rolePill,
                  selected ? styles.rolePillSelected : null,
                  busy ? styles.disabled : null,
                ]}
              >
                <Text
                  style={[
                    styles.rolePillText,
                    selected ? styles.rolePillTextSelected : null,
                  ]}
                >
                  {role.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.inputStack}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              value={createUserName}
              onChangeText={setCreateUserName}
              placeholder="Example: Morgan Reed"
              autoCapitalize="words"
              editable={!busy}
              style={styles.textInput}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              value={createUserEmail}
              onChangeText={setCreateUserEmail}
              placeholder="example@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
              style={styles.textInput}
            />
          </View>
        </View>

        <Button
          title={creatingUser ? "Creating..." : "Create User"}
          onPress={handleCreateUser}
          disabled={!canCreateUser}
        />
      </View>
    );
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
                No providers found. Run Seed (basic) first or create a provider.
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
              disabled={!canSubmitConnection}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const renderInvitePatientStep = () => {
    const isActive = inviteStep === INVITE_STEP.PATIENT;

    return (
      <View style={styles.stepCard}>
        <StepHeader
          number="1"
          title="Select patient"
          complete={invitePatientStepComplete}
          active={isActive}
          onEdit={invitePatientStepComplete ? handleChangeInvitePatient : null}
        />

        {!isActive && selectedInvitePatient ? (
          <CollapsedSelection label="Patient" user={selectedInvitePatient} />
        ) : null}

        {isActive ? (
          <View style={styles.listStack}>
            {patients.length ? (
              patients.map((patient) => (
                <UserSelectCard
                  key={patient.id}
                  user={patient}
                  selected={patient.id === selectedInvitePatientId}
                  disabled={busy}
                  badgeText={
                    patient.id === selectedInvitePatientId ? "Selected" : null
                  }
                  onPress={() => handleSelectInvitePatient(patient.id)}
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

  const renderInviteProviderStep = () => {
    const isActive = inviteStep === INVITE_STEP.PROVIDER;
    const isLocked = !selectedInvitePatient;

    return (
      <View style={[styles.stepCard, isLocked ? styles.stepCardLocked : null]}>
        <StepHeader
          number="2"
          title="Select existing provider connection"
          complete={inviteProviderStepComplete}
          active={isActive}
          onEdit={
            inviteProviderStepComplete && selectedInvitePatient
              ? handleChangeInviteProvider
              : null
          }
        />

        {isLocked ? (
          <Text style={styles.lockedText}>Select a patient first.</Text>
        ) : null}

        {!isActive && selectedInviteProvider ? (
          <CollapsedSelection label="Provider" user={selectedInviteProvider} />
        ) : null}

        {isActive && selectedInvitePatient ? (
          <View style={styles.listStack}>
            {loadingInviteConnections ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>
                  Loading existing care-team connections...
                </Text>
              </View>
            ) : null}

            {!loadingInviteConnections && providers.length
              ? providers.map((provider) => {
                  const isConnected = inviteConnectedProviderIds.has(
                    provider.id,
                  );
                  const isSelected = provider.id === selectedInviteProviderId;

                  return (
                    <UserSelectCard
                      key={provider.id}
                      user={provider}
                      selected={isSelected}
                      disabled={busy || !isConnected}
                      disabledReason={
                        isConnected
                          ? null
                          : "No care-team connection for this patient"
                      }
                      badgeText={
                        isSelected
                          ? "Selected"
                          : isConnected
                            ? "Care Team"
                            : "Unavailable"
                      }
                      onPress={() => handleSelectInviteProvider(provider.id)}
                    />
                  );
                })
              : null}

            {!loadingInviteConnections && !providers.length ? (
              <Text style={styles.emptyText}>
                No providers found. Create a provider and connect them to a
                patient first.
              </Text>
            ) : null}

            {!loadingInviteConnections &&
            providers.length &&
            inviteConnectedProviderIds.size === 0 ? (
              <Text style={styles.emptyText}>
                This patient has no provider connections yet. Connect the
                patient to a provider before inviting an advocate.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  const renderInviteAdvocateStep = () => {
    const isActive = inviteStep === INVITE_STEP.ADVOCATE;
    const isLocked = !selectedInvitePatient || !selectedInviteProvider;

    return (
      <View style={[styles.stepCard, isLocked ? styles.stepCardLocked : null]}>
        <StepHeader
          number="3"
          title="Select advocate"
          complete={inviteAdvocateStepComplete}
          active={isActive}
          onEdit={
            inviteAdvocateStepComplete && selectedInviteProvider
              ? handleChangeInviteAdvocate
              : null
          }
        />

        {isLocked ? (
          <Text style={styles.lockedText}>
            Select a patient and existing provider connection first.
          </Text>
        ) : null}

        {!isActive && selectedInviteAdvocate ? (
          <CollapsedSelection label="Advocate" user={selectedInviteAdvocate} />
        ) : null}

        {isActive && selectedInvitePatient && selectedInviteProvider ? (
          <View style={styles.listStack}>
            {advocates.length ? (
              advocates.map((advocate) => {
                const isSelected = advocate.id === selectedInviteAdvocateId;

                return (
                  <UserSelectCard
                    key={advocate.id}
                    user={advocate}
                    selected={isSelected}
                    disabled={busy}
                    badgeText={isSelected ? "Selected" : "Available"}
                    onPress={() => handleSelectInviteAdvocate(advocate.id)}
                  />
                );
              })
            ) : (
              <Text style={styles.emptyText}>
                No advocates found. Create an advocate first.
              </Text>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const renderInviteReviewStep = () => {
    const isActive = inviteStep === INVITE_STEP.REVIEW;
    const isLocked =
      !selectedInvitePatient ||
      !selectedInviteProvider ||
      !selectedInviteAdvocate;

    return (
      <View style={[styles.stepCard, isLocked ? styles.stepCardLocked : null]}>
        <StepHeader
          number="4"
          title="Review and invite"
          complete={false}
          active={isActive}
        />

        {isLocked ? (
          <Text style={styles.lockedText}>
            Select a patient, provider, and advocate first.
          </Text>
        ) : null}

        {isActive &&
        selectedInvitePatient &&
        selectedInviteProvider &&
        selectedInviteAdvocate ? (
          <View style={styles.reviewStack}>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>Invite summary</Text>

              <Text style={styles.summaryLine}>
                Patient:{" "}
                <Text style={styles.summaryStrong}>
                  {getUserLabel(selectedInvitePatient)}
                </Text>
              </Text>

              <Text style={styles.summaryLine}>
                Provider:{" "}
                <Text style={styles.summaryStrong}>
                  {getUserLabel(selectedInviteProvider)}
                </Text>
              </Text>

              <Text style={styles.summaryLine}>
                Advocate:{" "}
                <Text style={styles.summaryStrong}>
                  {getUserLabel(selectedInviteAdvocate)}
                </Text>
              </Text>

              <Text style={styles.summaryNote}>
                This creates an advocate invite only. It does not create an
                advocate assignment, add the advocate to the care-team chat, or
                create a chat participant.
              </Text>
            </View>

            <Button
              title={invitingAdvocate ? "Inviting..." : "Invite Advocate"}
              onPress={handleInviteAdvocate}
              disabled={!canSubmitInvite}
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
          Manage demo data, create users, connect patients to providers, and
          invite advocates to existing care teams.
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
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>Create User</Text>
          <Text style={styles.sectionDescription}>
            Add a patient, provider, or advocate profile through the admin user
            API.
          </Text>
        </View>

        {renderCreateUserForm()}
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

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>
              Invite Advocate to Care Team
            </Text>
            <Text style={styles.sectionDescription}>
              Select an existing patient/provider care team, then invite an
              advocate. Chat access is granted only after approval.
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
              Loading patients/providers/advocates...
            </Text>
          </View>
        ) : (
          <View style={styles.flowStack}>
            {renderInvitePatientStep()}
            {renderInviteProviderStep()}
            {renderInviteAdvocateStep()}
            {renderInviteReviewStep()}
          </View>
        )}
      </View>

      {busy &&
      !loadingUsers &&
      !loadingConnections &&
      !loadingInviteConnections ? (
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
  createUserStack: {
    gap: 12,
  },
  roleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  rolePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  rolePillSelected: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  rolePillText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
  },
  rolePillTextSelected: {
    color: "#FFFFFF",
  },
  inputStack: {
    gap: 10,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
  },
  textInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    fontSize: 15,
    color: "#111827",
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
