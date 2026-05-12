import React, { useState } from "react";
import { View, Button, Alert, ActivityIndicator, Text } from "react-native";
import {
  seedBasicAdminData,
  formatSeedResultSummary,
  testAdminUsersApi,
  connectPatientProvider,
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

// Seeded demo users.
// These IDs should exist after running Seed (basic).
const TEST_CONNECT_PATIENT_PROVIDER_PAYLOAD = {
  patientId: "demo-patient2",
  providerId: "demo-provider2",
};

export default function AdminHomeScreen() {
  const [loading, setLoading] = useState(false);
  const [testingUsersApi, setTestingUsersApi] = useState(false);
  const [testingConnect, setTestingConnect] = useState(false);

  const seedBasic = async () => {
    setLoading(true);

    try {
      const result = await seedBasicAdminData();

      devLog("seed result =", result);

      Alert.alert("Seed complete", formatSeedResultSummary(result.data));
    } catch (e) {
      devLog("seed failed =", e);
      Alert.alert("Seed failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
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

  const testConnectPatientProvider = async () => {
    setTestingConnect(true);

    try {
      const result = await connectPatientProvider(
        TEST_CONNECT_PATIENT_PROVIDER_PAYLOAD,
      );

      devLog("connect patient/provider result =", result);

      const body = result?.body || result?.data || result || {};

      Alert.alert(
        "CONNECT_PATIENT_PROVIDER test",
        [
          body?.message || "Patient/provider connection completed.",
          body?.patient?.displayName
            ? `Patient: ${body.patient.displayName}`
            : `Patient ID: ${TEST_CONNECT_PATIENT_PROVIDER_PAYLOAD.patientId}`,
          body?.provider?.displayName
            ? `Provider: ${body.provider.displayName}`
            : `Provider ID: ${TEST_CONNECT_PATIENT_PROVIDER_PAYLOAD.providerId}`,
          body?.providerPatient?.id
            ? `ProviderPatient: ${body.providerPatient.id}`
            : null,
          `Relationship created: ${
            body?.providerPatient?.created ? "yes" : "already existed"
          }`,
          body?.conversation?.id
            ? `Conversation: ${body.conversation.id}`
            : null,
          `Conversation created: ${
            body?.conversation?.created ? "yes" : "already existed"
          }`,
          `Patient participant: ${
            body?.participants?.patient?.created ? "created" : "already existed"
          }`,
          `Provider participant: ${
            body?.participants?.provider?.created
              ? "created"
              : "already existed"
          }`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (e) {
      devLog("connect patient/provider failed =", e);

      Alert.alert(
        "CONNECT_PATIENT_PROVIDER test failed",
        e?.message ?? "Unable to connect patient/provider.",
      );
    } finally {
      setTestingConnect(false);
    }
  };

  const busy = loading || testingUsersApi || testingConnect;

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 4 }}>
        Admin Tools
      </Text>

      <Button title="Seed (basic)" onPress={seedBasic} disabled={busy} />

      <Button
        title={testingUsersApi ? "Testing..." : "Test CREATE_USER"}
        onPress={testCreateUser}
        disabled={busy}
      />

      <Button
        title={
          testingConnect ? "Connecting..." : "Test CONNECT_PATIENT_PROVIDER"
        }
        onPress={testConnectPatientProvider}
        disabled={busy}
      />

      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
    </View>
  );
}
