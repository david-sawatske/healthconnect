import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { signIn, getCurrentUser } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/api';

const client = generateClient();

// Pre-seeded test accounts
const USERS = {
  Patient:  { username: 'patient@example.com',  password: 'Password123!' },
  Provider: { username: 'provider@example.com', password: 'Password123!' },
  Advocate: { username: 'advocate@example.com', password: 'Password123!' },
};

const GET_USER = /* GraphQL */ `
    query GetUser($id: ID!) {
        getUser(id: $id) {
            id
            role
            displayName
        }
    }
`;

export default function AuthScreen({ navigation }) {
  const [checking, setChecking] = useState(true);

  const routeByUserRecord = async () => {
    try {
      const cognitoUser = await getCurrentUser();
      const sub = cognitoUser.userId;

      const { data } = await client.graphql({
        query: GET_USER,
        variables: { id: sub },
      });

      const user = data?.getUser;

      if (!user) {
        Alert.alert("Login error", "User record not found in database");
        navigation.replace("Home");
        return;
      }

      const role = (user.role || "").toUpperCase();
      console.log("$$$$", user)

      if (role === "PROVIDER") {
        navigation.replace("ProviderHome");
      } else if (role === "ADVOCATE") {
        navigation.replace("AdvocateHome");
      } else if (role === "PATIENT") {
        navigation.replace("PatientHome");
      } else {
        console.warn("Unknown role, routing to Home:", role);
        navigation.replace("Home");
      }
    } catch (err) {
      console.log("Routing error:", err);
      navigation.replace("Home");
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        await routeByUserRecord();
      } catch {
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const handleLogin = async (userType) => {
    const { username, password } = USERS[userType];

    try {
      await signIn({ username, password });

      await routeByUserRecord();
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert('Login failed', error?.message || 'Unknown error');
    }
  };

  if (checking) {
    return (
      <View style={[styles.container, { alignItems: 'center' }]}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Checking session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select a Role to Login</Text>
      {Object.keys(USERS).map((role) => (
        <Button key={role} title={role} onPress={() => handleLogin(role)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 12, padding: 20 },
  title: { fontSize: 18, marginBottom: 20, textAlign: 'center' },
});
