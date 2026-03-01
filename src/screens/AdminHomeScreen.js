import React, { useState } from "react";
import { View, Button, Alert, ActivityIndicator } from "react-native";
import { post } from "aws-amplify/api";

const devLog = (...args) => {
  if (__DEV__) console.devLog("[ADMIN_HOME]", ...args);
};

export default function AdminHomeScreen() {
  const [loading, setLoading] = useState(false);

  const seedBasic = async () => {
    setLoading(true);
    try {
      const op = await post({
        apiName: "seeding",
        path: "/admin",
        options: { body: { mode: "seed", scenario: "basic" } },
      });

      const response = await op.response;

      devLog("status =", response.statusCode);
      devLog("headers =", response.headers);

      const body = response.body;

      let json;
      if (body && typeof body.json === "function") {
        json = await body.json();
      } else if (body && typeof body.text === "function") {
        const txt = await body.text();
        json = JSON.parse(txt);
      } else {
        json = { note: "No body or unknown body shape", response };
      }

      Alert.alert("Seed complete", JSON.stringify(json, null, 2));
    } catch (e) {
      devLog("error =", e);

      try {
        const resp = await e?.response;
        if (resp?.body?.text) {
          const txt = await resp.body.text();
          devLog("error body =", txt);
        }
      } catch {}

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
