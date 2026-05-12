import React, { useState } from "react";
import { View, Button, Alert, ActivityIndicator, Text } from "react-native";
import {
  seedBasicAdminData,
  formatSeedResultSummary,
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

export default function AdminHomeScreen() {
  const [loading, setLoading] = useState(false);
  const [testingUsersApi, setTestingUsersApi] = useState(false);

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

  const busy = loading || testingUsersApi;

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

      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
    </View>
  );
}
