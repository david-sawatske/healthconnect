import React from "react";
import { Button, Alert } from "react-native";
import { signOut } from "aws-amplify/auth";

export function LogoutButton({ navigation }) {
  const handleLogout = async () => {
    try {
      await signOut();
      navigation.reset({
        index: 0,
        routes: [{ name: "Auth" }],
      });
    } catch (err) {
      console.log("Logout error:", err);
      Alert.alert("Logout failed", err?.message || "Unknown error");
    }
  };

  return <Button title="Log Out" onPress={handleLogout} />;
}
