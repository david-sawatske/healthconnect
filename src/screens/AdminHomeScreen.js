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

  const testUsersApi = async () => {
    setTestingUsersApi(true);

    try {
      const result = await testAdminUsersApi();

      devLog("admin users api result =", result);

      Alert.alert(
        "Admin Users API",
        result?.body?.message ||
          result?.data?.message ||
          "adminManageUsers Lambda responded successfully.",
      );
    } catch (e) {
      devLog("admin users api failed =", e);

      Alert.alert(
        "Admin Users API failed",
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
        title={testingUsersApi ? "Testing..." : "Test Admin Users API"}
        onPress={testUsersApi}
        disabled={busy}
      />

      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
    </View>
  );
}
