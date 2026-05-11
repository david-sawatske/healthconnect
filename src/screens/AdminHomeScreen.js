import React, { useState } from "react";
import { View, Button, Alert, ActivityIndicator } from "react-native";
import {
  seedBasicAdminData,
  formatSeedResultSummary,
} from "../features/admin/adminService";

const devLog = (...args) => {
  if (__DEV__) console.log("[ADMIN_HOME]", ...args);
};

export default function AdminHomeScreen() {
  const [loading, setLoading] = useState(false);

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

  return (
    <View style={{ padding: 16 }}>
      <Button title="Seed (basic)" onPress={seedBasic} disabled={loading} />
      {loading ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
    </View>
  );
}
